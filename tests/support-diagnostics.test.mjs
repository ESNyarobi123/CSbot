import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
const key = 'f'.repeat(64);
process.env.WOTEFY_DIAGNOSTICS_KEY = key;
process.env.WOTEFY_DIAGNOSTICS_URL = 'https://provider.example.test/diagnostics';
process.env.LUBFY_DIAGNOSTICS_KEY = 'e'.repeat(64);
process.env.LUBFY_DIAGNOSTICS_URL = 'https://other.example.test/diagnostics';
const { authorizedDiagnostic, diagnosticReport } = await import('../dist/support-diagnostics.js');

const now = Date.parse('2026-11-27T12:00:00Z');
const report = { ticket: 'A'.repeat(43), system: 'wotefy', accountProof: 'a'.repeat(64),
  checkedAt: new Date(now).toISOString(), online: 2, offline: 1, unknown: 0 };

function signature(details) {
  return createHmac('sha256', key).update([
    'report-v1', details.ticket, details.system, details.accountProof, details.checkedAt,
    details.online, details.offline, details.unknown,
  ].join('\n')).digest('hex');
}

test('only a recent signed snapshot for the specific provider is accepted', () => {
  const signed = signature(report);
  assert.equal(authorizedDiagnostic(diagnosticReport.parse(report), signed, now), true);
  assert.equal(authorizedDiagnostic({ ...report, offline: 0 }, signed, now), false);
  const wrongProvider = { ...report, system: 'lubfy' };
  assert.equal(authorizedDiagnostic(wrongProvider, signature(wrongProvider), now), false);
  assert.equal(authorizedDiagnostic(report, signed, now + 6 * 60_000), false);
  assert.equal(authorizedDiagnostic(report, 'x'.repeat(64), now), false);
  assert.equal(diagnosticReport.safeParse({ ...report, email: 'someone@example.test' }).success, false);
});
