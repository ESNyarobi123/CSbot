import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.DEEPSEEK_API_KEY;
delete process.env.POS_BASE_URL;
delete process.env.CSOLUTION_POS_DB_URL;
delete process.env.LUBFY_PLANS_URL;
const { customerTurn } = await import('../dist/assistant.js');
const client = { query: async () => ({ rows: [] }) };
const chat = (memory = {}) => ({ id: 'playground', account_id: 'a', customer_jid: 'a', stage: 'inquiry', memory });
const say = (text, memory, history = []) => customerTurn(client, chat(memory), text, history);

test('a greeting gets one warm welcome and asks what they need, then stays quiet', async () => {
  const first = await say('Kaka');
  assert.match(first.body, /nini|nini leo|kusaidia/i);
  assert.doesNotMatch(first.body, /WoteFy|LubFy|bei/i);
  // The same greeting after the bot has spoken is not worth another reply.
  const again = await say('Kaka', {}, [{ direction: 'outbound', body: first.body }]);
  assert.equal(again.body, '');
  for (const text of ['Nipo mtwara', 'Nimelipa chakula', 'Uko na gme']) {
    const reply = await say(text, { support: { problem: 'Nipo Mtwara', system: 'lubfy' } });
    assert.equal(reply.body, '', text);
    assert.equal(reply.stage, undefined);
    assert.equal(reply.handoff, undefined);
  }
});

test('support asks about the affected device when the customer has several, and accepts a previously supplied email', async () => {
  const one = await say('LubFy portal haifunguki');
  assert.match(one.body, /email/i);
  const two = await say('imeli yang ndo ile ile kaka', one.memory);
  assert.doesNotMatch(two.body, /Nipe email/);
  const three = await say('Lkn mi navifaa vitatu asa ushaelewa kifaa cheny shida', two.memory);
  assert.match(three.body, /kipi kati ya hivyo/);
  // "I have three devices" stays out of the problem field; only the answer does.
  assert.equal(three.memory.support?.problem, undefined);
  const four = await say('kifaa cha tatu hakifunguki', three.memory);
  assert.match(four.memory.lastSupport?.problem ?? four.memory.support?.problem ?? '', /kifaa cha tatu/);
  assert.doesNotMatch(four.memory.lastSupport?.problem ?? '', /navifaa vitatu/);
  const saved = await say('imeli yangu ile ile', one.memory, [{direction:'inbound',body:'customer@example.test'}]);
  assert.equal(saved.memory.lastSupport?.email, 'customer@example.test');
  const noise = await say('Hr fgrgd', one.memory);
  assert.equal(noise.body, '');
});

test('a kilometre planning request and its follow-up keep the distance and clarify the network layout', async () => {
  const one = await say('Nawaza nipo na kilometer 1 huku iringa nataka kufunga vifaa vya internet unanishauri nini');
  assert.match(one.body, /1000/);
  assert.doesNotMatch(one.body, /TYPE A|TZS/);
  const two = await say('Na kwaeneo ilo unafikilia nitumie eap gani au ap gani', one.memory);
  assert.match(two.body, /1000/);
  assert.doesNotMatch(two.body, /mita ngapi/);
});

test('the monthly system fee overrides the hardware quote and preserves the MikroTik platform on follow-up', async () => {
  const one = await say('Sasa vp bei za mfumo kwa mwezi natumia microtick na ninatakiwa kutumia mfumo upi',
    {product:{id:'eap', name:'EAP 650'}, awaitingService:true});
  assert.equal(one.memory.plan.kind, 'subscription');
  assert.equal(one.memory.system, 'lubfy');
  assert.doesNotMatch(one.body, /SKU|installation|unaulizia bidhaa/i);
  const two = await say('Naulizia kwa mwezi nalipia shingap mfumo', one.memory);
  assert.equal(two.memory.system, 'lubfy');
  assert.doesNotMatch(two.body, /SKU|unaulizia bidhaa/i);
});

test('a bare problem word is the reason the customer came, so it is answered', async () => {
  for (const text of ['Tatizo', 'Shida', 'Problem', 'Portal haifunguki']) {
    const reply = await say(text);
    assert.notEqual(reply.body, '', text);
    // A support opener is met with a support question, never a price list.
    assert.match(reply.body, /shida|tatizo|mfumo|WoteFy|LubFy/i, text);
    assert.doesNotMatch(reply.body, /SKU|TZS|bidhaa gani/i, text);
  }
  // A bare address is a request for help, never idle chatter.
  assert.notEqual((await say('suachiti@gmail.com')).body, '');
});

test('a bare system name asks whether they want to join or need help', async () => {
  const reply = await say('Wotefy');
  assert.match(reply.body, /kujiunga/);
  assert.match(reply.body, /tatizo/);
  // The same word while a problem is being collected is the answer to "which system?", so
  // it must not restart the conversation.
  const intake = await say('Wotefy', { support: { waitingFor: 'system' } });
  assert.doesNotMatch(intake.body, /Unataka kujiunga/);
});

test('a monthly fee typed as "mwez" is a plan question, not a product search', async () => {
  const reply = await say('Sasa vp bei za mfumo kwa mwez natumia microtick na nina takiwa kutumia mfumo upi');
  assert.equal(reply.memory.plan?.kind, 'subscription');
  assert.equal(reply.memory.system, 'lubfy');
  assert.doesNotMatch(reply.body, /SKU|unaulizia bidhaa/i);
});

test('naming the system does not repeat the same question, and "same email" is not asked again', async () => {
  const one = await say('Tatizo');
  const two = await say('Wotefy', one.memory);
  assert.notEqual(two.body, one.body);
  assert.match(two.body, /WoteFy/);
  assert.equal(two.memory.support?.system, 'wotefy');
  const three = await say('imeli yang ndo ile ile kaka', two.memory);
  assert.doesNotMatch(three.body, /Nipe email/);
  assert.notEqual(three.body, two.body);
  assert.match(three.body, /email ya awali/);
});

test('onboarding asks which equipment is in use and never requests a support email', async () => {
  const first = await say('Nataka kujiunga');
  assert.equal(first.memory.onboarding, true);
  assert.match(first.body, /router au access point/);
  const second = await customerTurn({ query: async (sql) => ({rows:sql.includes('AND id=$1') ? [{content:'Hatua za usajili za LubFy',source_url:null}] : []}) },
    chat(first.memory), 'Natumia MikroTik', []);
  assert.match(second.body, /usajili za LubFy/);
  assert.equal(second.memory.onboarding, undefined);
});

test('a LubFy admin alert is not answered with a price list', async () => {
  const notice = `💸 *Withdrawal request*\n\n🏢 Reseller\n💰 TZS 8,000 (mobile)\n\n👉 http://lubfy.online/admin/withdrawal`;
  const reply = await say(notice, { plan: { kind: 'wifi' }, system: 'lubfy', quoteFor: 'plan' });
  assert.equal(reply.body, '');
  assert.equal(reply.memory.plan.kind, 'wifi');
});

test('creating a customer account is not answered by selling a gateway', async () => {
  const reply = await say('Gateway tunamtengenezea mteja account wapi? Sd omada au lubfy');
  assert.match(reply.body, /dashboard/i);
  assert.match(reply.body, /WoteFy/);
  assert.match(reply.body, /LubFy/);
  assert.doesNotMatch(reply.body, /TZS|SKU|EAP|bei/i);
});

test('an Iringa site survey and investment enquiry gets planning advice', async () => {
  const reply = await say('Hivi ukija iringa mjini ukafanya survaey unashauli ni invest aje kwmeye wifi billing system na vifaa');
  assert.match(reply.body, /Iringa mjini/);
  assert.match(reply.body, /survey.*gharama/s);
  assert.doesNotMatch(reply.body, /SKU|stock/i);
});

test('a profitability question gets business advice, never a product prompt', async () => {
  const reply = await say('nipo kigoma mjini hilo eneo mkiangalia naweza pata faida kwa biashara hii');
  assert.match(reply.body, /faida|biashara|Kigoma/i);
  assert.doesNotMatch(reply.body, /bidhaa gani|SKU|model au SKU/i);
  assert.equal(reply.memory.survey?.town, 'kigoma');
});

test('short answers to the survey continue planning in the same chat', async () => {
  const first = await say('Nahitaji survey ya WiFi');
  const site = await say('Hostel', first.memory);
  assert.match(site.body, /wangapi/);
  const count = await say('kama 80', site.memory);
  assert.equal(count.memory.requirements.users, 80);
  assert.match(count.body, /80.*Hostel/i);
});

test('ambiguous and unavailable product photos cannot quote a previously discussed device', async () => {
  for (const count of [1, 2]) {
    const before = chat({ product: { id: 'old', name: 'Old router' }, lastQuote: 'TZS 123,000' });
    const reply = await customerTurn(client, before, 'Naweza kupata hii kwenu?', [], false, {count});
    assert.match(reply.body, count === 1 ? /lebo/i : /kipi kwanza/i);
    assert.equal(reply.memory.product, undefined);
    assert.doesNotMatch(reply.body, /123,000|Old router/);
  }
});
