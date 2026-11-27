import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';

// The catalog is a real HTTP call in production, so the test uses one too.
const products = [
  { id: 'eap650', name: 'TP LINK EAP 650', sku: 'EAP650', type: 'Product', unit: 'pcs',
    brand: 'TP LINK OMADA', category: 'OUTDOOR ACCESS POINT',
    price: { amount: 450000, currency: 'TZS' }, images: [] },
  { id: 'ap-a', name: 'AP INSTALLATION TYPE A', sku: 'AP-A', type: 'Service', unit: 'Job',
    price: { amount: 120000, currency: 'TZS' }, images: [] },
  { id: 'ap-b', name: 'AP INSTALLATION TYPE B', sku: 'AP-B', type: 'Service', unit: 'Job',
    price: { amount: 80000, currency: 'TZS' }, images: [] },
  { id: 'gm-a', name: 'GM INSTALLATION A', sku: 'GM-A', type: 'Service', unit: 'Job',
    price: { amount: 150000, currency: 'TZS' }, images: [] },
  { id: 'gm-b', name: 'GM INSTALLATION B', sku: 'GM-B', type: 'Service', unit: 'Job',
    price: { amount: 100000, currency: 'TZS' }, images: [] },
  { id: 'cat6', name: 'CAT 6 CABLE', sku: 'CAT6', type: 'Product', unit: 'meter',
    price: { amount: 2500, currency: 'TZS' }, images: [] },
];

const proformas = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const tokens = (url.searchParams.get('search') ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const reply = (body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (url.pathname === '/quotations') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    proformas.push(JSON.parse(Buffer.concat(chunks)));
    return reply({ number: 'PF-12345678901234567890', pdf: Buffer.from('%PDF-1.7\nfixture').toString('base64') });
  }
  if (url.pathname === '/service-plans' && url.searchParams.get('system') === 'lubfy') return reply({ items: [
    { name: 'LubFy Growth', price: { amount: 15000, currency: 'TZS' }, billing_period: 'MONTHLY', omada_limit: 1 },
    { name: 'LubFy Power', price: { amount: 25000, currency: 'TZS' }, billing_period: 'MONTHLY', omada_limit: 3 },
    { name: 'LubFy Ultra', price: { amount: 50000, currency: 'TZS' }, billing_period: 'MONTHLY', omada_limit: 5 },
  ] });
  if (url.pathname === '/service-plans') return reply({ items: [
    { name: 'Starter', price: { amount: 10000, currency: 'TZS' }, billing_period: 'MONTHLY', features: [] },
    { name: 'Growth', price: { amount: 25000, currency: 'TZS' }, billing_period: 'MONTHLY',
      setup_fee: { amount: 5000, currency: 'TZS' }, features: [] },
  ] });
  if (url.pathname === '/products') {
    return reply({ items: products.filter(item => tokens.every(token =>
      `${item.name} ${item.sku} ${item.brand ?? ''}`.toLowerCase().includes(token))) });
  }
  const availability = /^\/products\/([\w-]+)\/availability$/.exec(url.pathname);
  if (availability) {
    const item = products.find(entry => entry.id === availability[1]);
    return reply({ available_to_sell: item?.type === 'Service' ? 0 : 5 });
  }
  const product = products.find(item => url.pathname === `/products/${item.id}`);
  if (product) return reply(product);
  res.writeHead(404).end('{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.POS_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.CSOLUTION_QUOTATION_URL = process.env.POS_BASE_URL + '/quotations';
process.env.CSOLUTION_QUOTATION_TOKEN = 'fixture-quotation-token';
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.DEEPSEEK_API_KEY;
delete process.env.CSOLUTION_POS_DB_URL;
delete process.env.WOTEFY_PLANS_URL;
delete process.env.LUBFY_PLANS_URL;

const { installationAside, installationOnlyAside, isAffirmation, nearbyModels, resolveDecision, respond, customerTurn, serviceQuestion }
  = await import('../dist/assistant.js');
const { confirmsProforma } = await import('../dist/quotation.js');
const { config } = await import('../dist/config.js');
const client = { query: async () => ({ rows: [] }) };

after(() => server.close());

const say = (sw) => sw;

test('asking only for installation and cable is not a product search', () => {
  const question = 'Je bei ya installation ni shingapi na waya meter 15 jumla shingapi';
  const decision = resolveDecision(question, { product: { id: 'eap650', name: 'TP LINK EAP 650' } });
  assert.equal(decision.intent, 'product');
  // An empty query is what stops the catalog from searching the whole sentence.
  assert.equal(decision.query, '');
  assert.equal(serviceQuestion(question), true);
  assert.equal(serviceQuestion('bei ya EAP 650'), false);
  assert.equal(isAffirmation('Ndio'), true);
  assert.equal(isAffirmation('bei ya EAP 650'), false);
});

test('a fitting quote selects the shop or customer rate from the stated ownership', async () => {
  const product = { name: 'TP LINK EAP 650', category: 'OUTDOOR ACCESS POINT', type: 'Product',
    price: { amount: 450000, currency: 'TZS' } };
  const supplied = await installationAside(product, 'Nikinunua kwenu installation na waya meter 15', say);
  assert.match(supplied, /Ufungaji TZS 120,000 kwa kazi/);
  assert.match(supplied, /Jumla.*TZS 607,500/);
  assert.doesNotMatch(supplied, /Type A|Type B|TZS 80,000/);
  const existing = await installationAside(product, 'Tayari nina kifaa, bei ya installation na waya mita 15', say);
  assert.match(existing, /Ufungaji TZS 80,000 kwa kazi/);
  assert.match(existing, /Jumla.*TZS 117,500/);
  assert.doesNotMatch(existing, /Type A|Type B|TZS 450,000/);
});

test('a fitting question with no model asks one useful question and keeps the stated cable quote', async () => {
  const fees = await installationOnlyAside('bei ya installation na waya meter 15', say);
  assert.doesNotMatch(fees, /TYPE [AB]/);
  assert.match(fees, /Ni modeli gani/);
  assert.match(fees, /TZS 37,500/);
});

test('a cable-only question quotes cable instead of installation', async () => {
  const cable = await installationOnlyAside('bei ya waya mita 20', say);
  assert.match(cable, /Waya: CAT 6 CABLE — TZS 2,500 kwa mita/);
  assert.match(cable, /Mita 20 = TZS 50,000/);
  assert.doesNotMatch(cable, /AP INSTALLATION/);
});

test('the bot answers the follow-up instead of dumping service names as models', async () => {
  const outcome = await respond(client, {
    id: '1', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
    mode: 'bot', stage: 'quoted', unread_count: 0, last_body: null, last_at: null,
    memory: { product: { id: 'eap650', name: 'TP LINK EAP 650' }, quoteFor: 'product' },
  }, 'Je nikichukua vifaa kwenu bei ya installation ni shingapi na waya meter 15 jumla shingapi', []);
  assert.doesNotMatch(outcome.body, /Sijapata bidhaa/);
  assert.doesNotMatch(outcome.body, /Zilizopo karibu/);
  assert.match(outcome.body, /Jumla/);
  assert.match(outcome.body, /TZS 607,500/);
});

test('a plain yes answers the installation offer the bot just made', async () => {
  const outcome = await respond(client, {
    id: '2', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
    mode: 'bot', stage: 'quoted', unread_count: 0, last_body: null, last_at: null,
    memory: { product: { id: 'eap650', name: 'TP LINK EAP 650' }, quoteFor: 'product', awaitingService: true },
  }, 'Ndio', []);
  assert.match(outcome.body, /utavinunua kwetu au tayari unavyo/);
  assert.equal(outcome.memory.awaitingService, undefined);
});

test('installation rows are never suggested as alternative models', async () => {
  const nearby = await nearbyModels('installation waya meter jumla');
  assert.deepEqual(nearby, []);
});

test('a device named inside the question still gets its own price plus the fitting', async () => {
  const outcome = await respond(client, {
    id: '3', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
    mode: 'bot', stage: 'inquiry', unread_count: 0, last_body: null, last_at: null, memory: {},
  }, 'bei ya installation ya EAP 650 na waya meter 10 nikinunua kwenu', []);
  assert.match(outcome.body, /TP LINK EAP 650 — TZS 450,000/);
  assert.match(outcome.body, /Jumla/);
  // 15 metres must not be assumed when the customer named 10.
  assert.match(outcome.body, /mita 10 × TZS 2,500 = TZS 25,000/);
});

test('a generic word does not send a fitting question to the product catalog', async () => {
  const outcome = await respond(client, {
    id: '4', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
    mode: 'bot', stage: 'inquiry', unread_count: 0, last_body: null, last_at: null, memory: {},
  }, 'bei ya installation ya router ni ngapi', []);
  assert.doesNotMatch(outcome.body, /Sijapata bidhaa/);
  assert.match(outcome.body, /Ni modeli gani/);
});

test('the screenshot journey remembers two devices and 30 metres and adds the chosen system payment', async () => {
  const chat = { id: 'playground', stage: 'inquiry', memory: {} };
  for (const line of ['Bei ya EAP 650', 'nikihitaji mbili inakuwa je', 'na waya meter 30 inakuwa je bei']) {
    const turn = await respond(client, chat, line, []);
    chat.memory = turn.memory;
  }
  assert.equal(chat.memory.installationQuote.quantity, 2);
  assert.equal(chat.memory.installationQuote.cableMeters, 30);
  const bundle = await respond(client, chat, 'sawa sawa kwaiyo nikinunua kwenu vifaa na waya pamoja na installation plus kulipia mfumo kwa mara ya kwanza itakuwa ni bei gani', []);
  assert.match(bundle.body, /2 × TZS 450,000 = TZS 900,000/);
  assert.match(bundle.body, /Ufungaji TZS 120,000 kwa kazi/);
  assert.match(bundle.body, /mita 30 × TZS 2,500 = TZS 75,000/);
  assert.match(bundle.body, /Jumla kabla ya ada ya mfumo.*TZS 1,095,000/);
  assert.match(bundle.body, /WoteFy au LubFy/);
  assert.doesNotMatch(bundle.body, /Type [AB]|mita 15/);

  const plans = await respond(client, { ...chat, memory: bundle.memory }, 'WoteFy', []);
  assert.match(plans.body, /Starter TZS 10,000.*TZS 1,105,000/);
  assert.match(plans.body, /Growth TZS 25,000.*TZS 1,125,000/);
  const selected = await respond(client, { ...chat, memory: plans.memory }, 'Growth', []);
  assert.match(selected.body, /TZS 1,125,000/);
  assert.doesNotMatch(selected.body, /Starter/);
});

test('a two-device LubFy request keeps the order through confirmation and PDF delivery', async () => {
  const chat = { id: 'chat-proforma', stage: 'quoted', memory: {
    language: 'sw', product: { id: 'eap650', name: 'TP LINK EAP 650' }, quoteFor: 'product',
    installationQuote: { productId: 'eap650', quantity: 2, supply: 'shop', wantsCable: true,
      cableMeters: 30, wantsPlan: true, system: 'lubfy', awaiting: 'plan',
      planNames: ['LubFy Growth', 'LubFy Power', 'LubFy Ultra'] },
  } };
  const recovered = await customerTurn(client, structuredClone(chat), 'nitengenezee invoice nitumie nione', [
    { direction: 'inbound', body: 'nataka lubfy ya plan ya vifaa 2' },
    { direction: 'outbound', body: 'TP LINK EAP 650 — TZS 450,000' },
    { direction: 'inbound', body: 'nitengenezee invoice nitumie nione' },
  ]);
  assert.match(recovered.body, /LubFy Power — TZS 25,000/);
  assert.match(recovered.body, /niambie nikutumie PDF/);
  const turn = async (message) => {
    const result = await customerTurn(client, chat, message, [], false, undefined, false, 'account:' + message);
    chat.memory = JSON.parse(JSON.stringify(result.memory, (_key, value) => (
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value
    )));
    return result;
  };
  const plan = await turn('nataka lubfy ya plan ya vifaa 2');
  assert.match(plan.body, /LubFy Power TZS 25,000/);
  assert.doesNotMatch(plan.body, /LubFy (Growth|Ultra)/);
  const preview = await turn('nitengenezee invoice nitumie nione');
  assert.match(preview.body, /TP LINK EAP 650 × 2/);
  assert.match(preview.body, /CAT 6 CABLE, mita 30/);
  assert.match(preview.body, /Ufungaji/);
  assert.match(preview.body, /TZS 1,120,000/);
  assert.match(preview.body, /niambie nikutumie PDF/);
  const pending = structuredClone(chat);
  const changed = await customerTurn(client, structuredClone(pending), 'Ndio ila ongeza waya mita 40', [],
    false, undefined, false, 'account:change');
  assert.equal(changed.document, undefined);
  assert.match(changed.body, /CAT 6 CABLE, mita 40/);
  assert.match(changed.body, /Ufungaji/);
  assert.match(changed.body, /LubFy Power/);
  assert.equal(proformas.length, 0);
  const sent = await turn('Ndio mkuu');
  assert.match(sent.body, /PF-12345678901234567890/);
  assert.match(sent.document.bytes.toString(), /^%PDF-/);
  assert.equal(chat.memory.documentRequest, undefined);
  assert.deepEqual(proformas[0].items.map(({ productId, quantity, role }) => [productId, quantity, role]),
    [['eap650', 2, 'device'], ['cat6', 30, 'cable'], ['ap-a', 1, 'installation']]);
  assert.equal(proformas[0].plan.name, 'LubFy Power');
  assert.equal(chat.memory.issuedProforma.number, 'PF-12345678901234567890');
  const pay = await turn('Nataka kulipia hiyo');
  assert.equal(pay.stage, 'ready_to_pay');
  assert.match(pay.body, /PF-12345678901234567890/);
  assert.match(pay.memory.documentSummary, /CAT 6 CABLE, mita 30/);
  const afterIssueEdit = await customerTurn(client, structuredClone(chat), 'Ongeza waya mita 45', [],
    false, undefined, false, 'account:after-issue-edit');
  assert.equal(afterIssueEdit.document, undefined);
  assert.equal(afterIssueEdit.memory.issuedProforma, undefined);
  assert.equal(afterIssueEdit.memory.supersededProforma, true);
  assert.match(afterIssueEdit.body, /CAT 6 CABLE, mita 45/);
  const prematurePayment = await customerTurn(client, { ...chat, memory: afterIssueEdit.memory }, 'Nataka kulipia hiyo', [],
    false, undefined, false, 'account:revised-payment');
  assert.equal(prematurePayment.stage, undefined);
  assert.match(prematurePayment.body, /Tuthibitishe kwanza proforma hii/);
  assert.ok(prematurePayment.memory.documentRequest?.order);

  const history = [
    { direction: 'outbound', body: preview.body },
    { direction: 'inbound', body: 'Ndio mkuu' },
    { direction: 'outbound', body: 'Karibu. Niambie unahitaji nini — mfumo, kifaa, au msaada wa tatizo lolote?' },
  ];
  delete pending.memory.documentRequest;
  const oldChat = await customerTurn(client, pending, 'Ndio ila ufanye alaka', history,
    false, undefined, false, 'account:previous-chat');
  assert.ok(oldChat.document);
  const afterDelivery = await customerTurn(client, { ...pending, memory: oldChat.memory }, 'Ndio mkuu', [
    ...history, { direction: 'outbound', body: oldChat.body },
  ], false, undefined, false, 'account:after-delivery');
  assert.equal(afterDelivery.document, undefined);
  assert.equal(proformas.length, 2);
});

test('proforma confirmation accepts natural assent and leaves changes and questions unconfirmed', () => {
  for (const phrase of ['Ndiyo', 'Ndio mkuu', 'Mkuu, ndio', 'Ndio ila ufanye alaka', 'Sawa boss, nitumie PDF',
    'Nimekubali, tafadhali tuma', 'Yes, please send it', 'Tuma PDF sasa hivi']) {
    assert.ok(confirmsProforma(phrase), phrase);
  }
  for (const phrase of ['Mkuu', 'Asante', 'Hapana', 'Ndio?', 'Ndio ila usitume', 'Sawa ila subiri',
    'Ndio ila ongeza waya mita 40', 'Ndiyo, lakini nipe WoteFy', 'Sawa unamaanisha nini']) {
    assert.equal(confirmsProforma(phrase), false, phrase);
  }
});

test('a paraphrased document request and contextual reply go through the same verified PDF flow', async (t) => {
  const chat = { id: 'contextual-proforma', stage: 'quoted', memory: {
    language: 'sw', product: { id: 'eap650', name: 'TP LINK EAP 650' }, quoteFor: 'product',
    installationQuote: { productId: 'eap650', quantity: 2, supply: 'shop', wantsCable: true,
      cableMeters: 30, wantsPlan: true, system: 'lubfy', awaiting: 'plan' },
  } };
  chat.memory = (await customerTurn(client, chat, 'nataka lubfy ya plan ya vifaa 2', [])).memory;
  const originalFetch = globalThis.fetch;
  const replies = [
    { intent: 'document_preview', language: 'sw', query: '' },
    { intent: 'order_question' },
    { intent: 'unclear' },
    { intent: 'approve' },
  ];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== 'https://api.deepseek.com/chat/completions') return originalFetch(url, options);
    const answer = replies.shift();
    assert.ok(answer, 'unexpected model request');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] });
  });
  config.DEEPSEEK_API_KEY = 'test-only';
  t.after(() => { config.DEEPSEEK_API_KEY = undefined; });
  const send = async (text) => {
    const outcome = await customerTurn(client, chat, text, [], false, undefined, false, 'contextual:' + text);
    chat.memory = outcome.memory;
    return outcome;
  };
  const preview = await send('Nipatie ile karatasi yenye mchanganuo wa gharama zote');
  assert.match(preview.body, /niambie nikutumie PDF/);
  assert.equal(preview.document, undefined);
  const question = await send('Hizo gharama za mwanzo zinajumuisha nini?');
  assert.match(question.body, /CAT 6 CABLE, mita 30/);
  assert.ok(chat.memory.documentRequest?.order);
  assert.equal((await send('Ngoja nione kwanza inakuwaje')).document, undefined);
  const confirmation = 'Hiyo hesabu imenikaa vizuri, iweke hapa niwe nayo';
  assert.equal(confirmsProforma(confirmation), false);
  assert.ok((await send(confirmation)).document);
  assert.equal(chat.memory.documentRequest, undefined);
  assert.deepEqual(replies, []);
});

test('an Omada buyer asking for advice gets a recommendation before LubFy prices', async () => {
  const chat = { id: 'playground', stage: 'quoted', memory: {
    product: { id: 'eap650', name: 'TP LINK EAP 650' }, quoteFor: 'product',
    installationQuote: { productId: 'eap650', quantity: 2, supply: 'shop', wantsCable: true,
      cableMeters: 30, wantsPlan: true, awaiting: 'system' },
  } };
  const advice = await respond(client, chat,
    'mimi nahitaji lubfy ila unanishauli je kwa wewe unavyo kati ya vifaa hivi je mfumo upi ni best', []);
  assert.match(advice.body, /EAP 650.*ningependekeza \*WoteFy\*/);
  assert.match(advice.body, /LubFy.*Omada Controller/);
  assert.doesNotMatch(advice.body, /MikroTik|firmware|TZS/);
  assert.ok(advice.body.length <= 330);
  assert.equal(advice.stage, undefined);
  assert.equal(advice.memory.installationQuote.awaiting, 'system');
  assert.equal(advice.memory.installationQuote.system, 'lubfy');
  assert.equal(advice.memory.installationQuote.quantity, 2);
  assert.equal(advice.memory.installationQuote.cableMeters, 30);

  const reply = await customerTurn(client, { ...chat, memory: advice.memory }, 'Sawa', []);
  assert.match(reply.body, /\*LubFy\*/);
  assert.match(reply.body, /Jumla kabla ya ada ya mfumo.*TZS 1,095,000/);
});

test('a recommendation stays grounded when the customer names mixed or unconfirmed hardware', async () => {
  const existing = { id: 'playground', stage: 'quoted', memory: { product: { id: 'eap650', name: 'TP LINK EAP 650' } } };
  const mixed = await respond(client, existing, 'Mfumo upi ni best kwa Omada EAP650 na MikroTik?', []);
  assert.match(mixed.body, /ningependekeza \*LubFy\*/);
  const other = await respond(client, existing, 'Kwa COMFAST CF-E5 mfumo upi ni best?', []);
  assert.match(other.body, /modeli gani/);
  assert.doesNotMatch(other.body, /ningependekeza/);
});
