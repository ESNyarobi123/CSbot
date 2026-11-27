import type { PoolClient } from 'pg';
import { db, row } from './db.js';
import { alertAdmins, stages, type Conversation, type Stage } from './store.js';

interface Quote {
  text: string;
  kind?: 'product' | 'plan';
  product?: Conversation['memory']['product'];
  system?: Conversation['memory']['system'];
}

export interface Sale {
  id: string;
  conversation_id: string;
  stage: Stage;
  quote: Quote | null;
  opened_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

const fields = 'id,conversation_id,stage,quote,opened_at,updated_at,closed_at';
export const currentSale = (client: typeof db | PoolClient, id: string) =>
  row<Sale>(client, `SELECT ${fields} FROM sales WHERE conversation_id=$1 ORDER BY id DESC LIMIT 1`, [id]);

export async function salesHistory(conversationId: string, before: string | null, limit: number) {
  return (await db.query<Sale>(`SELECT ${fields} FROM sales
    WHERE conversation_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`,
  [conversationId, before, limit])).rows;
}

export const saleByRequest = (client: PoolClient, id: string, requestKey: string) =>
  row<Sale>(client, `SELECT ${fields} FROM sales WHERE conversation_id=$1 AND request_key=$2`, [id, requestKey]);

// Call with the conversation row locked. Keep the stage projection and the order ledger in the same transaction.
export async function openSale(client: PoolClient, conversation: Conversation, reason: string, requestKey?: string) {
  const sale = (await row<Sale>(client, `INSERT INTO sales (conversation_id,stage,request_key)
    VALUES ($1,'inquiry',$2) RETURNING ${fields}`, [conversation.id, requestKey ?? null]))!;
  await client.query("UPDATE conversations SET stage='inquiry',updated_at=now() WHERE id=$1", [conversation.id]);
  await client.query('INSERT INTO sales_events (sale_id,conversation_id,stage,reason) VALUES ($1,$2,$3,$4)',
    [sale.id, conversation.id, 'inquiry', reason]);
  return sale;
}

export function withoutQuote(memory: Conversation['memory']): Conversation['memory'] {
  const { lastQuote, quoteFor, product, productOptions, optionQuery, lastOptionIds, awaitingService, plan, documentRequest, documentSummary, lastDocument, posQuotation, installationQuote, ...context } = memory;
  return context;
}

export async function advanceSale(
  client: PoolClient, conversation: Conversation, sale: Sale | undefined, stage: Stage, reason: string, receiptId?: string,
) {
  if (sale?.closed_at) {
    if (stage !== 'quoted') return sale;
    sale = undefined;
  }
  sale ??= await openSale(client, conversation, reason);
  const current = stages.indexOf(sale.stage);
  const next = stages.indexOf(stage);
  const memory = conversation.memory;
  const refreshQuote = (stage === 'quoted' && current <= next) || (stage === 'ready_to_pay' && current < next);
  const quote: Quote | null = memory.lastQuote && refreshQuote
    ? { text: memory.lastQuote, kind: memory.quoteFor,
      product: memory.quoteFor === 'plan' ? undefined : memory.product, system: memory.system }
    : sale.quote;
  if (next <= current && quote === sale.quote) return sale;
  const effectiveStage = next > current ? stage : sale.stage;
  const updated = (await row<Sale>(client, `UPDATE sales SET stage=$2,quote=$3,
    closed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END,updated_at=now()
    WHERE id=$1 RETURNING ${fields}`, [sale.id, effectiveStage, quote]))!;
  await client.query('UPDATE conversations SET stage=$2,updated_at=now() WHERE id=$1', [conversation.id, effectiveStage]);
  if (next <= current) return updated;

  await client.query('INSERT INTO sales_events (sale_id,conversation_id,stage,reason) VALUES ($1,$2,$3,$4)',
    [sale.id, conversation.id, stage, reason]);
  if (stage === 'ready_to_pay' || stage === 'payment_reported') {
    const event = await row(client, `INSERT INTO sales_alerts (sale_id,conversation_id,stage)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING stage`, [sale.id, conversation.id, stage]);
    if (event) {
      const title = stage === 'ready_to_pay' ? 'Mteja yuko tayari kulipa' : 'Mteja ameripoti malipo. Thibitisha.';
      const alertMemory = { ...withoutQuote(memory), lastSupport: undefined, support: undefined, documentSummary: memory.documentSummary, lastQuote: updated.quote?.text, product: updated.quote?.product,
        quoteFor: updated.quote?.kind, system: updated.quote?.system ?? memory.system };
      await alertAdmins(client, { ...conversation, memory: alertMemory }, `${title} · Oda #${sale.id}`,
        receiptId ? `csbot-media:${receiptId}` : undefined);
    }
  }
  return updated;
}
