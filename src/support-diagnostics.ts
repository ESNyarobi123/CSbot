import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config } from './config.js';
import { systemLabel } from './customer-text.js';
import { row } from './db.js';
import { alertAdmins, customerOptedOut, enqueue, recipient, type Conversation } from './store.js';

const system = z.enum(['wotefy', 'lubfy']);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const keyedDigest = (key: string, value: string) => createHmac('sha256', key).update(value).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function integration(name: z.infer<typeof system>) {
  const address = name === 'wotefy' ? config.WOTEFY_DIAGNOSTICS_URL : config.LUBFY_DIAGNOSTICS_URL;
  const key = name === 'wotefy' ? config.WOTEFY_DIAGNOSTICS_KEY : config.LUBFY_DIAGNOSTICS_KEY;
  if (!address || !key || !/^[a-f0-9]{64}$/.test(key) ||
    config.WOTEFY_DIAGNOSTICS_KEY === config.LUBFY_DIAGNOSTICS_KEY) return;
  const parsed = z.url({ protocol: /^https$/ }).safeParse(address);
  if (!parsed.success) return;
  const url = new URL(parsed.data);
  if (url.username || url.password || url.hash) return;
  return { url, key };
}

const counts = z.number().int().min(0).max(100000);
export const diagnosticReport = z.strictObject({
  ticket: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
  system,
  accountProof: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.iso.datetime(),
  online: counts,
  offline: counts,
  unknown: counts,
});
type Report = z.infer<typeof diagnosticReport>;

export function authorizedDiagnostic(report: Report, signature: string | undefined, now = Date.now()) {
  const settings = integration(report.system);
  if (!settings || !signature || !/^[a-f0-9]{64}$/.test(signature) ||
      Math.abs(now - Date.parse(report.checkedAt)) > 5 * 60_000) return false;
  const body = [report.ticket, report.system, report.accountProof, report.checkedAt,
    report.online, report.offline, report.unknown].join('\n');
  return same(keyedDigest(settings.key, 'report-v1\n' + body), signature);
}

export async function offerDiagnostic(client: PoolClient, conversation: Conversation) {
  const memory = conversation.memory;
  const support = memory.lastSupport;
  if (!support?.system || !support.email || !support.problem) return;
  const settings = integration(support.system);
  if (!settings) return;
  const previous = memory.diagnosticRequest;
  if (previous?.system === support.system && previous.email === support.email &&
      previous.problem === support.problem && Date.parse(previous.expiresAt) > Date.now()) return;
  const ticket = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const proof = keyedDigest(settings.key, 'account-v1\n' + support.email.trim().toLowerCase());
  const request = await row<{ id: string }>(client, `INSERT INTO support_diagnostic_requests
    (conversation_id,system,ticket_hash,account_proof,expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
  [conversation.id, support.system, digest(ticket), proof, expiresAt]);
  if (!request) return;
  memory.diagnosticRequest = { id: request.id, expiresAt, system: support.system,
    email: support.email, problem: support.problem };
  settings.url.searchParams.set('ticket', ticket);
  const label = systemLabel(support.system);
  return memory.language === 'en'
    ? `To share the device status with support, sign in to ${label} using this link and approve the check. The link expires in 15 minutes.\n${settings.url}`
    : `Kushiriki hali ya vifaa na support, ingia kwenye ${label} kupitia kiungo hiki kisha ruhusu ukaguzi. Kiungo kinaisha baada ya dakika 15.\n${settings.url}`;
}

export async function recordDiagnostic(client: PoolClient, report: Report) {
  const request = await row<{ id: string; conversation_id: string; account_proof: string }>(client, `SELECT id,conversation_id,account_proof
    FROM support_diagnostic_requests WHERE ticket_hash=$1 AND system=$2 AND expires_at>now() AND consumed_at IS NULL`,
  [digest(report.ticket), report.system]);
  if (!request || !same(request.account_proof, report.accountProof)) return false;
  const conversation = await row<Conversation>(client, `SELECT c.* FROM conversations c JOIN accounts a ON a.id=c.account_id
    WHERE c.id=$1 AND a.enabled FOR NO KEY UPDATE OF c`, [request.conversation_id]);
  const memory = conversation?.memory;
  const support = memory?.lastSupport;
  const active = memory?.diagnosticRequest;
  if (!conversation || !memory || !support || active?.id !== request.id ||
      support.system !== report.system || support.email !== active.email || support.problem !== active.problem ||
      ['resolution_queued', 'awaiting_confirmation', 'resolved'].includes(memory.supportUpdate?.status ?? '') ||
      await customerOptedOut(client, conversation.account_id, conversation.customer_jid)) return false;
  const consumed = await row(client, `UPDATE support_diagnostic_requests SET consumed_at=now()
    WHERE id=$1 AND expires_at>now() AND consumed_at IS NULL RETURNING id`, [request.id]);
  if (!consumed) return false;

  const check = `${systemLabel(report.system)} · Online ${report.online} · Offline ${report.offline} · Hali haijulikani ${report.unknown}`;
  support.verifiedCheck = { summary: check, checkedAt: report.checkedAt };
  await client.query('UPDATE conversations SET memory=$2,updated_at=now() WHERE id=$1', [conversation.id, memory]);
  await alertAdmins(client, conversation, 'Ukaguzi wa vifaa umepokelewa', undefined, 'handoff');
  await enqueue(client, { accountId: conversation.account_id, conversationId: conversation.id, jid: recipient(conversation),
    origin: 'handoff', requestKey: 'support-check:' + request.id,
    body: memory.language === 'en'
      ? `The device check found ${report.online} online, ${report.offline} offline, and ${report.unknown} with unknown status. Support can review these results in your case.`
      : `Ukaguzi umeonyesha vifaa ${report.online} viko online, ${report.offline} viko offline na ${report.unknown} havina hali iliyothibitishwa. Timu inaweza kuona matokeo haya kwenye kesi yako.`,
  });
  return true;
}
