import { retryCommercialTurn } from './assistant.js';
import { row, transaction } from './db.js';
import { advanceSale, currentSale } from './sales.js';
import { alertAdmins, customerOptedOut, enqueue, recipient, type Conversation } from './store.js';

interface RetryConversation extends Conversation {
  question: string;
  attempts: number;
  last_inbound_id: string;
  retry_created_at: Date;
}

export function acknowledgesCatalogWait(text: string) {
  return /^(?:(?:sawa|poa|ok|okay|asante|thanks|thank you|nitasubiri|nasubiri)(?:[ ,]+(?:sana|basi|mkuu|boss|kaka|dada|ndugu|nitasubiri|nasubiri|i'll wait))*)[ .!]*$/i.test(text.trim());
}

export async function runCommercialRetry() {
  await transaction(async client => {
    const conversation = await row<RetryConversation>(client, `SELECT c.*, r.question,r.attempts,r.last_inbound_id,
      r.created_at AS retry_created_at
      FROM commercial_retries r JOIN conversations c ON c.id=r.conversation_id
      WHERE r.due_at<=now() AND NOT EXISTS (SELECT 1 FROM messages m
        WHERE m.conversation_id=c.id AND m.processing='pending')
      ORDER BY r.due_at,c.id LIMIT 1 FOR NO KEY UPDATE OF c SKIP LOCKED`);
    if (!conversation) return;
    const { id, account_id: accountId, last_inbound_id: anchor } = conversation;
    const remove = () => client.query('DELETE FROM commercial_retries WHERE conversation_id=$1', [id]);
    const stale = conversation.retry_created_at.getTime() < Date.now() - 8 * 60_000 ||
      conversation.mode !== 'bot' || ['paid', 'completed', 'ready_to_pay', 'payment_reported'].includes(conversation.stage) ||
      !await row(client, 'SELECT 1 FROM accounts WHERE id=$1 AND enabled', [accountId]) ||
      await customerOptedOut(client, accountId, conversation.customer_jid) ||
      await row(client, `SELECT 1 FROM messages WHERE conversation_id=$1 AND direction='inbound'
        AND kind NOT LIKE 'history:%' AND id>$2 LIMIT 1`, [id, anchor]) ||
      await row(client, `SELECT 1 FROM outbound WHERE conversation_id=$1 AND origin='admin' AND created_at>=$2
        AND state IN ('queued','sending','sent','uncertain') LIMIT 1`, [id, conversation.retry_created_at]);
    if (stale) {
      await remove();
      return;
    }
    const { rows: history } = await client.query<{ direction: 'inbound' | 'outbound'; body: string }>(
      `SELECT direction,left(body,700) AS body FROM messages WHERE conversation_id=$1 AND processing='done'
       AND id<$2 ORDER BY id DESC LIMIT 16`, [id, anchor]);
    const outcome = await retryCommercialTurn(client, conversation, conversation.question, history.reverse());
    if (outcome.retryCommercial && conversation.attempts === 0) {
      await client.query(`UPDATE commercial_retries SET attempts=1,due_at=now()+interval '90 seconds'
        WHERE conversation_id=$1`, [id]);
      return;
    }
    await remove();
    const en = (outcome.memory.language ?? conversation.memory.language) === 'en';
    const successfulQuote = outcome.stage === 'quoted' && outcome.body && !outcome.handoff && !outcome.document;
    if (successfulQuote) {
      await client.query('UPDATE conversations SET memory=$2,updated_at=now() WHERE id=$1', [id, outcome.memory]);
      await advanceSale(client, { ...conversation, memory: outcome.memory }, await currentSale(client, id), 'quoted', 'catalog_retry');
    } else {
      await alertAdmins(client, { ...conversation, memory: { ...conversation.memory,
        documentSummary: conversation.question.slice(0, 500) } }, 'Bei au stock inahitaji uthibitisho baada ya ukaguzi');
    }
    const body = successfulQuote
      ? (en ? 'I checked again and found the current details.' : 'Nimekagua tena na nimepata taarifa za sasa.') + '\n\n' + outcome.body
      : en ? 'The latest details still aren’t available. I’ve asked our sales team to check your original request.'
        : 'Taarifa za sasa bado hazipatikani. Nimepeleka ombi lako la awali kwa timu ya mauzo ilikague.';
    await enqueue(client, { accountId, conversationId: id, jid: recipient(conversation),
      origin: 'bot', body: body.slice(0, 3600), requestKey: 'catalog-retry:' + anchor,
      imageUrl: successfulQuote ? outcome.imageUrl : undefined, replyAnchor: anchor });
  });
}
