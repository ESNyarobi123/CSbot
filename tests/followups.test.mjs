import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * The consent gate and the customer-360 helpers. Opt-out is what keeps
 * proactive follow-ups legal: a number that says "stop" must be left alone or
 * the shop's number gets reported and banned.
 */
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
const { optOutRequest } = await import('../dist/customer-text.js');
const { customerOptedOut, setCustomerOptedOut, scheduleFollowUp, dueFollowUps, cancelFollowUps } = await import('../dist/store.js');

test('opt-out is recognised only for short, unambiguous stop requests', () => {
  for (const text of ['acha', 'STOP', 'acha kunijibu', 'sitaki ujumbe', 'usinitumie',
    'opt-out', 'unsubscribe', 'niachie', 'usinitumie ujumbe tena']) {
    assert.equal(optOutRequest(text), true, text);
  }
  // False positives must not silence a real customer.
  for (const text of ['acha nikufahamishe bei', 'nitaacha kuuliza kuhusu kifaa hicho',
    'acha nimtafute mtu wa installation', 'acha nikutumie picha', 'router inaandika stop', 'nisamehe', 'bei ya router na installation kiasi gani?',
    'STOP? hapana, endelea', 'je mna kifaa cha acha?']) {
    assert.equal(optOutRequest(text), false, text);
  }
});

const client = { query: async () => ({ rows: [] }) };

test('opt-out flag round-trips through the store without throwing', async () => {
  await setCustomerOptedOut(client, 'a', 'x@s.whatsapp.net', true);
  await setCustomerOptedOut(client, 'a', 'x@s.whatsapp.net', false);
  assert.equal(await customerOptedOut(client, 'a', 'x@s.whatsapp.net'), false);
});

test('follow-up helpers tolerate an unavailable database', async () => {
  await scheduleFollowUp(client, {
    accountId: 'a', conversationId: '1', jid: 'x@s.whatsapp.net',
    kind: 'quote_nudge', body: 'Habari!', at: new Date(),
  });
  await cancelFollowUps(client, '1');
  assert.equal((await dueFollowUps(client, 10)).length, 0);
});

test('consent follows the latest explicit command in the original message batch', async () => {
  const { latestConsent } = await import('../dist/customer-text.js');
  const batch = (...lines) => lines.map(body => ({body}));
  assert.equal(latestConsent(batch('Bei gani?', 'STOP', 'asante')), 'stop');
  assert.equal(latestConsent(batch('acha', 'anza')), 'resume');
  assert.equal(latestConsent(batch('usianze', 'please do not resume')), undefined);
  await assert.rejects(setCustomerOptedOut({query: async () => {throw Error('offline');}}, 'a', 'jid'), /offline/);
});
