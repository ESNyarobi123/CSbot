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

test('a greeting receives a welcome on a new or active chat', async () => {
  const first = await say('Kaka');
  assert.match(first.body, /nini|nini leo|kusaidia/i);
  assert.doesNotMatch(first.body, /WoteFy|LubFy|bei/i);
  const again = await say('Kaka', {}, [{ direction: 'outbound', body: first.body }]);
  assert.match(again.body, /karibu|kusaidia/i);
  for (const text of ['Nipo mtwara', 'Nimelipa chakula', 'Uko na gme']) {
    const reply = await say(text, { support: { problem: 'Nipo Mtwara', system: 'lubfy' } });
    assert.ok(reply.body, text);
    assert.equal(reply.stage, undefined);
    assert.equal(reply.handoff, undefined);
  }
});

test('a safe WhatsApp name or handle gives a personal greeting once in a day', async () => {
  const named = { ...chat(), customer_name: 'Asha Juma 🌿' };
  const first = await customerTurn(client, named, 'Habari', []);
  assert.match(first.body, /^Habari, Asha!/);
  assert.doesNotMatch((await customerTurn(client, { ...named, memory: first.memory }, 'Habari', [])).body, /Asha/);
  assert.match((await customerTurn(client, { ...chat(), customer_name: '@asha_net' }, 'Hello', [])).body, /@asha_net/);
  assert.doesNotMatch((await customerTurn(client, { ...chat(), customer_name: 'asha@example.test' }, 'Hi', [])).body, /asha/);
  const introduction = await customerTurn(client, named, 'Niite Zuri', []);
  assert.match(introduction.body, /Zuri/);
  assert.equal(introduction.memory.preferredName, 'Zuri');
});

test('a model or product code is optional when asking for help choosing a device', async () => {
  const quote = await say('Nahitaji proforma');
  assert.match(quote.body, /picha ya kifaa au lebo/);
  assert.doesNotMatch(quote.body, /SKU/);
  const noModel = await say('Sijui modeli yake', quote.memory);
  assert.match(noModel.body, /unataka kifaa kifanye nini/);
  assert.equal(noModel.memory.documentRequest?.kind, 'quote');
  assert.match((await say('SKU ndio nini?', noModel.memory)).body, /namba ya kumbukumbu/);
});

test('a vague complaint collects symptoms first and an account email can arrive after handoff', async () => {
  const first = await say('Nina shida ya mfumo wa WoteFy');
  assert.equal(first.memory.support?.problem, undefined);
  assert.doesNotMatch(first.body, /email/i);
  const detail = await say('Siwezi kuingia kwenye dashboard', first.memory);
  assert.match(detail.body, /ujumbe unaoonekana/);
  const waiting = await say('Sawa ngoja nijaribu', detail.memory);
  assert.equal(waiting.memory.support?.waitingFor, 'check');
  assert.equal(waiting.handoff, undefined);
  const handoff = await say('Inaandika invalid credentials', waiting.memory);
  assert.equal(handoff.handoff, true);
  assert.match(handoff.memory.lastSupport.checkResult, /invalid credentials/);
  assert.match(handoff.body, /Ukiweza, tuma email/);
  const email = await say('Email yangu ni Asha@Example.Test', { ...handoff.memory, handoffPending: true });
  assert.equal(email.memory.lastSupport.email, 'asha@example.test');
  assert.match(email.body, /Nimeongeza email/);
});

test('a direct request for a human routes to staff with the support issue intact', async () => {
  const previous = { support: { system: 'lubfy', problem: 'Login inagoma', waitingFor: 'check' } };
  const reply = await say('Naomba mhudumu', previous);
  assert.equal(reply.handoff, true);
  assert.equal(reply.memory.lastSupport?.problem, 'Login inagoma');
});

test('a support check answers a how-to question and closes on conversational confirmation', async () => {
  const symptom = await say('WoteFy vifaa vyangu vinawaka na kuzima');
  const help = await say('Sawa, naangaliaje hiyo taa?', symptom.memory);
  assert.match(help.body, /alama ya umeme/);
  assert.equal(help.handoff, undefined);
  assert.equal(help.memory.support.waitingFor, 'check');

  const pending = await say('Nitaangalia nikifika site mkuu', help.memory);
  assert.equal(pending.handoff, undefined);
  assert.equal(pending.memory.support.waitingFor, 'check');
  const confirmation = await say('Asante, sasa imefanya kazi mkuu!', pending.memory);
  assert.equal(confirmation.confirmedSupportCheck, true);
  assert.equal(confirmation.memory.supportUpdate.status, 'resolved');
  assert.match(confirmation.memory.lastSupport.problem, /vinawaka na kuzima/);
  const status = await say('Mmefikia wapi na tatizo langu?', confirmation.memory);
  assert.match(status.body, /Kesi imefungwa/);
  const next = await say('LubFy siwezi kuingia kwenye dashboard', confirmation.memory);
  assert.equal(next.memory.supportUpdate, undefined);
  assert.equal(next.memory.support.system, 'lubfy');
});

test('mixed feedback after a check retains the unresolved observation', async () => {
  const symptom = await say('WoteFy vifaa vyangu vinawaka na kuzima');
  const feedback = await say('Kimoja kimewaka lakini kile cha nje bado kinajizima', symptom.memory);
  assert.equal(feedback.handoff, true);
  assert.equal(feedback.confirmedSupportCheck, undefined);
  assert.match(feedback.memory.lastSupport.checkResult, /kile cha nje/);
});

test('support distinguishes multiple devices and accepts an email already provided in the chat', async () => {
  const one = await say('Nina tatizo kwenye LubFy');
  assert.doesNotMatch(one.body, /email/i);
  const two = await say('Nina vifaa vitatu', one.memory);
  assert.match(two.body, /kipi kati ya hivyo/i);
  assert.equal(two.memory.support?.problem, undefined);
  const three = await say('Kile cha nje kinajizima', two.memory);
  assert.match(three.memory.lastSupport?.problem ?? three.memory.support?.problem ?? '', /kile cha nje/i);
  assert.doesNotMatch(three.memory.lastSupport?.problem ?? '', /vifaa vitatu/);

  const known = { support: { problem: 'LubFy imegoma ku-sync', system: 'lubfy', waitingFor: 'email' } };
  const saved = await say('imeli yangu ile ile', known, [{direction:'inbound',body:'customer@example.test'}]);
  assert.equal(saved.memory.lastSupport?.email, 'customer@example.test');
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

test('a repeated greeting keeps the open quote and support intake', async () => {
  const memory = { product: { id: 'ap', name: 'EAP 650' }, lastQuote: 'EAP 650 · TZS 200,000',
    support: { system: 'wotefy', problem: 'Kifaa kimezimika', waitingFor: 'email' } };
  const history = [{ direction: 'outbound', body: 'Habari! Karibu.' }];
  for (const message of ['Habari', 'Habari mkuu', 'Habari\nHabari mkuu', 'Hujambo']) {
    const reply = await say(message, memory, history);
    assert.match(reply.body, /karibu|kusaidia/i, message);
    assert.equal(reply.memory.lastQuote, memory.lastQuote);
    assert.deepEqual(reply.memory.support, memory.support);
    assert.equal(reply.memory.replyStatus, 'answered');
    assert.equal(reply.stage, undefined);
  }
  assert.match((await say('Asante', memory, history)).body, /karibu sana/i);
});

test('messages without sales keywords receive a response without opening a sale', async () => {
  const dialogue = [{ direction: 'outbound', body: 'Niko hapa kukusaidia.' }];
  const reply = await say('Ningependa kuanza ila sijui nianzie wapi', {}, dialogue);
  assert.ok(reply.body);
  assert.equal(reply.stage, undefined);
  const offTopic = await say('Nimelipa chakula', {}, dialogue);
  assert.match(offTopic.body, /WoteFy au LubFy/);
  assert.equal(offTopic.stage, undefined);
});

test('installation advice follows the selected Omada platform and remembers the device model', async () => {
  const one = await say('Nauliza nafungaje TP-Link EAP650?');
  assert.match(one.body, /WoteFy na LubFy/);
  assert.equal(one.memory.setup.model, 'EAP650');
  const two = await say('WoteFy', one.memory);
  assert.match(two.body, /Omada Controller/);
  assert.match(two.body, /portal ya WoteFy/);
  assert.match(two.body, /Nimepata modeli EAP650/);
  const three = await say('firmware ni v1.2.0', two.memory);
  assert.match(three.body, /EAP650 na firmware 1\.2\.0/);
  assert.match(three.body, /jaribu simu moja/);
  assert.equal(three.memory.setup, undefined);
  assert.equal(three.stage, undefined);
});

test('installation advice checks device family and avoids quoting when the customer asks for steps', async () => {
  const m = await say('Jinsi ya kufunga MikroTik hAP ax2 kwenye LubFy');
  assert.match(m.body, /Add Router/);
  assert.match(m.body, /RouterOS/);
  assert.equal(m.stage, undefined);
  const c = await say('Cudy WR3000 nafungaje kwenye WoteFy?');
  assert.match(c.body, /WoteFy hutumia Omada Controller/);
  assert.doesNotMatch(c.body, /^\*Hatua za mwanzo kwenye WoteFy\*/);
  const unknown = await say('Nafungaje switch hii?');
  assert.match(unknown.body, /modeli kamili/);
});

test('a generic router or Comfast gets no automatic compatibility recommendation', async () => {
  const { systemFit } = await import('../dist/assistant.js');
  assert.equal(systemFit({ name: 'Generic router', category: 'Router' }), '');
  assert.equal(systemFit({ name: 'COMFAST AP3000', category: 'Access point' }), '');
  assert.equal(systemFit({ name: 'TP-Link EAP650' }), 'wotefy');
});
