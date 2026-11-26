import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.DEEPSEEK_API_KEY;
delete process.env.CSOLUTION_POS_DB_URL;

// Built output, the same module the worker loads.
const { supportIntake, supportQuestion, supportSummary, emailOf } = await import('../dist/assistant.js');
const { relevantKnowledge } = await import('../dist/assistant.js');

const sw = (text) => text;
const say = (swText, _en) => swText;

test('a broken portal is a support question, a device price is not', () => {
  assert.equal(supportQuestion('Portal haifunguki kwenye simu'), true);
  assert.equal(supportQuestion('Nimelipa lakini sina internet'), true);
  assert.equal(supportQuestion('Bei ya EAP 650 ni shingapi?'), false);
  assert.equal(supportQuestion('Nahitaji installation na waya wa mita 15'), false);
});

test('asks for the problem when the report has no details yet', () => {
  const first = supportIntake('WoteFy', {}, say);
  assert.equal(first.ready, false);
  // The system was already named, so the question refers to it instead of repeating the opener.
  assert.match(first.reply, /WoteFy/);
  assert.match(first.reply, /kinachotokea|shida/i);
  assert.equal(first.support.system, 'wotefy');
  assert.equal(first.support.problem, undefined);
});

test('a stated problem moves straight to the system question', () => {
  const first = supportIntake('Mfumo wangu umesimama ghafla', {}, say);
  assert.equal(first.ready, false);
  assert.match(first.reply, /WoteFy au LubFy/);
  assert.match(first.support.problem, /umesimama/);
});

test('problem then system then email, each asked once', () => {
  const one = supportIntake('Portal haifunguki kwenye simu', {}, say);
  assert.equal(one.ready, false);
  assert.match(one.reply, /WoteFy au LubFy/);

  const two = supportIntake('WoteFy', one.support, say);
  assert.equal(two.ready, false);
  assert.match(two.reply, /email/i);
  assert.equal(two.support.system, 'wotefy');

  const three = supportIntake('asanileo@gmail.com', two.support, say);
  assert.equal(three.ready, true);
  assert.equal(three.support.email, 'asanileo@gmail.com');
  assert.equal(three.support.problem, 'Portal haifunguki kwenye simu');
  assert.match(supportSummary(three.support), /Tatizo:.*Mfumo: WoteFy.*Email:/);
});

test('one sentence can carry all three facts', () => {
  const intake = supportIntake('WoteFy portal haifunguki, email yangu asanileo@gmail.com', {}, say);
  assert.equal(intake.ready, true);
  assert.equal(intake.support.system, 'wotefy');
  assert.equal(intake.support.email, 'asanileo@gmail.com');
  assert.match(intake.support.problem, /portal haifunguki/i);
});

test('the email answer is not stored as the problem', () => {
  const intake = supportIntake('asanileo@gmail.com', { problem: 'Portal haifunguki', system: 'lubfy' }, say);
  assert.equal(intake.ready, true);
  assert.equal(intake.support.problem, 'Portal haifunguki');
});

test('email extraction keeps the domain and lowercases it', () => {
  assert.equal(emailOf('Nitumie kwa Asanileo@Gmail.COM tafadhali'), 'asanileo@gmail.com');
});

test('the support answer is the troubleshooting entry, not the overview', () => {
  const entries = [
    { id: 'wotefy-overview', system: 'wotefy', title: 'WoteFy — mfumo mzima',
      content: 'WoteFy ni mfumo wa wifi hotspot. Portal inafungua kwa mgeni.', source_url: null },
    { id: 'wotefy-portal-troubleshoot', system: 'wotefy', title: 'WoteFy — portal haifunguki / sign-in haitokei',
      content: 'Hakikisha SSID ni open, jaribu portal moja kwa moja, ondoa probe domains kwenye pre-auth.', source_url: null },
    { id: 'wotefy-device-offline', system: 'wotefy', title: 'WoteFy — kifaa kiko PENDING/OFFLINE',
      content: 'Weka Inform URL server.ssdomada.site kisha adopt.', source_url: null },
  ];
  const portal = relevantKnowledge('portal haifunguki kwenye simu', entries, true);
  assert.equal(portal.id, 'wotefy-portal-troubleshoot');
  const device = relevantKnowledge('kifaa kiko offline haionekani omada', entries, true);
  assert.equal(device.id, 'wotefy-device-offline');
});

test('a vague LubFy complaint never answers with Cambium setup', () => {
  const entries = [
    { id: 'lubfy-cambium', system: 'lubfy', title: 'LubFy — Cambium setup',
      content: 'Cambium ina mitindo mitatu ya usimamizi. Shida: login POST inashindwa.', source_url: null },
    { id: 'lubfy-cudy', system: 'lubfy', title: 'LubFy — Cudy setup',
      content: 'Cudy inatumia WiFiDog. Shida: portal haifunguki.', source_url: null },
  ];
  // The word "shida" in the report used to match "Shida:" inside the article,
  // so any complaint answered with the Cambium setup page.
  assert.equal(relevantKnowledge('mteja anapata shida hiyo mkuu', entries, true, 'lubfy'), undefined);
  assert.equal(relevantKnowledge('Mm nikiangalia naona haina shida', entries, true, 'lubfy'), undefined);
  // Naming the vendor is what makes the vendor-specific fix relevant.
  const named = relevantKnowledge('cambium login inashindwa kwa mteja', entries, true, 'lubfy');
  assert.equal(named.id, 'lubfy-cambium');
});

test('respond asks for the system before diagnosing, then uses the knowledge', async () => {
  const { respond } = await import('../dist/assistant.js');
  const entries = [
    { id: 'wotefy-portal-troubleshoot', system: 'wotefy', title: 'WoteFy — portal haifunguki / sign-in haitokei',
      content: 'Hakikisha SSID ni open, jaribu portal moja kwa moja, ondoa probe domains kwenye pre-auth.', source_url: null },
  ];
  const client = { query: async () => ({ rows: entries }) };
  const conversation = { id: 1, stage: 'inquiry', memory: {} };

  const first = await respond(client, conversation, 'Portal haifunguki kwenye simu', []);
  assert.match(first.body, /WoteFy au LubFy/);
  assert.equal(first.notify, undefined);

  const second = await respond(client, { ...conversation, memory: first.memory }, 'WoteFy', []);
  assert.match(second.body, /email/i);

  const third = await respond(client, { ...conversation, memory: second.memory }, 'asanileo@gmail.com', []);
  assert.match(third.body, /SSID ni open/);
  assert.equal(third.notify, true);
  assert.equal(third.handoff, undefined);
  assert.equal(third.memory.lastSupport.email, 'asanileo@gmail.com');
});
