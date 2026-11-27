import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { compose, type ComposeInput } from './brain.js';
import { row } from './db.js';
import type { Conversation } from './store.js';

const volatile = /\b(?:bei|gharama|how much|price|cost|stock|ipo|available|availability|invoice|ankara|proforma|malipo|payment|paid|kulipa|kulipia|punguzo|discount|sale|order|oda|plan|package|kifurushi|subscription|subscription fee|warranty|dhamana|tzs|tsh|usd)\b/i;
const personalContext = /\b(?:yangu|vyangu|kwangu|nitumie|hiyo|ile|my|mine|here|that one|password|nenosiri|otp)\b/i;
const technicalDefinition = /\b(?:ni nini|inafanyaje kazi|inafanya kazi vipi|maana ya|what is|what are|how does|difference between|tofauti kati ya)\b/i;

export function reusableKnowledgeQuestion(question: string) {
  return technicalDefinition.test(question) && !volatile.test(question) && !personalContext.test(question) &&
    !/\d|@|https?:\/\//i.test(question) && question.length <= 280;
}

function overviewHash(input: ComposeInput, article: string) {
  return createHash('sha256').update(JSON.stringify(['knowledge-reply-v1', article, input.language,
    input.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), input.facts])).digest('hex');
}

export async function writeKnowledgeReply(
  client: PoolClient, conversationId: string | undefined, article: string, input: ComposeInput,
) {
  if (!conversationId || !reusableKnowledgeQuestion(input.question) || volatile.test(input.facts)) return compose(input);
  const independent = { ...input, context: undefined, goal: undefined };
  const fingerprint = overviewHash(independent, article);
  const previous = await row<{ answer: string }>(client, `SELECT answer FROM knowledge_reply_cache
    WHERE conversation_id=$1 AND fingerprint=$2 AND expires_at > now()`, [conversationId, fingerprint]);
  if (previous) return { answer: previous.answer, cached: true };
  const written = await compose(independent);
  if (written && written.confidence >= 0.7 && !volatile.test(written.answer) &&
    learningExcerpt(written.answer) === written.answer) {
    await client.query(`INSERT INTO knowledge_reply_cache (conversation_id,fingerprint,answer)
      VALUES ($1,$2,$3) ON CONFLICT (conversation_id,fingerprint) DO UPDATE
      SET answer=EXCLUDED.answer,expires_at=EXCLUDED.expires_at WHERE knowledge_reply_cache.expires_at<=now()`,
    [conversationId, fingerprint, written.answer]);
  }
  return written;
}

export function learningSignal(text: string): 'correction' | 'suggestion' | undefined {
  if (/\b(?:hunielewi|haunielewi|hujanielewa|sijakuuliza|nilichouliza|that(?:'s| is) not what i asked|you misunderstood)\b/i.test(text)) return 'correction';
  if (/\b(?:pendekezo langu|naomba muongeze|ningependekeza muongeze|mkiweka feature|feature request|i suggest adding|you should add)\b/i.test(text)) return 'suggestion';
}

export function learningExcerpt(text: string) {
  return text
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '[email]')
    .replace(/(?<!\w)\+?\d(?:[ .()-]*\d){7,}\b/g, '[number]')
    .replace(/\b(?:password|nenosiri|pin|otp|token|api[ -]?key)\b\s*[:=]?\s*\S+/gi, '[credential]')
    .replace(/\s+/g, ' ').trim().slice(0, 500);
}

export async function queueKnowledgeReview(client: PoolClient, conversation: Conversation,
  messageId: string, kind: 'suggestion' | 'correction' | 'resolved', sample: string) {
  const filtered = learningExcerpt(sample);
  if (!filtered) return;
  await client.query(`INSERT INTO knowledge_review_items (conversation_id,message_id,kind,system,sample)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [
    conversation.id, messageId, kind, conversation.memory.lastSupport?.system ?? conversation.memory.system ?? 'general', filtered,
  ]);
}
