import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { log, row, transaction } from './db.js';
import { understandAdminSupportReply } from './admin-support.js';
import { supportAdminMessage, type SupportAlertStatus } from './support.js';

export type Stage = 'inquiry' | 'quoted' | 'ready_to_pay' | 'payment_reported' | 'paid' | 'completed';
export const stages: Stage[] = ['inquiry', 'quoted', 'ready_to_pay', 'payment_reported', 'paid', 'completed'];

export interface Conversation {
  id: string;
  account_id: string;
  customer_jid: string;
  customer_phone: string | null;
  customer_name: string | null;
  mode: 'bot' | 'human';
  human_since: Date | null;
  stage: Stage;
  unread_count: number;
  last_body: string | null;
  last_at: Date | null;
  memory: {
    replyStatus?: 'waiting' | 'answered';
    handoffPending?: true;
    supportUpdate?: { status: 'resolved' | 'details' | 'resolution_queued' | 'awaiting_confirmation' | 'reopened';
      alertAt?: string; owner?: string; outboundId?: string; resolvedAt?: string };
    diagnosticRequest?: { id: string; system: 'wotefy' | 'lubfy'; email: string; problem: string; expiresAt: string };
    onboarding?: boolean;
    setup?: import('./installation-guide.js').SetupContext;
    preferredName?: string;
    nameAddressedAt?: number;
    profile?: import('./customer-text.js').CustomerProfile;
    system?: 'wotefy' | 'lubfy';
    product?: { id: string; name: string };
    lastQuote?: string;
    installationQuote?: import('./installation-quote.js').InstallationQuoteContext;
    plan?: { kind?: 'subscription' | 'wifi' | 'bundle'; site?: string };
    productOptions?: { id: string; name: string; sku?: string; price?: string; coverage?: number }[];
    /** The query behind productOptions, so "model zingine?" can widen the list. */
    optionQuery?: string;
    /** Order of the last model list, so "namba 2" means the second model shown. */
    lastOptionIds?: string[];
    /** What the site must do, collected before a model list is offered. */
    requirements?: { coverageMeters?: number; users?: number;
      obstacles?: 'open' | 'obstructed'; environment?: 'indoor' | 'outdoor' | 'mixed' };
    /** Which planning flow produced the current shortlist. */
    survey?: { waitingFor: 'site' | 'users'; town?: string; site?: string };
    planning?: 'mesh' | 'coverage';
    quoteFor?: 'product' | 'plan';
    documentRequest?: import('./quotation.js').DocumentRequest;
    documentSummary?: string;
    lastDocument?: string;
    issuedProforma?: { number: string; order: import('./installation-quote.js').OrderPreview; summary: string };
    supersededProforma?: true;
    posQuotation?: { number: string; productId: string; quantity: number };
    /** Set while the bot waits for "yes" to its installation/cable offer. */
    awaitingService?: boolean;
    /** Support intake: the problem, the system, and the login email. */
    support?: { problem?: string; system?: 'wotefy' | 'lubfy'; email?: string; waitingFor?: 'problem' | 'email' | 'system' | 'device' | 'check'; attempts?: number; sameEmail?: boolean; checkInstruction?: string };
    /** Last completed support intake, kept for the admin alert and audits. */
    lastSupport?: { problem?: string; checkResult?: string; system?: 'wotefy' | 'lubfy'; email?: string; sameEmail?: boolean;
      verifiedCheck?: { summary: string; checkedAt: string } };
    recentTopic?: string;
    /** Chat language, so a bare model name does not flip the reply to English. */
    language?: 'sw' | 'en';
    /**
     * Open-ended site facts the bot picked up ("coverage_m": "300", "site":
     * "obstructed", "equipment": "EAP 610 · OMADA", "use": "hotel", "budget":
     * "200000"). Stored as text so a new question the shop starts asking does
     * not need a schema change. This is the single home for what the customer
     * told us; identity and consent live in the `customers` table.
     */
    facts?: Record<string, string>;
    /** Why the last answer said what it said, surfaced in the admin playground. */
    trace?: string[];
  };
}

export interface Incoming {
  accountId: string;
  providerId: string;
  image?: { mimetype: string; bytes: Buffer };
  /** A WhatsApp voice note, stored so the worker can read the words out of it. */
  audio?: { mimetype: string; bytes: Buffer };
  jid: string;
  alternateJid?: string;
  name?: string;
  body: string;
  kind: string;
  occurredAt: Date;
  fromMe?: boolean;
  historical?: boolean;
  sessionVersion?: number;
  quotedProviderId?: string;
}

export function phoneOf(jid: string) {
  return /^(\d{7,15})@s\.whatsapp\.net$/.exec(jid)?.[1];
}

export async function ingest(message: Incoming) {
  return transaction(async client => {
    const { accountId, jid, fromMe, historical } = message;
    const account = await row(client, 'SELECT enabled,session_version FROM accounts WHERE id=$1', [accountId]);
    if (!account?.enabled || (message.sessionVersion !== undefined && account.session_version !== message.sessionVersion)) return;
    // Serializes contact identity resolution while allowing other accounts to ingest independently.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('ingest:' || $1, 0))", [accountId]);
    if (fromMe && await row(client,
      'SELECT 1 FROM outbound WHERE account_id=$1 AND provider_id=$2', [accountId, message.providerId])) return;
    const aliases = [...new Set([jid, message.alternateJid].filter((value): value is string => Boolean(value)))];
    const phone = aliases.map(phoneOf).find(Boolean) ?? null;
    if (!fromMe && phone && await row(client, 'SELECT 1 FROM admin_numbers WHERE account_id=$1 AND phone=$2',
      [accountId, phone])) {
      if (!historical && message.kind === 'text' && message.quotedProviderId) {
        await applyAdminSupportReply(client, message, phone);
      }
      return;
    }
    let conversation = await row<Conversation>(client, `SELECT c.* FROM contact_aliases a
      JOIN conversations c ON c.id=a.conversation_id WHERE a.account_id=$1 AND a.jid=ANY($2)
      ORDER BY (a.jid=$3) DESC LIMIT 1`, [accountId, aliases, phone ? `${phone}@s.whatsapp.net` : jid]);
    if (!conversation) {
      conversation = (await row<Conversation>(client, `INSERT INTO conversations
        (account_id, customer_jid, customer_phone, customer_name, updated_at)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (account_id,customer_jid) DO UPDATE SET customer_jid=EXCLUDED.customer_jid RETURNING *`,
      [accountId, jid, phone, message.name ?? null, message.occurredAt]))!;
    }
    await client.query(`INSERT INTO contact_aliases (account_id,jid,conversation_id)
      SELECT $1, unnest($2::text[]), $3 ON CONFLICT DO NOTHING`, [accountId, aliases, conversation.id]);
    if (!fromMe && !historical) {
      // Every real inbound message refreshes the customer 360 record.
      await upsertCustomer(client, accountId, jid, message.occurredAt,
        { phone, name: message.name });
    }
    const inserted = await row(client, `INSERT INTO messages
      (conversation_id, provider_id, direction, actor, body, kind, occurred_at, processing, auto_reply)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (conversation_id,direction,provider_id) DO UPDATE SET processing='pending', auto_reply=EXCLUDED.auto_reply
      WHERE $8='pending' AND messages.processing='done'
        AND messages.received_at > clock_timestamp() - interval '5 minutes'
        AND messages.kind LIKE 'history:%'
      RETURNING id, kind`,
    [conversation.id, message.providerId, fromMe ? 'outbound' : 'inbound', fromMe ? 'admin' : 'customer',
      message.body, historical ? `history:${message.kind}` : message.kind, message.occurredAt,
      historical || fromMe ? 'done' : 'pending', conversation.mode === 'bot']);
    if ((message.image || message.audio) && !fromMe && !historical) {
      // Make the attachment visible to the worker in the same commit as the pending turn.
      const attachment = message.image ?? message.audio!;
      const kind = message.image ? 'image' : 'audio';
      const { bytes, mimetype } = attachment;
      const media = await row(client, `INSERT INTO media
        (account_id,conversation_id,provider_id,kind,mimetype,bytes,size)
        VALUES ($1,$2,$3,$7,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
      [accountId, conversation.id, message.providerId, mimetype, bytes, bytes.length, kind]);
      if (media) await client.query(`UPDATE messages SET media_id=$3
        WHERE conversation_id=$1 AND provider_id=$2 AND direction='inbound'`,
      [conversation.id, message.providerId, media.id]);
    }
    if (!inserted) return conversation.id;
    if (!historical && inserted.kind.startsWith('history:')) {
      await client.query('UPDATE messages SET kind=$2, received_at=clock_timestamp() WHERE id=$1',
        [inserted.id, message.kind]);
    }
    await client.query(`UPDATE conversations SET
      customer_phone=COALESCE($2::text,customer_phone), customer_name=COALESCE($3::text,customer_name),
      updated_at=GREATEST(updated_at,$4::timestamptz)
      WHERE id=$1 AND ((customer_phone IS NULL AND $2::text IS NOT NULL) OR
        ($3::text IS NOT NULL AND customer_name IS DISTINCT FROM $3) OR updated_at<$4)`,
    [conversation.id, phone, fromMe ? null : message.name ?? null, message.occurredAt]);
    if (!historical) {
      // The inbox needs a recent preview and a real unread counter without joining the message table.
      await client.query(`UPDATE conversations SET last_body=left($2,240),last_at=$3,
        unread_count=unread_count+CASE WHEN $4 THEN 1 ELSE 0 END WHERE id=$1`,
      [conversation.id, message.body, message.occurredAt, !fromMe]);
    }
    if (fromMe && !historical) {
      // A message sent from another linked device (phone, or an automated
      // notifier sharing the number) arrives as fromMe. Only treat it as a
      // human takeover when the customer actually just wrote, so scheduled
      // billing/withdrawal notices cannot silence the bot for hours.
      const answering = await row(client, `SELECT 1 FROM messages WHERE conversation_id=$1 AND direction='inbound'
        AND occurred_at > $2::timestamptz - interval '3 hours' LIMIT 1`, [conversation.id, message.occurredAt]);
      if (conversation.mode === 'human' || answering) await setMode(client, conversation.id, 'human');
    }
    return conversation.id;
  });
}

export async function setMode(client: PoolClient, id: string, mode: Conversation['mode'], pendingHandoff = false) {
  await client.query(`UPDATE conversations SET mode=$2,
    human_since=CASE WHEN $2='human' THEN now() ELSE NULL END,
    memory=CASE WHEN $2='human' AND $3::boolean THEN memory || '{"handoffPending":true}'::jsonb
      ELSE memory - 'handoffPending' END, updated_at=now() WHERE id=$1`, [id, mode, pendingHandoff]);
  if (mode === 'human') {
    await client.query(`UPDATE outbound SET state='canceled',reason='human_takeover'
      WHERE conversation_id=$1 AND origin IN ('bot','handoff') AND state IN ('queued','sending')`, [id]);
  }
  await client.query(`UPDATE messages SET auto_reply=$2
    WHERE conversation_id=$1 AND direction='inbound' AND processing='pending'`, [id, mode === 'bot']);
}

export async function enqueue(client: PoolClient, item: {
  accountId: string; conversationId: string; jid: string; body: string;
  origin: 'bot' | 'admin' | 'alert' | 'handoff'; imageUrl?: string; requestKey?: string;
  document?: { id: string; name: string; hash: string };
  supportReply?: boolean;
  replyAnchor?: string;
}) {
  const providerId = '3EB0' + randomBytes(10).toString('hex').toUpperCase();
  return row(client, `INSERT INTO outbound (account_id, conversation_id, jid, body, origin, image_url, provider_id, request_key, document_id, document_name, document_hash, support_reply, reply_anchor_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (conversation_id,request_key) DO NOTHING RETURNING id,state`,
  [item.accountId, item.conversationId, item.jid, item.body, item.origin, item.imageUrl ?? null, providerId,
    item.requestKey ?? null, item.document?.id ?? null, item.document?.name ?? null, item.document?.hash ?? null,
    item.supportReply ?? false, item.replyAnchor ?? null]);
}

export function recipient(conversation: Conversation) {
  return conversation.customer_jid;
}

async function applyAdminSupportReply(client: PoolClient, message: Incoming, phone: string) {
  const alert = await row<{ conversation_id: string; alert_at: string }>(client, `SELECT conversation_id,
    created_at::text AS alert_at FROM outbound
    WHERE account_id=$1 AND jid=$2 AND provider_id=$3 AND origin='alert'
      AND support_reply AND state='sent'`,
  [message.accountId, phone + '@s.whatsapp.net', message.quotedProviderId]);
  if (!alert) return;

  const conversation = await row<Conversation>(client, `SELECT * FROM conversations
    WHERE id=$1 AND account_id=$2 FOR NO KEY UPDATE`, [alert.conversation_id, message.accountId]);
  if (!conversation) return;
  const requestKey = 'whatsapp-support:' + createHash('sha256').update(phone + ':' + message.providerId).digest('hex');
  const to = recipient(conversation);
  const adminJid = phone + '@s.whatsapp.net';
  const confirm = (body: string) => enqueue(client, {
    accountId: message.accountId, conversationId: conversation.id, jid: adminJid,
    origin: 'alert', body, requestKey: requestKey + ':ack',
  });
  if (await row(client, 'SELECT 1 FROM outbound WHERE conversation_id=$1 AND request_key=$2',
    [conversation.id, requestKey + ':ack'])) return;
  const newer = await row(client, `SELECT 1 FROM outbound WHERE conversation_id=$1
    AND support_reply AND state IN ('queued','sending','sent') AND created_at>$2::timestamptz LIMIT 1`,
  [conversation.id, alert.alert_at]);
  const previous = conversation.memory.supportUpdate;
  const closedAfterAlert = previous?.status === 'resolved' && previous.resolvedAt &&
    Date.parse(previous.resolvedAt) >= Date.parse(alert.alert_at);
  if (newer || closedAfterAlert || (previous?.alertAt === alert.alert_at && ['resolved', 'resolution_queued', 'awaiting_confirmation', 'reopened'].includes(previous.status))) {
    await confirm('Kesi hii imefungwa au kuna arifa mpya zaidi. Fungua Inbox uangalie mazungumzo ya sasa.');
    return;
  }
  if (await customerOptedOut(client, message.accountId, conversation.customer_jid)) {
    await confirm('Mteja amesitisha ujumbe wa bot. Taarifa haijatumwa.');
    return;
  }
  const action = await understandAdminSupportReply(message.body);
  if (!action) {
    await confirm('Niambie kama suala limetatuliwa, taarifa gani zinahitajika, au ujumbe gani nimfikishie mteja.');
    return;
  }
  const english = conversation.memory.language === 'en';
  const body = action.kind === 'reply' ? action.text
    : action.kind === 'details'
      ? (english ? '*We need a few details to continue*' : '*Taarifa zinazohitajika kwa ombi lako*') + '\n\n' + action.text
      : [
        english ? '*Update from support*\nThe team has reported that the issue is resolved.'
          : '*Taarifa kutoka timu ya support*\nTimu imethibitisha kuwa tatizo limetatuliwa.',
        action.text,
        english ? 'Could you try it again and tell us whether it’s working now?'
          : 'Unaweza kujaribu tena kisha utuambie kama sasa inafanya kazi?',
      ].filter(Boolean).join('\n\n');
  const queued = await enqueue(client, {
    accountId: message.accountId, conversationId: conversation.id, jid: to,
    origin: 'admin', body: body.slice(0, 3500), requestKey,
  });
  if (!queued) return;
  if (action.kind === 'resolved') {
    await cancelFollowUps(client, conversation.id, ['handoff_ping', 'post_support']);
    await client.query(`UPDATE conversations SET memory=(memory - 'support') || $2::jsonb,updated_at=now()
      WHERE id=$1`, [conversation.id, { supportUpdate: { status: 'resolution_queued', alertAt: alert.alert_at, owner: phone, outboundId: queued.id } }]);
  } else if (action.kind === 'details') {
    await client.query(`UPDATE conversations SET memory=memory || $2::jsonb,updated_at=now() WHERE id=$1`,
      [conversation.id, { supportUpdate: { status: 'details', alertAt: alert.alert_at, owner: phone } }]);
  }
  await confirm(`Taarifa imewekwa kwenye foleni ya WhatsApp kwa mteja wa chat #${conversation.id}.`);
}

export async function copyInvoiceToAdmins(
  client: PoolClient, input: { accountId: string; conversationId: string; outboundId: string;
    customerJid: string; customerName?: string | null; customerPhone?: string | null;
    document: { id: string; name: string; hash: string } },
) {
  const admins = await client.query<{ phone: string }>('SELECT phone FROM admin_numbers WHERE account_id=$1', [input.accountId]);
  const customerPhone = input.customerPhone ?? phoneOf(input.customerJid);
  const customer = input.customerName?.replace(/\s+/g, ' ').trim();
  const label = /^Proforma-PF-/i.test(input.document.name) ? 'Proforma' : 'Invoice';
  const body = [
    `*CSbot | ${label} imetumwa kwa mteja*`,
    `*Mazungumzo* #${input.conversationId}`,
    customer && `*Mteja* ${customer}`,
    customerPhone && `*WhatsApp* +${customerPhone}`,
    `*${label}* ${input.document.name}`,
  ].filter(Boolean).join('\n');
  for (const { phone } of admins.rows) {
    if (phone === customerPhone || phone + '@s.whatsapp.net' === input.customerJid) continue;
    await enqueue(client, {
      accountId: input.accountId, conversationId: input.conversationId, jid: phone + '@s.whatsapp.net',
      origin: 'alert', body, document: input.document, requestKey: `invoice-copy:${input.outboundId}:${phone}`,
    });
  }
}

export async function alertAdmins(
  client: PoolClient, conversation: Conversation, title: string, imageUrl?: string, supportStatus?: SupportAlertStatus,
) {
  const { id, account_id: accountId, memory } = conversation;
  const admins = await client.query<{ phone: string }>('SELECT phone FROM admin_numbers WHERE account_id=$1', [accountId]);
  if (!admins.rows.length) {
    log.warn({ conversation: id, account: accountId }, 'No admin number configured for this account');
    return;
  }
  const customer = [conversation.customer_name, conversation.customer_phone, `chat #${id}`].filter(Boolean).join(' · ');
  const support = memory.documentSummary ? undefined : memory.support ?? memory.lastSupport;
  const subject = memory.documentSummary ? 'Mauzo ya Connect Solution' : support?.system
    ? `Msaada wa kiufundi · ${support.system === 'wotefy' ? 'WoteFy' : 'LubFy'}`
    : (memory.quoteFor === 'plan' ? memory.system : memory.product?.name ?? memory.system)
      ?? 'Bidhaa au huduma inahitaji kufafanuliwa';
  const detail = [
    memory.documentSummary,
    support?.problem && 'Tatizo: ' + support.problem,
    !memory.support && memory.lastSupport?.checkResult && support && 'Matokeo ya ukaguzi: ' + memory.lastSupport.checkResult,
    support?.email && 'Email ya akaunti: ' + support.email,
    !memory.documentSummary && !support && memory.lastQuote && 'Bei ya kumbukumbu: ' + memory.lastQuote,
    !memory.documentSummary && !support && memory.recentTopic?.slice(0, 280),
  ].filter(Boolean).join('\n');
  const body = supportStatus && support
    ? supportAdminMessage(conversation, support, supportStatus, Boolean(imageUrl))
    : `CSbot — ${title}\n${customer}\n${subject}${detail ? '\n' + detail : ''}`;
  for (const admin of admins.rows) {
    await enqueue(client, { accountId, conversationId: id, jid: admin.phone + '@s.whatsapp.net',
      body: supportStatus && support
        ? body + '\n\nJibu arifa hii ueleze kilichofanyika au taarifa unazohitaji kutoka kwa mteja.'
        : body,
      origin: 'alert', imageUrl, supportReply: Boolean(supportStatus && support) });
  }
}

/* ------------------------------------------------------------------------- *
 * Customer 360 and follow-ups
 * ------------------------------------------------------------------------- */

/**
 * One identity record per WhatsApp number. Called on every inbound message so
 * first_seen/last_seen stay honest and a renamed contact updates the record.
 */
export async function upsertCustomer(
  client: PoolClient, accountId: string, jid: string, seen: Date,
  identity: { phone?: string | null; name?: string | null },
) {
  await client.query(`INSERT INTO customers (account_id,jid,phone,name,first_seen,last_seen)
    VALUES ($1,$2,$3,$4,$5,$5)
    ON CONFLICT (account_id,jid) DO UPDATE SET
      phone = COALESCE(EXCLUDED.phone, customers.phone),
      name  = COALESCE(EXCLUDED.name,  customers.name),
      last_seen = GREATEST(customers.last_seen, EXCLUDED.last_seen)`,
  [accountId, jid, identity.phone ?? null, identity.name ?? null, seen]).catch(error =>
    log.debug({ code: (error as Error).name }, 'Customer record not upserted'));
}

/** Refresh activity and what the bot has since learned (language, segment). */
export async function enrichCustomer(
  client: PoolClient, accountId: string, jid: string,
  patch: { language?: string; email?: string; segment?: string },
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: string | undefined) => {
    if (value) { sets.push(`${column}=COALESCE($${values.length + 1},${column})`); values.push(value); }
  };
  add('language', patch.language); add('email', patch.email); add('segment', patch.segment);
  if (!sets.length) return;
  await client.query(`UPDATE customers SET ${sets.join(', ')} WHERE account_id=$${values.length + 1} AND jid=$${values.length + 2}`,
    [...values, accountId, jid]).catch(error =>
    log.debug({ code: (error as Error).name }, 'Customer record not enriched'));
}

/** Has this number asked the bot to leave it alone? */
export async function customerOptedOut(client: PoolClient, accountId: string, jid: string) {
  const found = await row<{ opted_out: boolean }>(client,
    'SELECT opted_out FROM customers WHERE account_id=$1 AND jid=$2', [accountId, jid]);
  return found?.opted_out ?? false;
}

export async function setCustomerOptedOut(client: PoolClient, accountId: string, jid: string, out = true) {
  await client.query(`INSERT INTO customers (account_id,jid,opted_out,opted_out_at,last_seen)
    VALUES ($1,$2,$3,CASE WHEN $3 THEN now() ELSE NULL END,now())
    ON CONFLICT (account_id,jid) DO UPDATE SET opted_out=$3,
      opted_out_at=CASE WHEN $3 THEN now() ELSE NULL END, last_seen=now()`,
  [accountId, jid, out]);
}

export type FollowUpKind = 'quote_nudge' | 'payment_reminder' | 'handoff_ping' | 'post_support';

/** Schedule one follow-up, replacing an open one of the same kind for this chat. */
export async function scheduleFollowUp(
  client: PoolClient, input: {
    accountId: string; conversationId: string; jid: string;
    kind: FollowUpKind; body: string; at: Date;
  },
) {
  await client.query(`INSERT INTO follow_ups (account_id,conversation_id,jid,kind,body,scheduled_at)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (conversation_id,kind) WHERE sent_at IS NULL AND canceled_at IS NULL
      DO UPDATE SET body=EXCLUDED.body, scheduled_at=EXCLUDED.scheduled_at`,
  [input.accountId, input.conversationId, input.jid, input.kind, input.body, input.at]).catch(error =>
    log.debug({ code: (error as Error).name }, 'Follow-up not scheduled'));
}

/** A reply that advances the chat makes the queued nudges for those kinds moot. */
export async function cancelFollowUps(
  client: PoolClient, conversationId: string, kinds: FollowUpKind[] = ['quote_nudge', 'payment_reminder', 'handoff_ping', 'post_support'],
) {
  await client.query(`UPDATE follow_ups SET canceled_at=now()
    WHERE conversation_id=$1 AND kind=ANY($2::text[]) AND sent_at IS NULL AND canceled_at IS NULL`,
  [conversationId, kinds]).catch(error =>
    log.debug({ code: (error as Error).name }, 'Follow-ups not canceled'));
}

/** Follow-ups whose time has come, for the worker sweep to enqueue. */
export async function dueFollowUps(client: PoolClient, limit: number) {
  const found = await client.query<{ id: string; account_id: string; conversation_id: string; jid: string; kind: FollowUpKind; body: string; created_at: Date }>(
    `SELECT f.id,f.account_id,f.conversation_id,f.jid,f.kind,f.body,f.created_at
      FROM follow_ups f JOIN conversations c ON c.id=f.conversation_id
      WHERE f.sent_at IS NULL AND f.canceled_at IS NULL AND f.scheduled_at <= now()
      ORDER BY f.scheduled_at,f.id LIMIT $1 FOR NO KEY UPDATE OF c SKIP LOCKED`, [limit]);
  return found.rows;
}

export async function markFollowUpSent(client: PoolClient, id: string) {
  await client.query('UPDATE follow_ups SET sent_at=now() WHERE id=$1', [id]).catch(error =>
    log.debug({ code: (error as Error).name }, 'Follow-up not marked sent'));
}
