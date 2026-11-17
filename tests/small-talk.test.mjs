import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.GEMINI_API_KEY;
delete process.env.CSOLUTION_POS_DB_URL;

const { respond, smallTalkOnly } = await import('../dist/assistant.js');

const client = { query: async () => ({ rows: [] }) };
const chat = (memory = {}) => ({ id: 1, stage: 'inquiry', memory });

test('a bare greeting is recognized as small talk', () => {
  for (const text of ['mambo', 'Mambo!', 'vipi', 'vpp', 'habari', 'habari yako', 'shikamoo',
    'poa', 'safi sana', 'hi', 'hello', 'good morning', 'sasa', 'mambo vipi']) {
    assert.equal(smallTalkOnly(text), true, text);
  }
});

test('a real request is never mistaken for small talk', () => {
  for (const text of ['bei ya EAP 650', 'nahitaji mfumo wa wifi', 'portal haifunguki',
    'nataka installation', 'nimeshalipa', 'naomba mhudumu', 'mambo, bei ya EAP 650 ni ngapi']) {
    assert.equal(smallTalkOnly(text), false, text);
  }
});

test('mambo is answered in kind, without pitching equipment', async () => {
  const reply = await respond(client, chat(), 'mambo', []);
  assert.match(reply.body, /^Mambo!/);
  assert.doesNotMatch(reply.body, /kifaa tayari|Wi-Fi billing|kuchagua mfumo/i);
});

test('the greeting is mirrored, not replaced with one canned line', async () => {
  const shikamoo = await respond(client, chat(), 'shikamoo', []);
  assert.match(shikamoo.body, /^Marahaba!/);

  const habari = await respond(client, chat(), 'habari', []);
  assert.match(habari.body, /^Habari!/);

  const thanks = await respond(client, chat(), 'asante', []);
  assert.match(thanks.body, /Karibu sana/);
});

test('English small talk uses English', async () => {
  const reply = await respond(client, chat(), 'hi', []);
  assert.match(reply.body, /Hey|Hello|Welcome/);
});

test('a greeting after a live quote does not reset the conversation', async () => {
  const memory = { lastQuote: 'TP LINK EAP 650 — TZS 450,000', product: { id: 'eap650', name: 'TP LINK EAP 650' } };
  const reply = await respond(client, chat(memory), 'poa', []);
  assert.doesNotMatch(reply.body, /^Vizuri!/);
});

test('location and hours come from knowledge, never from generation', async () => {
  const rows = [{ content: 'Ofisi iko Sinza Makaburini, Dar es Salaam.' }];
  const withKnowledge = { query: async () => ({ rows }) };
  const where = await respond(withKnowledge, chat(), 'unaishi wapi?', []);
  assert.match(where.body, /Sinza/);
  assert.doesNotMatch(where.body, /Nairobi/i);

  const hours = await respond(withKnowledge, chat(), 'mnafanya kazi wikiendi?', []);
  assert.match(hours.body, /Sinza/);
});

test('"inapatikana wapi" asks where the office is, not whether a product is in stock', async () => {
  const rows = [{ content: 'Ofisi iko Sinza Makaburini, Dar es Salaam.' }];
  const withKnowledge = { query: async () => ({ rows }) };
  for (const text of ['Ofisi yenu inapatikana wapi', 'Ofisi yenu inapatikana wapi?',
    'ofisini kwenu ni wapi', 'je kuna ofisi sehemu nyingine', 'mko wapi']) {
    const reply = await respond(withKnowledge, chat(), text, []);
    assert.match(reply.body, /Sinza/, text);
    assert.doesNotMatch(reply.body, /Sijaipata|POS/i, text);
  }
});

test('a product availability question still goes to the catalog', async () => {
  const rows = [{ content: 'Ofisi iko Sinza Makaburini, Dar es Salaam.' }];
  const withKnowledge = { query: async () => ({ rows }) };
  const reply = await respond(withKnowledge, chat(), 'EAP 650 inapatikana?', []);
  assert.doesNotMatch(reply.body, /Sinza/);
});
