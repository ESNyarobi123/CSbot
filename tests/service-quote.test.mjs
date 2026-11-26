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

const { installationAside, installationOnlyAside, isAffirmation, nearbyModels, resolveDecision, respond, serviceQuestion }
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

test('a fitting quote names both variants, the cable and the full total', async () => {
  const product = { name: 'TP LINK EAP 650', category: 'OUTDOOR ACCESS POINT', type: 'Product',
    price: { amount: 450000, currency: 'TZS' } };
  const quote = await installationAside(product, 'installation na waya meter 15 jumla shingapi', say);
  assert.match(quote, /Type A ni unaponunua kifaa kwetu, Type B ni ukiwa na kifaa chako/);
  assert.match(quote, /Kifaa chetu · Type A/);
  assert.match(quote, /Kifaa chako · Type B/);
  // Type A carries the device we supply; Type B is fitting only because the
  // customer brings the hardware.
  assert.match(quote, /Kifaa chetu · Type A.*TZS 120,000 → jumla na kifaa TZS 570,000/);
  assert.match(quote, /Kifaa chako · Type B.*TZS 80,000 → jumla \(kifaa ni chako\) TZS 80,000/);
  assert.doesNotMatch(quote, /Kifaa chako · Type B.*TZS 530,000/);
  assert.match(quote, /Waya: CAT 6 CABLE — 15 mita = TZS 37,500/);
  assert.match(quote, /Jumla kamili na waya: .*TZS 607,500.*TZS 117,500/);
});

test('a fitting question with no device explains every price-list row', async () => {
  const fees = await installationOnlyAside('bei ya installation na waya meter 15', say);
  assert.match(fees, /AP INSTALLATION TYPE A \(kifaa chetu\): TZS 120,000/);
  assert.match(fees, /AP INSTALLATION TYPE B \(kifaa chako\): TZS 80,000/);
  assert.match(fees, /GM INSTALLATION A \(kifaa chetu\): TZS 150,000/);
  assert.match(fees, /GM INSTALLATION B \(kifaa chako\): TZS 100,000/);
  // Each row carries the cable total so "jumla" is answered, not deferred.
  assert.match(fees, /TZS 157,500/);
  assert.match(fees, /TZS 187,500/);
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
  }, 'Je bei ya installation ni shingapi na waya meter 15 jumla shingapi', []);
  assert.doesNotMatch(outcome.body, /Sijapata bidhaa/);
  assert.doesNotMatch(outcome.body, /Zilizopo karibu/);
  assert.match(outcome.body, /Jumla kamili na waya/);
  assert.match(outcome.body, /TZS 607,500/);
});

test('a plain yes answers the installation offer the bot just made', async () => {
  const outcome = await respond(client, {
    id: '2', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
    mode: 'bot', stage: 'quoted', unread_count: 0, last_body: null, last_at: null,
    memory: { product: { id: 'eap650', name: 'TP LINK EAP 650' }, quoteFor: 'product', awaitingService: true },
  }, 'Ndio', []);
  assert.match(outcome.body, /Installation \(AP\) inalipwa kando/);
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
  }, 'bei ya installation ya EAP 650 na waya meter 10', []);
  assert.match(outcome.body, /TP LINK EAP 650 — TZS 450,000/);
  assert.match(outcome.body, /Jumla kamili na waya/);
  // 15 metres must not be assumed when the customer named 10.
  assert.match(outcome.body, /— 10 mita = TZS 25,000/);
});

test('a generic word does not send a fitting question to the product catalog', async () => {
  const outcome = await respond(client, {
    id: '4', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
    mode: 'bot', stage: 'inquiry', unread_count: 0, last_body: null, last_at: null, memory: {},
  }, 'bei ya installation ya router ni ngapi', []);
  assert.doesNotMatch(outcome.body, /Sijapata bidhaa/);
  assert.match(outcome.body, /AP INSTALLATION TYPE A \(kifaa chetu\)/);
});
