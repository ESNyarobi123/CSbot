import { setTimeout as sleep } from 'node:timers/promises';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { respond } from './assistant.js';
import { config } from './config.js';
import { shop } from './csolution-pos.js';
import { db, log, row, transaction } from './db.js';
import { beat } from './heartbeat.js';
import { advanceSale, currentSale, withoutQuote } from './sales.js';
import { alertAdmins, enqueue, recipient, setMode, type Conversation } from './store.js';

interface Presence { accountId: string; jid: string }

async function beginPresence(conversationId: string): Promise<Presence | undefined> {
  const target = await row<{ account_id: string; customer_jid: string; mode: string }>(db, `SELECT c.account_id,
    c.customer_jid,a.mode FROM conversations c JOIN accounts a ON a.id=c.account_id
    WHERE c.id=$1 AND c.mode='bot' AND a.enabled AND a.mode='baileys'`, [conversationId]);
  if (!target) return;
  // Written outside the reply transaction so the gateway can show "typing" before Gemini answers.
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
    if (!image || !image.bytes?.length || image.bytes.length > 4_000_000) return undefined;
    return { base64: image.bytes.toString('base64'), mimetype: image.mimetype };
  } catch {
    return undefined;
  }
}

const name = 'conversation-replies';
const producer = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 5000 });
const consumer = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue<{ conversationId: string; firstMessage: string }>(name, { connection: producer });
queue.on('error', error => log.error({ code: error.name }, 'Queue connection error'));

const worker = new Worker<{ conversationId: string; firstMessage: string }>(name, async job => {
  const presence = await beginPresence(job.data.conversationId);
  try {
    await transaction(async client => {
      const { conversationId, firstMessage } = job.data;
      const conversation = await row<Conversation>(client, 'SELECT * FROM conversations WHERE id=$1 FOR NO KEY UPDATE',
        [conversationId]);
      if (!conversation) return;
      const account = await row(client, 'SELECT enabled FROM accounts WHERE id=$1', [conversation.account_id]);
      if (!account?.enabled) return;
      const pending = (await client.query<{ id: string; body: string; occurred_at: Date; auto_reply: boolean;
        media_id: string | null }>(
        `SELECT id,body,occurred_at,auto_reply,media_id
        FROM messages WHERE conversation_id=$1 AND processing='pending' ORDER BY id LIMIT 20`, [conversationId])).rows;
      if (pending[0]?.id !== firstMessage) return;
      const ids = pending.map(message => message.id);
      const history = (await client.query<{ direction: 'inbound' | 'outbound'; body: string }>(`SELECT direction,body
        FROM messages WHERE conversation_id=$1 AND processing='done'
        AND occurred_at <= $2 ORDER BY occurred_at DESC,id DESC LIMIT 16`,
      [conversationId, new Date(Math.max(...pending.map(message => message.occurred_at.getTime())))])).rows.reverse();
      const newest = pending.map(message => message.body.slice(0, 1200)).join('\n').slice(-4500);
      // A photo is part of the question: "hii ni nini?" with a picture of the
      // box. The bytes go to the model only for identification, never stored in
      // the prompt history.
      const photo = await newestPhoto(client, ids);
      // A chat parked in human mode answers nothing, forever. If no agent has
      // written for the idle window, give it back to the bot instead of leaving
      // a paying customer on read. The pending messages were flagged
      // auto_reply=false by the takeover, so re-arm them here.
      let mode = conversation.mode;
      if (mode === 'human' && config.HANDOFF_IDLE_MINUTES > 0) {
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
      const outcome = await respond(client, conversation, newest,
        history.map(line => ({ ...line, body: line.body.slice(0, 700) })), !canReply, photo);
      await client.query('UPDATE conversations SET memory=$2,updated_at=now() WHERE id=$1', [conversationId, outcome.memory]);
      if (canReply && outcome.handoff) await setMode(client, conversationId, 'human');
      if (canReply && outcome.body) await enqueue(client, {
        accountId: conversation.account_id, conversationId, jid: recipient(conversation),
        origin: outcome.handoff ? 'handoff' : 'bot', body: outcome.body.slice(0, 3600), imageUrl: outcome.imageUrl,
      });
      const updated = { ...conversation, memory: outcome.memory };
      if (outcome.stage) {
        const sale = await currentSale(client, conversationId);
        await advanceSale(client, updated, sale, outcome.stage, 'customer_message');
      }
      else if (canReply && (outcome.handoff || outcome.notify)) {
        const closedOrder = conversation.stage === 'completed' || conversation.stage === 'paid';
        const memory = closedOrder ? withoutQuote(updated.memory) : updated.memory;
        await alertAdmins(client, { ...updated, memory },
          outcome.handoff ? 'Mazungumzo yanahitaji mhudumu' : 'Tatizo jipya la mfumo');
      }
      await client.query("UPDATE messages SET processing='done' WHERE id=ANY($1::bigint[])", [ids]);
    });
  } finally {
    await endPresence(presence);
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
    if (!stopping) await sleep(500);
  }
} finally {
  await worker.close();
  await queue.close();
  producer.disconnect();
  consumer.disconnect();
  await Promise.all([db.end(), shop?.end()]);
}
