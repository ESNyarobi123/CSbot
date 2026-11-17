import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { log, row, transaction } from './db.js';

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
    system?: 'wotefy' | 'lubfy';
    product?: { id: string; name: string };
    lastQuote?: string;
    plan?: { kind?: 'subscription' | 'wifi' | 'bundle'; site?: string };
    productOptions?: { id: string; name: string; sku?: string; price?: string; coverage?: number }[];
    /** The query behind productOptions, so "model zingine?" can widen the list. */
    optionQuery?: string;
    quoteFor?: 'product' | 'plan';
    /** Set while the bot waits for "yes" to its installation/cable offer. */
    awaitingService?: boolean;
    /** Support intake: the problem, the system, and the login email. */
    support?: { problem?: string; system?: 'wotefy' | 'lubfy'; email?: string };
    /** Last completed support intake, kept for the admin alert and audits. */
    lastSupport?: { problem?: string; system?: 'wotefy' | 'lubfy'; email?: string };
    recentTopic?: string;
    profile?: { equipment?: string; budget?: string; useCase?: string };
  };
}

export interface Incoming {
  accountId: string;
  providerId: string;
  jid: string;
  alternateJid?: string;
  name?: string;
  body: string;
  kind: string;
  occurredAt: Date;
  fromMe?: boolean;
  historical?: boolean;
  sessionVersion?: number;
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
      [accountId, phone])) return;
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

export async function setMode(client: PoolClient, id: string, mode: Conversation['mode']) {
  await client.query(`UPDATE conversations SET mode=$2,
    human_since=CASE WHEN $2='human' THEN now() ELSE NULL END, updated_at=now() WHERE id=$1`, [id, mode]);
  if (mode === 'human') {
    await client.query(`UPDATE outbound SET state='canceled',reason='human_takeover'
      WHERE conversation_id=$1 AND origin IN ('bot','handoff') AND state IN ('queued','sending')`, [id]);
    await client.query("UPDATE messages SET auto_reply=false WHERE conversation_id=$1 AND processing='pending'", [id]);
  }
}

export async function enqueue(client: PoolClient, item: {
  accountId: string; conversationId: string; jid: string; body: string;
  origin: 'bot' | 'admin' | 'alert' | 'handoff'; imageUrl?: string; requestKey?: string;
}) {
  const providerId = '3EB0' + randomBytes(10).toString('hex').toUpperCase();
  return row(client, `INSERT INTO outbound (account_id, conversation_id, jid, body, origin, image_url, provider_id, request_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (conversation_id,request_key) DO NOTHING RETURNING id,state`,
  [item.accountId, item.conversationId, item.jid, item.body, item.origin, item.imageUrl ?? null, providerId,
    item.requestKey ?? null]);
}

export function recipient(conversation: Conversation) {
  return conversation.customer_jid;
}

export async function alertAdmins(
  client: PoolClient, conversation: Conversation, title: string, imageUrl?: string,
) {
  const { id, account_id: accountId, memory } = conversation;
  const admins = await client.query<{ phone: string }>('SELECT phone FROM admin_numbers WHERE account_id=$1', [accountId]);
  if (!admins.rows.length) {
    log.warn({ conversation: id, account: accountId }, 'No admin number configured for this account');
    return;
  }
  const customer = [conversation.customer_name, conversation.customer_phone, `chat #${id}`].filter(Boolean).join(' · ');
  const support = memory.lastSupport;
  const subject = support?.system
    ? `Msaada wa kiufundi · ${support.system === 'wotefy' ? 'WoteFy' : 'LubFy'}`
    : (memory.quoteFor === 'plan' ? memory.system : memory.product?.name ?? memory.system)
      ?? 'Bidhaa au huduma inahitaji kufafanuliwa';
  const detail = [
    support?.problem && 'Tatizo: ' + support.problem,
    support?.email && 'Email ya akaunti: ' + support.email,
    !support && memory.lastQuote && 'Bei ya kumbukumbu: ' + memory.lastQuote,
    !support && memory.recentTopic?.slice(0, 280),
  ].filter(Boolean).join('\n');
  for (const admin of admins.rows) {
    await enqueue(client, { accountId, conversationId: id, jid: admin.phone + '@s.whatsapp.net',
      body: `CSbot — ${title}\n${customer}\n${subject}${detail ? '\n' + detail : ''}`, origin: 'alert', imageUrl });
  }
}
