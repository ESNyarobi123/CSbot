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
assert.equal(outbound(messages)[0].kind, 'text');
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
assert.equal(state.memory.handoffPending, true);

const receiptPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await api(`/v1/accounts/${account}/simulate`, { method: 'POST', status: 202,
  data: { phone, messageId: 'paid', text: 'Nimelipa', imageBase64: receiptPng } });
state = await waitFor(path, value => value.stage === 'payment_reported'
  && value.outbound.filter(item => item.origin === 'alert' && item.state === 'sent').length === 2);
const paymentMessages = await waitFor(messagesPath, value => outbound(value).length === 3);
assert.match(outbound(paymentMessages)[0].body, /itathibitishia|kukuthibitishia/);
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
assert.equal((await api(path)).memory.handoffPending, undefined);

const firstSale = (await api(path)).sale;
assert.equal(firstSale.stage, 'completed');
assert.ok(firstSale.closed_at);
assert.match(firstSale.quote.text, /Cudy/);
await simulate(account, 'project', 'Nina Cudy WR3000. Bajeti yangu ni TSh 200,000. Nataka hotspot ya wageni.');
await waitFor(path, value => value.memory.profile?.useCase?.includes('wageni'));
await api(path + '/mode', { method: 'PATCH', data: { mode: 'bot' } });
await simulate(account, 'ambiguous-next', 'Naomba namba ya kulipia');
messages = await waitFor(messagesPath, value => outbound(value).length === 4);
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

// A voice note the stack cannot read (this compose file runs without a DeepSeek
// key) must reach a person, not vanish. This is the failure the feature exists
// to prevent: a customer who speaks instead of typing is still a customer.
const voiceChat = await api(`/v1/accounts/${account}/simulate`, { method: 'POST', status: 202,
  data: { phone: '+255700100012', messageId: 'voice-1',
    audioBase64: Buffer.from('OggS unreadable voice note').toString('base64') } });
const voicePath = '/v1/conversations/' + voiceChat.conversationId;
const voiceState = await waitFor(voicePath, value => value.mode === 'human');
assert.match(voiceState.memory.recentTopic ?? '', /voice note/i);
const voiceMessages = await waitFor(voicePath + '/messages',
  value => value.some(item => item.actor === 'bot' && /voice note yako/.test(item.body)));
const voiceInbound = voiceMessages.filter(message => message.direction === 'inbound');
assert.equal(voiceInbound.length, 1);
assert.equal(voiceInbound[0].body, '[WhatsApp audio]');
await api(`/v1/accounts/${account}/simulate`, { method: 'POST', status: 400,
  data: { phone: '+255700100012', messageId: 'voice-bad', audioBase64: 'AAAA', audioMime: 'image/png' } });
const waitPhone = '+255700100012';
const followUpVoice = messageId => api(`/v1/accounts/${account}/simulate`, { method: 'POST', status: 202,
  data: { phone: waitPhone, messageId, text: 'Habari mkuu' } });
assert.equal(voiceState.memory.handoffPending, true);
await followUpVoice('waiting-for-agent');
await waitFor(voicePath + '/messages', value => outbound(value).length === 2);
await api(voicePath + '/mode', { method: 'PATCH', data: { mode: 'human' } });
assert.equal((await api(voicePath)).memory.handoffPending, undefined);
await followUpVoice('staff-is-active');
await sleep(2000);
assert.equal(outbound(await api(voicePath + '/messages')).length, 2);
console.log('Passed: CSbot acknowledges voice notes, handles the next message while waiting, and stops on actual staff takeover.');

const simulateCall = (messageId, missedCall) => api(`/v1/accounts/${account}/simulate`, {
  method: 'POST', status: 202, data: { phone: '+255700100031', messageId, missedCall },
});
const call = await simulateCall('missed-voice', 'voice');
const callPath = '/v1/conversations/' + call.conversationId;
const missedReply = outbound(await waitFor(callPath + '/messages', value => outbound(value).length === 1))[0];
assert.match(missedReply.body, /simu yako.*voice note/i);
await simulateCall('missed-video', 'video');
await waitFor(callPath + '/messages', value => value.filter(item => item.direction === 'inbound').length === 2);
await sleep(1600);
assert.equal(outbound(await api(callPath + '/messages')).length, 1);
console.log('Passed: missed voice and video calls get one WhatsApp reply within the cooldown.');

const sharp = (await import('sharp')).default;
const label = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180"><rect width="640" height="180" fill="white"/><text x="36" y="118" font-family="sans-serif" font-size="84" fill="black">WR3000</text></svg>')).png().toBuffer();
const photoChat = await api(`/v1/accounts/${account}/simulate`, { method: 'POST', status: 202,
  data: { phone: '+255700100011', messageId: 'box', text: 'Naweza kupata hii kwenu?', imageBase64: label.toString('base64') } });
const photoPath = '/v1/conversations/' + photoChat.conversationId;
const photoMessages = await waitFor(photoPath + '/messages', value => outbound(value).length === 1);
assert.match(outbound(photoMessages)[0].body, /lebo.*WR3000/i);
assert.match(outbound(photoMessages)[0].body, /99,000/);
assert.equal((await api(photoPath)).memory.product.id, 'wr3000');
console.log('Passed: printed model identified from a product photograph, priced from POS and remembered on its own conversation.');

const simulateNamed = (messageId, text, extra = {}) =>
  api(`/v1/accounts/${account}/simulate`, { method: 'POST', status: 202,
    data: { phone: '+255700100032', name: 'Asha Juma', messageId, text, ...extra } });
const named = await simulateNamed('named-greeting', 'Habari za muda huu');
const namedPath = '/v1/conversations/' + named.conversationId;
const namedMessages = namedPath + '/messages';
assert.match(outbound(await waitFor(namedMessages, value => outbound(value).length === 1))[0].body, /Habari, Asha!/);
await simulateNamed('named-quote', 'Naomba proforma');
const noModel = outbound(await waitFor(namedMessages, value => outbound(value).length === 2))[0].body;
assert.match(noModel, /picha ya kifaa au lebo/);
assert.doesNotMatch(noModel, /Asha|SKU/);
await simulateNamed('about-to-send-photo', 'Acha nikutumie picha');
await waitFor(namedMessages, value => outbound(value).length === 3);
await simulateNamed('quote-label', '', { imageBase64: label.toString('base64') });
const fromPhoto = await waitFor(namedPath, value => value.memory.documentRequest?.product?.id === 'wr3000');
assert.equal(fromPhoto.memory.documentRequest.product.name, 'Cudy WR3000');
assert.equal(fromPhoto.memory.issuedProforma, undefined);
await waitFor(namedMessages, value => value.some(message => message.direction === 'outbound' && /Cudy WR3000 ngapi/.test(message.body)));
console.log('Passed: WhatsApp contact name, no repeat greeting, customer can identify a quote item by photo without a product code.');

const invoicePdf = { name: 'INV-1001.pdf', base64: Buffer.from('%PDF-1.7\n% local fixture\n%%EOF\n').toString('base64') };
const invoice = { method: 'POST', status: 202, data: {
  text: 'Hii ndiyo invoice ya oda yako.', requestId: 'smoke-invoice-pdf', invoicePdf,
} };
const [invoiceSent, invoiceRetry] = await Promise.all([api(messagesPath, invoice), api(messagesPath, invoice)]);
assert.equal(invoiceSent.id, invoiceRetry.id);
await api(messagesPath, { ...invoice, status: 400, data: {
  ...invoice.data, invoicePdf: { ...invoicePdf, name: 'another.pdf' },
} });
const invoiceMessages = await waitFor(messagesPath, value => value.some(item => item.kind === 'document'));
const documents = invoiceMessages.filter(item => item.kind === 'document');
assert.equal(documents.length, 1);
assert.ok(documents[0].media_id);
const downloadUrl = base + path + '/documents/' + documents[0].media_id;
assert.equal((await fetch(downloadUrl)).status, 401);
const download = await fetch(downloadUrl, { headers: { authorization: 'Bearer ' + token } });
assert.equal(download.status, 200);
assert.equal(download.headers.get('content-disposition'), 'attachment; filename="INV-1001.pdf"');
assert.equal(Buffer.from(await download.arrayBuffer()).toString('base64'), invoicePdf.base64);
const copyState = await waitFor(path, value => value.outbound.some(item =>
  item.origin === 'alert' && item.state === 'sent' && /Invoice imetumwa/.test(item.body)));
const copies = copyState.outbound.filter(item => item.origin === 'alert' && /Invoice imetumwa/.test(item.body));
const customerInvoice = copyState.outbound.find(item => item.id === invoiceSent.id);
assert.equal(copies.length, 1);
assert.equal(copies[0].document_id, customerInvoice.document_id);
assert.equal(copies[0].document_name, invoicePdf.name);
assert.ok(new Date(copies[0].created_at) >= new Date(customerInvoice.sent_at));
assert.equal(invoiceMessages.filter(item => item.kind === 'document').length, 1);
console.log('Passed: the same invoice PDF went to the customer, then to the configured admin once.');

const adminPhone = '+255700100001';
const supportPhone = '+255700100045';
const onChannel = (channel, phone, messageId, text, quotedMessageId) =>
  api(`/v1/accounts/${channel}/simulate`, { method: 'POST', status: 202,
    data: { phone, messageId, text, quotedMessageId } });
const supportChat = await onChannel(account, supportPhone, 'support-start',
  'Nina shida ya mfumo wa WoteFy');
const supportPath = '/v1/conversations/' + supportChat.conversationId;
const supportMessages = supportPath + '/messages';
const supportOpening = outbound(await waitFor(supportMessages, value => outbound(value).length === 1))[0];
assert.match(supportOpening.body, /kinachotokea/);
assert.doesNotMatch(supportOpening.body, /email/);
await onChannel(account, supportPhone, 'support-symptom', 'Vifaa vyangu vinawaka na kuzima');
const supportCheck = outbound(await waitFor(supportMessages, value => outbound(value).length === 2))[0];
assert.match(supportCheck.body, /taa ya power/);
assert.doesNotMatch(supportCheck.body, /email|modeli/);
await onChannel(account, supportPhone, 'support-check', 'Taa ya power inazima pia');
const supportState = await waitFor(supportPath, value => value.outbound.some(
  item => item.origin === 'alert' && item.state === 'sent' && /Msaada wa kiufundi/.test(item.body)));
const alert = supportState.outbound.find(item => item.origin === 'alert' && /Msaada wa kiufundi/.test(item.body));
assert.match(alert.body, /Haijatolewa/);
assert.match(alert.body, /Taa ya power inazima pia/);
await api(`/v1/accounts/${other}/admin-numbers`, { method: 'PUT', data: { numbers: [adminPhone] } });
await onChannel(other, adminPhone, 'cross-account', 'Tume fix hili tatizo', alert.provider_id);
await onChannel(account, adminPhone, 'no-quote', 'Tume fix hili tatizo');
assert.equal((await api(supportPath)).memory.supportUpdate, undefined);

await onChannel(account, adminPhone, 'empty-details', 'Tunahitaji taarifa hizi:', alert.provider_id);
assert.equal((await api(supportPath)).memory.supportUpdate, undefined);
assert.ok(!(await api(supportPath)).outbound.some(item => item.origin === 'admin'));
await onChannel(account, adminPhone, 'request-details', 'Tunahitaji taarifa hizi: modeli na firmware', alert.provider_id);
await waitFor(supportPath + '/messages', value => value.some(item => item.actor === 'admin' && /modeli na firmware/.test(item.body)));
await onChannel(account, adminPhone, 'request-details', 'Tunahitaji taarifa hizi: modeli na firmware', alert.provider_id);
assert.equal((await api(supportPath)).outbound.filter(item => item.origin === 'admin' && /modeli na firmware/.test(item.body)).length, 1);
await onChannel(account, supportPhone, 'buy-while-waiting', 'Bei ya Cudy WR3000');
await waitFor(supportPath + '/messages', value => value.some(item =>
  item.actor === 'bot' && /WR3000.*99,000/.test(item.body)));
assert.equal((await api(supportPath)).memory.supportUpdate?.status, 'details');
await onChannel(account, supportPhone, 'customer-details', 'EAP650 firmware v1.2.0');
const detailed = await waitFor(supportPath, value => value.outbound.some(
  item => item.origin === 'alert' && item.state === 'sent' && /Matokeo ya ukaguzi.*EAP650/.test(item.body)));
const newAlert = detailed.outbound.find(item => item.origin === 'alert' && /Matokeo ya ukaguzi.*EAP650/.test(item.body));
await onChannel(account, adminPhone, 'stale-update', 'Tume fix: update kutoka arifa ya zamani', alert.provider_id);
assert.ok(!(await api(supportPath)).outbound.some(item => item.origin === 'admin' && /arifa ya zamani/.test(item.body)));
await onChannel(account, adminPhone, 'custom-update', 'Mjibu hivi: Tafadhali jaribu tena leo.', newAlert.provider_id);
await waitFor(supportPath + '/messages', value => value.some(item => item.actor === 'admin' && item.body === 'Tafadhali jaribu tena leo.'));
await onChannel(account, adminPhone, 'resolve-update', 'Tumesha solve: tuliunganisha kifaa kwenye site sahihi.', newAlert.provider_id);
await waitFor(supportPath + '/messages', value => value.some(item => item.actor === 'admin' && /tatizo limetatuliwa/.test(item.body)));
assert.ok(['resolution_queued', 'awaiting_confirmation'].includes((await api(supportPath)).memory.supportUpdate?.status));
await onChannel(account, supportPhone, 'customer-confirmed', 'Imefanya kazi');
await waitFor(supportPath, value => value.memory.supportUpdate?.status === 'resolved');
await onChannel(account, adminPhone, 'resolve-repeat', 'Tume fix: ujumbe mwingine', newAlert.provider_id);
assert.equal((await api(supportPath)).outbound.filter(item => item.origin === 'admin' && /tatizo limetatuliwa/.test(item.body)).length, 1);
console.log('Passed: quoted admin support replies route to the right customer, hand details back to the team, and reject stale or duplicate updates.');

const optedPhone = '+255700100046';
const stopped = await onChannel(account, optedPhone, 'optout-case',
  'WoteFy vifaa vyangu vinawaka na kuzima, shida ni mfumo au? mteja@example.test');
const stoppedPath = '/v1/conversations/' + stopped.conversationId;
await waitFor(stoppedPath + '/messages', value => value.some(item => item.actor === 'bot' && /taa ya power/.test(item.body)));
await onChannel(account, optedPhone, 'optout-check', 'Taa ya power inazima pia');
const stoppedState = await waitFor(stoppedPath, value => value.outbound.some(
  item => item.origin === 'alert' && item.state === 'sent' && /Msaada wa kiufundi/.test(item.body)));
const stoppedAlert = stoppedState.outbound.find(item => item.origin === 'alert' && /Msaada wa kiufundi/.test(item.body));
await onChannel(account, optedPhone, 'optout-stop', 'Usinitumie ujumbe');
await waitFor(stoppedPath + '/messages', value => value.some(item => item.actor === 'bot' && /sitakutumia/.test(item.body)));
await onChannel(account, adminPhone, 'optout-admin-request', 'Mjibu hivi: Ujumbe wa majaribio.', stoppedAlert.provider_id);
const opted = await waitFor(stoppedPath, value => value.outbound.some(
  item => item.origin === 'alert' && item.state === 'sent' && /Taarifa haijatumwa/.test(item.body)));
assert.ok(!opted.outbound.some(item => item.origin === 'admin'));
console.log('Passed: incomplete admin requests are held, commercial questions stay separate, and opted-out customers receive no support update.');

const selfHelpPhone = '+255700100047';
const selfHelp = await onChannel(account, selfHelpPhone, 'self-help-start', 'WoteFy vifaa vyangu vinawaka na kuzima');
const selfHelpPath = '/v1/conversations/' + selfHelp.conversationId;
await waitFor(selfHelpPath + '/messages', value => value.some(item => item.actor === 'bot' && /taa ya power/.test(item.body)));
await onChannel(account, selfHelpPhone, 'self-help-how', 'Naangaliaje hiyo taa?');
await waitFor(selfHelpPath + '/messages', value => value.some(item => item.actor === 'bot' && /alama ya umeme/.test(item.body)));
await onChannel(account, selfHelpPhone, 'self-help-done', 'Asante, sasa imefanya kazi mkuu!');
const resolvedSelfHelp = await waitFor(selfHelpPath, value => value.memory.supportUpdate?.status === 'resolved');
assert.equal(resolvedSelfHelp.mode, 'bot');
assert.ok(!resolvedSelfHelp.outbound.some(item => item.origin === 'alert'));
assert.ok((await api('/v1/knowledge/review-items')).some(item =>
  item.kind === 'resolved' && /alama ya umeme.*imefanya kazi mkuu/.test(item.sample)));
console.log('Passed: the bot clarified its support check and recorded the customer-confirmed outcome for knowledge review.');
