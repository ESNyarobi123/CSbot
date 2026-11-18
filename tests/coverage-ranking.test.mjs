import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';

// A customer's distance is a requirement, not a model number. The device that
// actually reaches it may sit below the first five catalog rows, so the answer
// has to come from the recorded datasheet, not from catalog order.
const products = [
  { id: 'cf', name: 'COMFAST CF-WA 933', sku: 'CFWA933', type: 'Product', unit: 'pcs',
    brand: 'COMFAST', category: 'ACCESS POINT', description: '<p>Outdoor Wi-Fi 6 AP</p>',
    price: { amount: 550000, currency: 'TZS' }, images: [] },
  { id: 'rap', name: 'RG RAP 52 OD', sku: 'RAP52OD', type: 'Product', unit: 'pcs',
    brand: 'RUIJIE', category: 'ACCESS POINT', description: '<p>Outdoor AP, IP65</p>',
    price: { amount: 270000, currency: 'TZS' }, images: [] },
  { id: 'eap110', name: 'TP LINK EAP 110', sku: 'EAP110', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: 'OUTDOOR ACCESS POINT COVERING 70-100 METRES',
    price: { amount: 200000, currency: 'TZS' }, images: [] },
  { id: 'eap225', name: 'TP LINK EAP 225', sku: 'EAP225', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: 'OUTDOOR ACCESS POINT COVERING UP TO 120 METRES',
    price: { amount: 300000, currency: 'TZS' }, images: [] },
  { id: 'eap610', name: 'TP LINK EAP 610', sku: 'EAP610', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: 'OUTDOOR ACCESS POINT COVERING UP TO 200 METRES',
    price: { amount: 430000, currency: 'TZS' }, images: [] },
  { id: 'eap650', name: 'TP LINK EAP 650', sku: 'EAP650', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'OUTDOOR ACCESS POINT', description: '',
    price: { amount: 450000, currency: 'TZS' }, images: [] },
  { id: 'cudy', name: 'Cudy AP 3000', sku: 'AP3000', type: 'Product', unit: 'pcs',
    brand: 'CUDY', category: 'ACCESS POINT', description: '<p>Outdoor AX3000 AP</p>',
    price: { amount: 300000, currency: 'TZS' }, images: [] },
  { id: 'cat6', name: 'CAT 6 OUTDOOR', sku: 'CAT6', type: 'Product', unit: 'meter',
    brand: 'CSOLUTION', category: 'CABLE', description: '<p>Cable sold per metre</p>',
    price: { amount: 1500, currency: 'TZS' }, images: [] },
];

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const tokens = (url.searchParams.get('search') ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const reply = body => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (url.pathname === '/products') {
    return reply({ items: products.filter(item => tokens.every(token =>
      `${item.name} ${item.sku} ${item.brand ?? ''} ${item.category ?? ''}`.toLowerCase().includes(token))) });
  }
  const availability = /^\/products\/([\w-]+)\/availability$/.exec(url.pathname);
  if (availability) return reply({ available_to_sell: 5 });
  const product = products.find(item => url.pathname === `/products/${item.id}`);
  if (product) return reply(product);
  res.writeHead(404).end('{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.POS_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.GEMINI_API_KEY;
delete process.env.CSOLUTION_POS_DB_URL;

const { respond } = await import('../dist/assistant.js');
const sheet = { model_key: 'CUDYAP3000', brand: 'CUDY', model: 'Cudy AP 3000', deployment: 'outdoor',
  wifi: '802.11ax (Wi-Fi 6, AX3000)', bands: '2.4 GHz + 5 GHz', ports: '1× 10/100/1000 Mbps',
  poe: '802.3af/at PoE', coverage_m: 320, users: 200, notes: null, source_url: null, verified: true };
// Only the datasheet lookup answers; the code under test must not depend on the DB.
const client = { query: async (sql) => ({ rows: /device_specs/.test(sql) ? [sheet] : [] }) };

after(() => server.close());

const conversation = memory => ({
  id: '1', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
  mode: 'bot', stage: 'inquiry', unread_count: 0, last_body: null, last_at: null, memory,
});

test('a stated distance leads with the model whose datasheet reaches it', async () => {
  const outcome = await respond(client, conversation({}), 'Nahitaji access point ya mita 300', []);
  assert.match(outcome.body, /^Kwa mita 300/);
  const lines = outcome.body.split('\n');
  assert.match(lines[1], /Cudy AP 3000 — TZS 300,000 · hadi mita 320/);
  // The cable is not a device and never belongs in this list.
  assert.doesNotMatch(outcome.body, /CAT 6|Waya/);
  // The distance is not read as a model number and the list is not empty.
  assert.ok(outcome.memory.productOptions?.length >= 5);
  assert.equal(outcome.memory.productOptions[0].name, 'Cudy AP 3000');
});

test('a distance nothing reaches is stated honestly, with the highest recorded figure', async () => {
  const outcome = await respond(client, conversation({}), 'Nahitaji access point ya mita 500', []);
  assert.doesNotMatch(outcome.body, /zinafikia kulingana na vipimo/);
  assert.match(outcome.body, /Kwa mita 500, hakuna modeli iliyorekodiwa kufikia umbali huo/);
  assert.match(outcome.body, /hadi mita 320/);
  // The short models are grouped as needing more than one unit, not sold as enough.
  assert.match(outcome.body, /AP ya pili/);
});

test('a customer already on Omada is not led to a model their controller cannot manage', async () => {
  const outcome = await respond(client, conversation({ facts: { fleet: 'omada', coverage_m: '150' } }),
    'Nahitaji access point ya mita 150', []);
  // The EAP family that joins their controller comes first, even though the
  // Cudy reaches further and the catalog listed it earlier.
  assert.equal(outcome.memory.productOptions[0].name.startsWith('TP LINK EAP'), true);
  // And the mismatched model is named as needing its own cloud, not silently dropped.
  assert.match(outcome.body, /Kwa kuwa unatumia Omada/);
  assert.match(outcome.body, /Cudy AP 3000.*zinahitaji mfumo wao|zinahitaji mfumo wao.*Cudy AP 3000/);
});

test('a cable order keeps its metre price', async () => {
  const outcome = await respond(client, conversation({}), 'Nahitaji waya mita 300', []);
  assert.match(outcome.body, /1,500/);
  assert.doesNotMatch(outcome.body, /hadi mita 320/);
});

test('a spec question about a new model is not answered with the last device', async () => {
  const first = await respond(client, conversation({}), 'TP LINK EAP 610', []);
  assert.equal(first.memory.product?.name, 'TP LINK EAP 610');
  const outcome = await respond(client, conversation(first.memory), 'Cudy AP 3000 ina ports ngapi?', []);
  assert.match(outcome.body, /^Cudy AP 3000 — TZS 300,000/);
  assert.match(outcome.body, /Outdoor AX3000 AP/);
  assert.doesNotMatch(outcome.body, /EAP 610|hadi mita 200/);
  assert.equal(outcome.memory.product?.name, 'Cudy AP 3000');
  // The follow-up still belongs to the device just discussed.
  const follow = await respond(client, conversation(outcome.memory), 'Ina uwezo wa kwenda umbali gani?', []);
  assert.match(follow.body, /^Cudy AP 3000/);
  assert.doesNotMatch(follow.body, /EAP 610/);
});
