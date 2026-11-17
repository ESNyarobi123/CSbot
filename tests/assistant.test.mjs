import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
const { customerProfile, resolveDecision } = await import('../dist/assistant.js');
const { publicSubscriptionPlans } = await import('../dist/pos.js');

test('short Kiswahili follow-ups retain the exact product and ask about ambiguous packages', () => {
  const product = { id: 'test', name: 'Cudy WR3000' };
  assert.equal(resolveDecision('bei ya ile?', { product }).query, '');
  assert.equal(resolveDecision('bei ya Cudy\nWR3000 ipo?', {}).query, 'Cudy WR3000');
  assert.equal(resolveDecision('package bei gani?', {}).intent, 'ambiguous_package');
  const choice = resolveDecision('LubFy', { plan: { kind: 'subscription' } });
  assert.deepEqual([choice.intent, choice.kind, choice.system], ['plan', 'subscription', 'lubfy']);
});

test('asking to pay and claiming payment are separate intents', () => {
  assert.equal(resolveDecision('Naomba namba ya kulipia', {}).intent, 'ready_to_pay');
  assert.equal(resolveDecision('Nimelipa leo', {}).intent, 'payment_reported');
  assert.notEqual(resolveDecision('Bado sijalipa', {}).intent, 'payment_reported');
});

test('saved customer details survive unrelated messages and update from new statements', () => {
  const memory = customerProfile('Nina Cudy WR3000. Bajeti yangu ni TSh 200,000. Nataka hotspot ya wageni.', undefined);
  assert.deepEqual(memory, { equipment: 'Nina Cudy WR3000.', budget: 'Bajeti yangu ni TSh 200,000.',
    useCase: 'Nataka hotspot ya wageni.' });
  assert.deepEqual(customerProfile('My budget is 100,000?', memory), memory);
  assert.deepEqual(customerProfile('Natumia Omada EAP610 sasa.', memory), { ...memory, equipment: 'Natumia Omada EAP610 sasa.' });
});

test('a hypothetical or negative payment statement cannot be turned into a payment report by the model', () => {
  const generated = { intent: 'payment_reported', language: 'sw', query: '', system: '',
    kind: '', site: '', reply: '', sendImage: false };
  assert.notEqual(resolveDecision('Nikisema nimelipa, nini kitafanyika?', {}, generated).intent, 'payment_reported');
  assert.notEqual(resolveDecision('I have not paid', {}, generated).intent, 'payment_reported');
});

test('WoteFy prices are in major units and LubFy prices are in minor units', () => {
  const wotefy = publicSubscriptionPlans('wotefy', { success: true, data: [{
    name: 'A', price: 15000, currency: 'TZS', interval: 'MONTHLY', maxSites: 1, maxDevices: 1, isActive: true,
  }] });
  const lubfy = publicSubscriptionPlans('lubfy', { items: [{
    display_name: 'B', amount_minor: 1500000, currency: 'TZS', billing_interval: 'MONTHLY', status: 'ACTIVE',
  }, {
    display_name: 'Archived', amount_minor: 2000, currency: 'TZS', billing_interval: 'MONTHLY', status: 'RETIRED',
  }] });
  assert.equal(lubfy.length, 1);
  assert.deepEqual(wotefy[0].price, lubfy[0].price);
});

test('a bare model is a price request, not small talk', async () => {
  const { isModelReference, modelQuery } = await import('../dist/pos.js');
  // Customers open with the model only: "AP 650", "eap 650 bei yake".
  assert.equal(resolveDecision('EAP 650', {}).intent, 'product');
  assert.equal(resolveDecision('ap 650 bei yake', {}).intent, 'product');
  assert.equal(isModelReference('AP 650'), true);
  assert.equal(isModelReference('Habari, mpo?'), false);
  // The model is read from anywhere in a long sentence, not just the last words.
  assert.equal(modelQuery('bei ya kifaa cha Tplink omada ap 650 pamoja na mfumo'), 'ap 650');
});
