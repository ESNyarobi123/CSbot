import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL = 'postgres://localhost/csbot';
delete process.env.DEEPSEEK_API_KEY;
delete process.env.POS_BASE_URL;
delete process.env.CSOLUTION_POS_DB_URL;
delete process.env.CSOLUTION_QUOTATION_URL;
const { customerTurn, relevantKnowledge } = await import('../dist/assistant.js');
const client = { query: async () => ({ rows: [] }) };
const turn = (text, memory = {}) => customerTurn(client, { id: 'playground', stage: 'inquiry', memory }, text, []);

test('ad DMs ask which kind of help the customer needs before presenting products', async () => {
  const outcome = await turn('Nimeona tangazo lenu, naomba maelezo zaidi');
  assert.match(outcome.body, /mfumo wa kuuza Wi-Fi.*ushauri wa vifaa.*msaada/);
  assert.equal(outcome.stage, undefined);
});

test('offline support remembers the symptom across a platform alias and alerts with the check result', async () => {
  const first = await turn('Naona imejirudia kifaa kimekuwa offline');
  assert.match(first.body, /WoteFy au LubFy/);
  const second = await turn('SSDomada', first.memory);
  assert.match(second.body, /Omada Controller/);
  assert.equal(second.memory.support.waitingFor, 'check');
  const third = await turn('Bado offline kwenye Omada', second.memory);
  assert.equal(third.handoff, true);
  assert.equal(third.memory.lastSupport.system, 'wotefy');
  assert.match(third.memory.lastSupport.checkResult, /Bado offline/);
});

test('LubFy Free Trial complaint gets a focused check and can be closed by the customer', async () => {
  const first = await turn('LubFy, wateja wakibonyeza free trial haiwa connect');
  assert.match(first.body, /Free Trial/);
  assert.equal(first.memory.support.waitingFor, 'check');
  assert.doesNotMatch(first.body, /email|Omada/);
  const second = await turn('Sasa iko sawa', first.memory);
  assert.equal(second.memory.support, undefined);
  assert.equal(second.handoff, undefined);
});

test('support retrieval cannot offer another platform’s article', () => {
  const entries = [{ id: 'wotefy-portal', system: 'wotefy', title: 'Portal redirect',
    content: 'Portal haitokei', source_url: null }];
  assert.equal(relevantKnowledge('portal haitokei', entries, true, 'lubfy'), undefined);
});

test('sales receives the right item and count when the customer requests an invoice over two turns', async () => {
  const memory = { quoteFor: 'product', product: { id: 'product-1', name: 'EAP 650' },
    lastSupport: { system: 'lubfy', problem: 'Kifaa offline' } };
  const first = await turn('Naomba invoice ya hiyo', memory);
  assert.match(first.body, /EAP 650 ngapi/);
  const second = await turn('mbili', first.memory);
  assert.equal(second.handoff, true);
  assert.equal(second.stage, undefined);
  assert.match(second.alertTitle, /invoice/);
  assert.equal(second.memory.documentSummary, 'EAP 650 × 2');
});

test('a payment that did not unlock portal access is technical support, not a device payment', async () => {
  const outcome = await turn('LubFy nimelipa lakini internet bado haijafunguka',
    { quoteFor: 'product', product: { id: 'router', name: 'Cudy WR3000' } });
  assert.match(outcome.body, /status.*portal/);
  assert.equal(outcome.stage, undefined);
  assert.equal(outcome.memory.support.waitingFor, 'check');
});

test('customer and admin see the reported symptom, platform and email on separate WhatsApp lines', async () => {
  const first = await turn('Hivi mbona vifaa vyabgu vina waka na kuzima shida ni mfumo au');
  assert.match(first.body, /WoteFy au LubFy/);
  const second = await turn('Wotefy mkuu', first.memory);
  assert.match(second.body, /email/i);
  const final = await turn('mteja@example.test', second.memory);
  assert.equal(final.handoff, true);
  assert.equal(final.supportAlert, 'handoff');
  assert.match(final.body, /\*Mfumo\* WoteFy\n\*Changamoto\* Vifaa vinawaka na kuzima\.\n\*Email ya akaunti\* mteja@example\.test/);
  assert.match(final.body, /\*Hatua inayofuata\*\nTimu ya support/);

  const { alertAdmins } = await import('../dist/store.js');
  const queries = [];
  const adminClient = { query: async (sql, args) => {
    queries.push({ sql, args });
    return { rows: sql.includes('FROM admin_numbers') ? [{ phone: '255700100001' }] : [] };
  } };
  await alertAdmins(adminClient, {
    id: '123', account_id: 'channel', customer_name: 'Mteja wa jaribio',
    customer_phone: '255700100002', memory: final.memory,
  }, 'Mazungumzo yanahitaji mhudumu', undefined, final.supportAlert);
  assert.deepEqual(queries[0].args, ['channel']);
  const [, , jid, text, origin] = queries[1].args;
  assert.equal(jid, '255700100001@s.whatsapp.net');
  assert.equal(origin, 'alert');
  assert.match(text, /\*Hali\* Inasubiri mhudumu\n\*Mazungumzo\* #123\n\*Mteja\* Mteja wa jaribio/);
  assert.ok(text.includes('*Email ya akaunti* mteja@example.test'));
  assert.match(text, /kagua akaunti kwenye WoteFy/);
});

test('the admin guidance template distinguishes self-help and keeps screenshot alerts readable', async () => {
  const { supportAdminMessage } = await import('../dist/support.js');
  const message = supportAdminMessage({ id: '123', customer_name: null },
    { system: 'lubfy', problem: 'Z'.repeat(500), checkResult: 'R'.repeat(280) }, 'guidance', true);
  assert.match(message, /Mteja amepewa hatua za ukaguzi/);
  assert.match(message, /\*Email ya akaunti\* Haijatolewa/);
  assert.match(message, /\*Matokeo ya ukaguzi\* R/);
  assert.match(message, /Picha ya mteja/);
  assert.ok(message.length < 1000);
});
