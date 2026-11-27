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

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const tokens = (url.searchParams.get('search') ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const reply = (body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
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
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.DEEPSEEK_API_KEY;
delete process.env.CSOLUTION_POS_DB_URL;
delete process.env.WOTEFY_PLANS_URL;
delete process.env.LUBFY_PLANS_URL;

const { installationAside, installationOnlyAside, isAffirmation, nearbyModels, resolveDecision, respond, customerTurn, serviceQuestion }
  = await import('../dist/assistant.js');
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
