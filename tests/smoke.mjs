import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

if (!process.env.ADMIN_API_TOKEN) process.loadEnvFile();
const base = process.env.CSBOT_TEST_URL ?? 'http://127.0.0.1:18080';
const token = process.env.ADMIN_API_TOKEN;
const timestamp = Date.now();
const account = 'smoke-' + timestamp;
const other = account + '-other';
const phone = '+255700100010';
const digits = text => text.replace(/\D/g, '');

async function api(path, { method = 'GET', data, status = 200, authenticated = true } = {}) {
  const headers = authenticated ? { authorization: 'Bearer ' + token } : {};
  if (data) headers['content-type'] = 'application/json';
  const response = await fetch(base + path, { method, headers, body: data && JSON.stringify(data) });
  const result = await response.json();
  assert.equal(response.status, status, method + ' ' + path + ': ' + JSON.stringify(result));
  return result;
}

async function waitFor(path, predicate) {
  for (let i = 0; i < 60; i += 1) {
    const value = await api(path);
    if (predicate(value)) return value;
    await sleep(250);
  }
  assert.fail('Timed out waiting for ' + path + ' to reach its expected state');
}

const simulate = (channel, messageId, text) =>
  api(`/v1/accounts/${channel}/simulate`, { method: 'POST', status: 202, data: { phone, messageId, text } });
const outbound = (messages, actor = 'bot') => messages.filter(message => message.actor === actor);
await api('/health/ready');
await api('/v1/accounts', { status: 401, authenticated: false });
for (const id of [account, other]) {
  await api('/v1/accounts', { method: 'POST', status: 201, data: { id, label: id, mode: 'mock' } });
}
await api(`/v1/accounts/${account}/admin-numbers`, { method: 'PUT', data: { numbers: ['+255700100001'] } });
const { conversationId } = await simulate(account, 'part-1', 'Bei ya Cudy');
await simulate(account, 'part-2', 'WR3000');
const path = '/v1/conversations/' + conversationId;
const messagesPath = path + '/messages';

let messages = await waitFor(messagesPath, value => outbound(value).length === 1);
assert.equal(outbound(messages)[0].kind, 'image');
assert.match(digits(outbound(messages)[0].body), /95000/);
assert.match(outbound(messages)[0].body, /Ipo stock/);
await simulate(account, 'part-2', 'WR3000');
await sleep(1600);
messages = await api(messagesPath);
assert.equal(messages.filter(message => message.direction === 'inbound').length, 2);
assert.equal(outbound(messages).length, 1);
assert.equal((await api(path)).memory.product.name, 'Cudy WR3000');

let inbox = await api('/v1/conversations?account=' + account);
let card = inbox.find(item => String(item.id) === String(conversationId));
assert.ok(card.unread_count >= 2, 'inbox counts unread customer messages');
assert.match(card.last_body, /WR3000/, 'inbox shows the newest message preview');
await api(path + '/read', { method: 'PATCH' });
assert.equal((await api(path)).unread_count, 0);
const stats = await api('/v1/stats');
assert.ok(stats.conversations >= 1);
assert.equal(stats.accounts.find(item => item.id === account).status, 'mock');

const isolated = await simulate(other, 'part-1', 'Bei ya ile?');
assert.notEqual(isolated.conversationId, conversationId);
const otherPath = '/v1/conversations/' + isolated.conversationId;
let otherHistory = await waitFor(otherPath + '/messages', value => outbound(value).length === 1);
assert.doesNotMatch(outbound(otherHistory)[0].body, /WR3000/);
assert.equal((await api(otherPath)).memory.product, undefined);

await simulate(account, 'ready', 'Naomba namba ya kulipia');
messages = await waitFor(messagesPath, value => outbound(value).length === 2);
assert.match(digits(outbound(messages)[0].body), /99000/);
let state = await waitFor(path, value => value.outbound.some(item => item.origin === 'alert' && item.state === 'sent'));
assert.equal(state.stage, 'ready_to_pay');
assert.equal(state.mode, 'human');

const receiptPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await api(`/v1/accounts/${account}/simulate`, { method: 'POST', status: 202,
  data: { phone, messageId: 'paid', text: 'Nimelipa', imageBase64: receiptPng } });
state = await waitFor(path, value => value.stage === 'payment_reported'
  && value.outbound.filter(item => item.origin === 'alert' && item.state === 'sent').length === 2);
assert.equal(outbound(await api(messagesPath)).length, 2);
const receiptAlert = state.outbound.find(item => item.origin === 'alert' && item.image_url);
assert.match(receiptAlert.image_url, /^csbot-media:\d+$/, 'payment alert forwards the receipt photo');
assert.equal(state.media.length, 1);
assert.match((await api('/v1/media/' + state.media[0].id)).dataUrl, /^data:image\/png;base64,/);
const sentAlert = state.outbound.find(item => item.origin === 'alert');
await api('/v1/outbound/' + sentAlert.id + '/retry', { method: 'POST', status: 409 });
assert.ok(Array.isArray(await api('/v1/outbound?state=uncertain')));
await api(path + '/sale', { method: 'POST', status: 400, data: { stage: 'completed', reason: 'Smoke test' } });
await api(path + '/sale', { method: 'POST', data: { stage: 'paid', reason: 'Confirmed in smoke test' } });
assert.equal((await api(path + '/sale', { method: 'POST', data: { stage: 'completed', reason: 'Smoke test complete' } })).stage, 'completed');

const message = { method: 'POST', status: 202, data: { text: 'Asante kwa kuwasiliana', requestId: 'demo-manual-reply' } };
const [attempt1, attempt2] = await Promise.all([api(messagesPath, message), api(messagesPath, message)]);
assert.equal(attempt1.id, attempt2.id);
await waitFor(messagesPath, value => outbound(value, 'admin').length === 1);

const firstSale = (await api(path)).sale;
assert.equal(firstSale.stage, 'completed');
assert.ok(firstSale.closed_at);
assert.match(firstSale.quote.text, /Cudy/);
await simulate(account, 'project', 'Nina Cudy WR3000. Bajeti yangu ni TSh 200,000. Nataka hotspot ya wageni.');
await waitFor(path, value => value.memory.profile?.useCase?.includes('wageni'));
await api(path + '/mode', { method: 'PATCH', data: { mode: 'bot' } });
await simulate(account, 'ambiguous-next', 'Naomba namba ya kulipia');
messages = await waitFor(messagesPath, value => outbound(value).length === 3);
assert.match(outbound(messages)[0].body, /oda mpya/);
assert.equal((await api(path)).sale.id, firstSale.id);

await simulate(account, 'second-order', 'Bei ya Cudy WR3000');
state = await waitFor(path, value => value.sale?.stage === 'quoted' && value.sale.id !== firstSale.id);
const secondId = state.sale.id;
assert.match(state.memory.profile.budget, /200,000/);
await simulate(account, 'second-ready', 'Naomba namba ya kulipia');
await waitFor(path, value => value.sale?.stage === 'ready_to_pay');
await simulate(account, 'second-reported', 'Nimelipa');
await waitFor(path, value => value.sale?.stage === 'payment_reported' &&
  value.outbound.filter(item => item.origin === 'alert' && item.state === 'sent').length === 4);
await api(path + '/sale', { method: 'POST', status: 409, data: { stage: 'paid', reason: 'Stale request', saleId: firstSale.id } });
await api(path + '/sale', { method: 'POST', status: 409, data: { stage: 'paid', reason: 'Missing sale ID' } });
await api(path + '/sale', { method: 'POST', data: { stage: 'paid', reason: 'Verified second payment', saleId: secondId } });
await api(path + '/sale', { method: 'POST', data: { stage: 'completed', reason: 'Fulfilled second sale', saleId: secondId } });
const [latest, previous] = await api(path + '/sales');
assert.equal(latest.id, secondId);
assert.deepEqual(previous, firstSale);
assert.equal((await api(path + '/sales?before=' + secondId))[0].id, firstSale.id);
const events = await api(path + '/sales/' + secondId + '/events');
assert.deepEqual(events.map(event => event.stage), ['completed', 'paid', 'payment_reported', 'ready_to_pay', 'quoted', 'inquiry']);

const open = { method: 'POST', data: { requestId: 'open-third-order' } };
const [third, retriedThird] = await Promise.all([api(path + '/sales', open), api(path + '/sales', open)]);
assert.equal(third.id, retriedThird.id);
assert.equal(third.quote, null);
state = await api(path);
assert.equal(state.memory.lastQuote, undefined);
assert.match(state.memory.profile.budget, /200,000/);
await api(path + '/sales', { method: 'POST', status: 409, data: { requestId: 'overlapping-order' } });

await simulate(other, 'package-choice', 'Package bei gani?');
otherHistory = await waitFor(otherPath + '/messages', value => outbound(value).length === 2);
assert.match(outbound(otherHistory)[0].body, /subscription/i);
await simulate(other, 'package-type', 'Subscription');
otherHistory = await waitFor(otherPath + '/messages', value => outbound(value).length === 3);
assert.match(outbound(otherHistory)[0].body, /WoteFy au LubFy/);
await simulate(other, 'package-system', 'LubFy');
otherHistory = await waitFor(otherPath + '/messages', value => outbound(value).length === 4);
assert.match(outbound(otherHistory)[0].body, /Integration Test LubFy/);
assert.equal((await api(otherPath)).stage, 'quoted');
console.log('Passed: account isolation, debounce, deduplication, product photo, fresh pricing, plan clarification, sales alerts, payment confirmation, repeat sales, saved customer context, stale payment protection and idempotent admin actions.');
