import assert from 'node:assert/strict';
import { test } from 'node:test';

// Memory is what makes a returning customer feel recognised: the site facts and
// the last device survive the chat, the dashboard shows them, and the composer
// is not told about a model the customer never claimed to own.
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.GEMINI_API_KEY;
delete process.env.POS_BASE_URL;
delete process.env.CSOLUTION_POS_DB_URL;

const { factBrief, factList } = await import('../dist/brain.js');
const { respond } = await import('../dist/assistant.js');

const conversation = (memory) => ({
  id: '1', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
  mode: 'bot', stage: 'inquiry', unread_count: 0, last_body: null, last_at: null, memory,
});

/** A client that only remembers: every other read comes back empty. */
const memoryClient = (facts) => ({
  query: async (sql) => (/customer_memory/.test(sql) && /SELECT/i.test(sql) ? { rows: [{ facts }] } : { rows: [] }),
});

test('the last model is kept for the dashboard but never offered as a site fact', () => {
  const facts = { coverage_m: '300', last_model: 'TP LINK EAP 650' };
  assert.ok(factList(facts).some((fact) => fact.label === 'Last model discussed'));
  assert.doesNotMatch(factBrief(facts), /last_model/);
  assert.match(factBrief(facts), /coverage_m: 300/);
});

test('a returning customer is greeted with the thread they left open', async () => {
  const outcome = await respond(memoryClient({ last_model: 'TP LINK EAP 650' }), conversation({}), 'Habari', []);
  assert.match(outcome.body, /Tulikuwa tunaangalia TP LINK EAP 650/);
});

test('a first-time greeting does not invent a previous conversation', async () => {
  const outcome = await respond(memoryClient({}), conversation({}), 'Habari', []);
  assert.doesNotMatch(outcome.body, /Tulikuwa tunaangalia/);
});
