import { setTimeout as sleep } from 'node:timers/promises';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { customerTurn as respond, type Outcome } from './assistant.js';
import { replyEligible } from './reply-policy.js';
import { config } from './config.js';
import { shop } from './csolution-pos.js';
import { db, log, row, transaction } from './db.js';
import { beat } from './heartbeat.js';
import { advanceSale, currentSale, withoutQuote } from './sales.js';
import { latestConsent, platformNotice } from './customer-text.js';
import {
  alertAdmins, cancelFollowUps, customerOptedOut, dueFollowUps, enrichCustomer, enqueue,
  markFollowUpSent, recipient, scheduleFollowUp, setCustomerOptedOut, setMode, type Conversation,
} from './store.js';
import { audioAllowed, pendingVoice, transcribe } from './voice.js';

interface Presence { accountId: string; jid: string }

async function beginPresence(conversationId: string): Promise<Presence | undefined> {
  const target = await row<{ account_id: string; customer_jid: string; mode: string }>(db, `SELECT c.account_id,
    c.customer_jid,a.mode FROM conversations c JOIN accounts a ON a.id=c.account_id
    WHERE c.id=$1 AND c.mode='bot' AND a.enabled AND a.mode='baileys'`, [conversationId]);
  if (!target) return;
  // Written outside the reply transaction so the gateway can show "typing" before the reply is ready.
  await db.query("INSERT INTO gateway_signals (account_id,jid,kind) VALUES ($1,$2,'composing')",
    [target.account_id, target.customer_jid]).catch(() => undefined);
  return { accountId: target.account_id, jid: target.customer_jid };
}

async function endPresence(presence: Presence | undefined) {
  if (!presence) return;
  await db.query("INSERT INTO gateway_signals (account_id,jid,kind) VALUES ($1,$2,'paused')",
    [presence.accountId, presence.jid]).catch(() => undefined);
}

/**
 * Read the words out of a stored voice note. Returns undefined when the file is
 * not audio, when it is too large, or when every transcription attempt failed.
 */
async function heardAudio(client: Parameters<typeof respond>[0], mediaId: string) {
  try {
    const stored = await row<{ bytes: Buffer; mimetype: string }>(client,
      'SELECT bytes,mimetype FROM media WHERE id=$1', [mediaId]);
    if (!stored?.bytes?.length || !audioAllowed(stored.mimetype, stored.bytes.length)) return undefined;
    return await transcribe(stored, 'en');
  } catch {
    return undefined;
  }
}

/**
 * The newest inbound photo in this batch, base64-encoded for the vision model.
 * Only images under the media size limit; anything else is ignored rather than
 * failing the whole reply.
 */
async function newestPhoto(client: Parameters<typeof respond>[0], ids: string[]) {
  if (!ids.length) return undefined;
  try {
    const found = await client.query<{ bytes: Buffer; mimetype: string }>(
      `SELECT m.bytes, m.mimetype FROM messages msg JOIN media m ON m.id=msg.media_id
       WHERE msg.id = ANY($1::bigint[]) AND m.mimetype IN ('image/jpeg','image/png','image/webp')
       ORDER BY msg.id DESC LIMIT 1`, [ids]);
    const image = found.rows[0];
    if (!image || !image.bytes?.length || image.bytes.length > 8 * 1024 * 1024) return undefined;
    return { base64: image.bytes.toString('base64'), mimetype: image.mimetype };
  } catch {
    return undefined;
  }
}

/**
 * Queue the follow-up that matches where this turn just landed. The sweep only
 * sends it if the customer stays silent, so a chat that keeps moving never gets
 * an outdated nudge.
 */
async function planFollowUps(
  client: Parameters<typeof respond>[0], conversation: Conversation, outcome: Outcome,
) {
  const { account_id: accountId, id: conversationId, customer_jid: jid } = conversation;
  const inHours = (n: number) => new Date(Date.now() + n * 3600_000);
  const en = outcome.memory.language === 'en';
  const product = outcome.memory.quoteFor === 'plan'
    ? (outcome.memory.system === 'lubfy' ? 'LubFy package' : outcome.memory.system === 'wotefy' ? 'WoteFy package' : undefined)
    : outcome.memory.product?.name ?? conversation.memory.product?.name;
  // A closed sale has nothing left to nudge.
  if (outcome.stage === 'paid' || outcome.stage === 'completed') {
    await cancelFollowUps(client, conversationId);
    return;
  }
  if (outcome.memory.support || outcome.memory.documentRequest) {
    await cancelFollowUps(client, conversationId, ['quote_nudge', 'payment_reminder']);
    return;
  }
  if (outcome.stage === 'quoted' && config.FOLLOWUP_QUOTE_HOURS) {
    await cancelFollowUps(client, conversationId, ['payment_reminder', 'handoff_ping']);
    await scheduleFollowUp(client, {
      accountId, conversationId, jid, kind: 'quote_nudge', at: inHours(config.FOLLOWUP_QUOTE_HOURS),
      body: en
        ? `Hi! Did you get a chance to look at ${product ?? 'the quote'}? Would you like help checking whether it fits your needs?`
        : `Habari! Ulipata muda kuangalia ${product ?? 'bei tuliyojadili'}? Ungependa nikusaidie kuthibitisha kama inakidhi mahitaji yako?`,
    });
  } else if (outcome.stage === 'ready_to_pay' && config.FOLLOWUP_PAYMENT_HOURS) {
    await cancelFollowUps(client, conversationId, ['quote_nudge', 'handoff_ping']);
    await scheduleFollowUp(client, {
      accountId, conversationId, jid, kind: 'payment_reminder', at: inHours(config.FOLLOWUP_PAYMENT_HOURS),
      body: en
        ? "Hi! Once you've paid, send the receipt and I'll connect you with the team to confirm."
        : 'Habari! Ukishafanya malipo, nitumie risiti nikuunganishe na timu kuthibitisha.',
    });
  } else if (outcome.handoff && config.FOLLOWUP_HANDOFF_HOURS) {
    await cancelFollowUps(client, conversationId, ['quote_nudge', 'payment_reminder']);
    await scheduleFollowUp(client, {
      accountId, conversationId, jid, kind: 'handoff_ping', at: inHours(config.FOLLOWUP_HANDOFF_HOURS),
      body: en
        ? "Hi, did you receive help with your question? If you still need assistance, let us know here."
        : 'Habari, ulipata msaada kwa swali lako? Kama bado unahitaji msaada, tuambie hapa.',
    });
  } else if (outcome.memory.survey && config.FOLLOWUP_QUOTE_HOURS) {
    await cancelFollowUps(client, conversationId, ['payment_reminder', 'handoff_ping']);
    const town = outcome.memory.survey.town;
    const named = town ? town.charAt(0).toUpperCase() + town.slice(1).toLowerCase() : '';
    await scheduleFollowUp(client, {
      accountId, conversationId, jid, kind: 'quote_nudge', at: inHours(config.FOLLOWUP_QUOTE_HOURS),
      body: en
        ? `Hi, shall we continue planning${named ? ' the ' + named + ' Wi-Fi site' : ''}? One detail is enough: the kind of place, or how many people would be online at once.`
        : `Habari, tuendelee na mpango${named ? ' wa ' + named : ''}? Jambo moja linatosha: aina ya eneo, au watu wangapi watakuwa mtandaoni kwa pamoja.`,
    });
  }
}

const name = 'conversation-replies';
const producer = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 5000 });
const consumer = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue<{ conversationId: string; firstMessage: string }>(name, { connection: producer });
queue.on('error', error => log.error({ code: error.name }, 'Queue connection error'));

const worker = new Worker<{ conversationId: string; firstMessage: string }>(name, async job => {
  let presence: Promise<Presence | undefined> | undefined;
  try {
    await transaction(async client => {
      const { conversationId, firstMessage } = job.data;
      const conversation = await row<Conversation>(client, 'SELECT * FROM conversations WHERE id=$1 FOR NO KEY UPDATE',
        [conversationId]);
      if (!conversation) return;
      const account = await row(client, 'SELECT enabled FROM accounts WHERE id=$1', [conversation.account_id]);
      if (!account?.enabled) return;
      const pending = (await client.query<{ id: string; body: string; occurred_at: Date; auto_reply: boolean;
        media_id: string | null; kind: string }>(
        `SELECT id,body,occurred_at,auto_reply,media_id,kind
        FROM messages WHERE conversation_id=$1 AND processing='pending' ORDER BY id LIMIT 20`, [conversationId])).rows;
      if (pending[0]?.id !== firstMessage) return;
      const ids = pending.map(message => message.id);
      const optedOut = await customerOptedOut(client, conversation.account_id, conversation.customer_jid);
      const textConsent = latestConsent(pending);
      const mayTranscribe = !optedOut && textConsent !== 'stop' && conversation.mode === 'bot' && conversation.memory.language === 'en';
      // A voice note is the customer's own words, so the words are recovered
      // before anything is classified. A customer who cannot type should not be
      // asked to type their question again.
      const hasVoice = pending.some(message => pendingVoice(message.body) && message.media_id);
      // Show typing while the note is being read: listening takes a few seconds,
      // and silence reads as "the bot is broken".
      if (hasVoice && conversation.mode === 'bot') presence = beginPresence(conversationId).catch(() => undefined);
      let voiceUnread = false;
      for (const message of pending) {
        if (message.kind !== 'audio' || !pendingVoice(message.body)) continue;
        if (!message.media_id || !mayTranscribe) { voiceUnread = true; continue; }
        const heard = await heardAudio(client, message.media_id);
        if (heard?.text) {
          message.body = heard.text;
          await client.query('UPDATE messages SET body=$2 WHERE id=$1', [message.id, heard.text]);
        } else voiceUnread = true;
      }
      const spoken = pending.some(message => !pendingVoice(message.body) && message.kind === 'audio');
      const history = (await client.query<{ direction: 'inbound' | 'outbound'; body: string; occurred_at: Date }>(`SELECT direction,body,occurred_at
        FROM messages WHERE conversation_id=$1 AND processing='done'
        AND occurred_at <= $2 ORDER BY occurred_at DESC,id DESC LIMIT 16`,
      [conversationId, new Date(Math.max(...pending.map(message => message.occurred_at.getTime())))])).rows.reverse();
      const newest = pending.map(message => message.body.slice(0, 1200)).join('\n').slice(-4500);
      // A photo is part of the question: "hii ni nini?" with a picture of the
      // box. The bytes go to the model only for identification, never stored in
      // the prompt history.
      const hasPhoto = pending.some(message => message.kind === 'image');
      const eligible = replyEligible(newest, conversation.memory, history, hasPhoto);
      // A number that asked to be left alone stays silent unless it asks to come
      // back. Opt-out beats every sales branch, or the number gets reported.
      const consent = latestConsent(pending);
      const resume = consent === 'resume';
      if (consent === 'stop') {
        await setCustomerOptedOut(client, conversation.account_id, conversation.customer_jid, true);
        await cancelFollowUps(client, conversationId);
        await client.query(`UPDATE outbound SET state='canceled',reason='customer_opt_out'
          WHERE conversation_id=$1 AND origin IN ('bot','handoff') AND state IN ('queued','sending')`, [conversationId]);
        if (!optedOut && conversation.mode === 'bot' && pending.some(message => message.auto_reply)) await enqueue(client, { accountId: conversation.account_id, conversationId, jid: recipient(conversation),
          origin: 'bot', body: 'Sawa, sitakutumia ujumbe tena. Ukitaka nianze tena, andika "anza".' });
        await client.query("UPDATE messages SET processing='done' WHERE id=ANY($1::bigint[])", [ids]);
        return;
      }
      if (optedOut && !resume) {
        await client.query("UPDATE messages SET processing='done' WHERE id=ANY($1::bigint[])", [ids]);
        return;
      }
      if (resume && optedOut) await setCustomerOptedOut(client, conversation.account_id, conversation.customer_jid, false);
      // A chat parked in human mode answers nothing, forever. If no agent has
      // written for the idle window, give it back to the bot instead of leaving
      // a paying customer on read. The pending messages were flagged
      // auto_reply=false by the takeover, so re-arm them here.
      let mode = conversation.mode;
      if (eligible && mode === 'human' && config.HANDOFF_IDLE_MINUTES > 0) {
        const since = conversation.human_since ? new Date(conversation.human_since).getTime() : 0;
        if (!since || Date.now() - since >= config.HANDOFF_IDLE_MINUTES * 60_000) {
          await setMode(client, conversationId, 'bot');
          await client.query(`UPDATE messages SET auto_reply=true
            WHERE conversation_id=$1 AND processing='pending' AND direction='inbound'`, [conversationId]);
          mode = 'bot';
          for (const message of pending) message.auto_reply = true;
          log.info({ conversation: conversationId }, 'Idle handoff released back to the bot');
        }
      }
      const canReply = mode === 'bot' && pending.some(message => message.auto_reply);
      if (voiceUnread && canReply) {
        // Nothing read the words. Dropping the message would be the worst
        // outcome for a customer who spoke instead of typing, so a person gets
        // the chat and the team gets the alert.
        const memory = { ...conversation.memory, recentTopic: 'Mteja ametuma voice note ambayo haikusomeka' };
        await client.query("UPDATE messages SET processing='done' WHERE id=ANY($1::bigint[])", [ids]);
        await client.query('UPDATE conversations SET memory=$2,updated_at=now() WHERE id=$1',
          [conversationId, memory]);
        await setMode(client, conversationId, 'human');
        await alertAdmins(client, { ...conversation, memory }, 'Voice note haijasikika');
        log.warn({ conversation: conversationId }, 'Voice note could not be transcribed; handed to a person');
        return;
      }
      // Show typing and decode images only when this batch is eligible for a reply.
      if (eligible && canReply && !presence) presence = beginPresence(conversationId).catch(() => undefined);
      const imageIds = pending.filter(message => message.kind === 'image' && message.auto_reply).map(message => message.id);
      if (eligible && canReply && !imageIds.length && /\b(?:hii|hiki|hiyo|this|that)\b/i.test(newest)) {
        // Forwarded product photos and their question can arrive in different batches.
        const previous = await row<{ id: string; kind: string; direction: string; body: string }>(client,
          `SELECT id,kind,direction,body FROM messages WHERE conversation_id=$1 AND id<$2
           AND occurred_at BETWEEN $3::timestamptz - interval '3 minutes' AND $3 ORDER BY id DESC LIMIT 1`,
        [conversationId, firstMessage, pending[0].occurred_at]);
        if (previous?.kind === 'image' && previous.direction === 'inbound'
            && !/risiti|receipt|malipo|paid|nimelipa/i.test(previous.body)) imageIds.push(previous.id);
      }
      let photo: Parameters<typeof respond>[5];
      if (eligible && canReply && imageIds.length) {
        photo = imageIds.length === 1 ? await newestPhoto(client, imageIds) : undefined;
        photo ??= { count: imageIds.length };
      }
      const replyStarted = Date.now();
      const outcome = await respond(client, conversation, newest,
        history.map(line => ({ ...line, body: line.body.slice(0, 700) })), !canReply, photo, spoken, `${conversation.account_id}:${firstMessage}`);
      const replyMs = Date.now() - replyStarted;
      if (replyMs >= 5000) log.warn({ conversation: conversationId, replyMs, batchSize: pending.length,
        withPhoto: Boolean(photo), withVoice: spoken, canReply }, 'Slow reply generation');
      await client.query('UPDATE conversations SET memory=$2,updated_at=now() WHERE id=$1', [conversationId, outcome.memory]);
      if (canReply && outcome.handoff) await setMode(client, conversationId, 'human');
      if (canReply && outcome.body) await enqueue(client, {
        accountId: conversation.account_id, conversationId, jid: recipient(conversation),
        origin: outcome.handoff ? 'handoff' : 'bot', body: outcome.body.slice(0, 3600), imageUrl: outcome.imageUrl,
      });
      const updated = { ...conversation, memory: outcome.memory };
      if (outcome.stage) {
        const sale = await currentSale(client, conversationId);
        const receipt = outcome.stage === 'payment_reported'
          ? [...pending].reverse().find(message => message.kind === 'image' && message.media_id && /\b(?:nimelipa|nimeshalipa|risiti|receipt|paid|payment sent)\b/i.test(message.body))?.media_id
            ?? (pending.length === 2 && pending.some(message => message.body === '[WhatsApp image]')
              ? pending.find(message => message.body === '[WhatsApp image]')?.media_id : undefined) : undefined;
        await advanceSale(client, updated, sale, outcome.stage, 'customer_message', receipt ?? undefined);
      }
      if (canReply && (outcome.notify || (!outcome.stage && outcome.handoff))) {
        const closedOrder = conversation.stage === 'completed' || conversation.stage === 'paid';
        const memory = closedOrder && !outcome.alertTitle ? withoutQuote(updated.memory) : updated.memory;
        await alertAdmins(client, { ...updated, memory },
          outcome.alertTitle ?? (outcome.handoff ? 'Mazungumzo yanahitaji mhudumu' : 'Tatizo jipya la mfumo'),
          memory.lastSupport && !memory.documentSummary && outcome.handoff
            ? [...pending].reverse().find(message => message.kind === 'image' && message.media_id)?.media_id
              ?.replace(/^/, 'csbot-media:') : undefined, outcome.supportAlert);
      }
      if (canReply && !platformNotice(newest)) {
        // Keep the 360 record current with what this turn revealed, then queue
        // the follow-up for wherever the chat just landed. A LubFy admin alert
        // must not refresh a sales nudge.
        await enrichCustomer(client, conversation.account_id, conversation.customer_jid, {
          language: outcome.memory.language,
          email: outcome.memory.support?.email ?? outcome.memory.lastSupport?.email,
          segment: outcome.memory.facts?.use,
        });
        await planFollowUps(client, conversation, outcome);
      }
      await client.query("UPDATE messages SET processing='done' WHERE id=ANY($1::bigint[])", [ids]);
    });
  } finally {
    await endPresence(await presence);
  }
}, { connection: consumer, concurrency: config.WORKER_CONCURRENCY });

worker.on('error', error => log.error({ code: error.name }, 'Reply worker error'));
worker.on('failed', (job, error) =>
  log.warn({ job: job?.id, code: error.name, attempts: job?.attemptsMade }, 'Reply processing failed'));

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { stopping = true; });
try {
  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  log.info('Reply worker started');
  let lastBeat = 0;
  let lastSweep = 0;
  let lastFollowUp = 0;
  while (!stopping) {
    if (Date.now() - lastBeat > 10000) {
      lastBeat = Date.now();
      await beat('worker', { concurrency: config.WORKER_CONCURRENCY });
    }
    // Receipt photos live in PostgreSQL, so old ones are pruned on a schedule to keep the table small.
    if (Date.now() - lastSweep > 3600000) {
      lastSweep = Date.now();
      await db.query(`DELETE FROM media WHERE created_at < now() - ($1::int * interval '1 day')`,
        [config.MEDIA_RETENTION_DAYS]).catch(error =>
        log.warn({ code: (error as Error).name }, 'Stored media could not be pruned'));
    }
    try {
      const { rows } = await db.query<{ id: string; first: string }>(`SELECT c.id, min(m.id) AS first
        FROM messages m JOIN conversations c ON c.id=m.conversation_id
        JOIN accounts a ON a.id=c.account_id WHERE a.enabled AND m.processing='pending'
        GROUP BY c.id HAVING max(m.received_at) <= now()-($1::int * interval '1 millisecond')
           OR min(m.received_at) <= now()-interval '8 seconds' OR count(*) >= 20
        ORDER BY min(m.received_at) LIMIT $2`, [config.DEBOUNCE_MS, config.WORKER_CONCURRENCY * 8]);
      if (rows.length) {
        // PostgreSQL remains the durable inbox. A new minute bucket makes exhausted or lost jobs eligible again.
        const bucket = Math.floor(Date.now() / 60000);
        await queue.addBulk(rows.map(item => ({
          name: 'reply', data: { conversationId: item.id, firstMessage: item.first },
          opts: { jobId: `${item.id}-${item.first}-${bucket}`, attempts: 5,
            backoff: { type: 'exponential', delay: 1000, jitter: 0.3 },
            removeOnComplete: { age: 300, count: 5000 }, removeOnFail: { age: 86400, count: 5000 } },
        })));
      }
    } catch (error) {
      log.warn({ code: (error as Error).name }, 'Could not schedule pending messages');
    }
    // Follow-ups fire only when their time has come, the customer has stayed
    // silent since they were queued, and the number has not opted out. Swept
    // every 30s: more often would just churn the connection pool.
    if (Date.now() - lastFollowUp > 30000) {
      lastFollowUp = Date.now();
      try {
        await transaction(async client => {
          const due = await dueFollowUps(client, 20);
          for (const fu of due) {
            if (await customerOptedOut(client, fu.account_id, fu.jid)) {
              await cancelFollowUps(client, fu.conversation_id);
              continue;
            }
            const lastIn = await row<{ occurred_at: Date }>(client,
              `SELECT occurred_at FROM messages WHERE conversation_id=$1 AND direction='inbound'
               ORDER BY id DESC LIMIT 1`, [fu.conversation_id]);
            // The customer wrote after this nudge was queued, so it is stale.
            if (lastIn && lastIn.occurred_at.getTime() > fu.created_at.getTime()) {
              await cancelFollowUps(client, fu.conversation_id, [fu.kind]);
              continue;
            }
            const mode = await row<{ mode: string; stage: string }>(client,
              'SELECT mode,stage FROM conversations WHERE id=$1', [fu.conversation_id]);
            if (!mode || ['paid', 'completed', 'payment_reported'].includes(mode.stage) ||
                (fu.kind !== 'handoff_ping' && mode.mode !== 'bot')) {
              await cancelFollowUps(client, fu.conversation_id, [fu.kind]);
              continue;
            }
            // A handoff ping is pointless once the chat is back with the bot.
            if (fu.kind === 'handoff_ping' && mode?.mode !== 'human') {
              await cancelFollowUps(client, fu.conversation_id, ['handoff_ping']);
              continue;
            }
            const account = await row(client, 'SELECT enabled FROM accounts WHERE id=$1', [fu.account_id]);
            if (!account?.enabled) { await cancelFollowUps(client, fu.conversation_id); continue; }
            await enqueue(client, { accountId: fu.account_id, conversationId: fu.conversation_id,
              jid: fu.jid, origin: fu.kind === 'handoff_ping' ? 'handoff' : 'bot', body: fu.body });
            await markFollowUpSent(client, fu.id);
          }
        });
      } catch (error) {
        log.warn({ code: (error as Error).name }, 'Could not send due follow-ups');
      }
    }
    if (!stopping) await sleep(500);
  }
} finally {
  await worker.close();
  await queue.close();
  producer.disconnect();
  consumer.disconnect();
  await Promise.all([db.end(), shop?.end()]);
}
