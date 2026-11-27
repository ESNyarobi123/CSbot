import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
process.env.DEEPSEEK_API_KEY = 'learning-fixture';
const { learningSignal, learningExcerpt, reusableKnowledgeQuestion, writeKnowledgeReply } = await import('../dist/learning.js');
const { changesCustomerSite, withoutSiteFacts } = await import('../dist/brain.js');

test('reusable technical explanations leave rates, balances and personal setups out', () => {
  assert.equal(reusableKnowledgeQuestion('Mesh ni nini?'), true);
  assert.equal(reusableKnowledgeQuestion('What is the price of Omada Mesh?'), false);
  assert.equal(reusableKnowledgeQuestion('Mesh inafanyaje kazi kwenye site yangu?'), false);
});

test('an approved answer is cached only for the same chat and current article contents', async (t) => {
  const entries = new Map();
  const client = { query: async (sql, [chat, hash, content]) => {
    const key = chat + ':' + hash;
    if (/SELECT answer/.test(sql)) return { rows: entries.has(key) ? [{ answer: entries.get(key) }] : [] };
    entries.set(key, content);
    return { rows: [] };
  } };
  const api = t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{
    finish_reason: 'stop', message: { content: JSON.stringify({
      answer: 'Mesh inaunganisha AP zinazotumika pamoja.', confidence: 0.9,
    }) },
  }] }));
  const input = { question: 'Mesh ni nini?', facts: 'Mesh huunganisha AP zinazotumika pamoja.', language: 'sw' };
  await writeKnowledgeReply(client, '1', 'mesh', input);
  assert.ok((await writeKnowledgeReply(client, '1', 'mesh', { ...input, question: 'mesh ni nini' })).cached);
  await writeKnowledgeReply(client, '2', 'mesh', input);
  await writeKnowledgeReply(client, '1', 'mesh', { ...input, facts: 'Article was updated.' });
  assert.equal(api.mock.callCount(), 3);
});

test('feedback is recognized with contact details removed and a new site starts with fresh requirements', () => {
  assert.equal(learningSignal('Naomba muongeze chaguo la kuweka maelezo ya vifaa'), 'suggestion');
  assert.equal(learningSignal('Hunielewi, nilichouliza ni kuhusu waya'), 'correction');
  assert.equal(learningSignal('Bei ya AP ni ngapi?'), undefined);
  assert.equal(learningExcerpt('email mtu@example.test namba +255 626 632 015 OTP: 123456'), 'email [email] namba [number] [credential]');
  assert.equal(changesCustomerSite('Kwenye site yangu mpya'), true);
  assert.deepEqual(withoutSiteFacts({ coverage_m: '1000', town: 'Kigoma', place: 'outdoor', last_model: 'EAP225' }),
    { last_model: 'EAP225' });
});
