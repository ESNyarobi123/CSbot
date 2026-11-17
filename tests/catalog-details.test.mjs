import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';

// Mirrors the real POS: a category word like "access point" matches the product
// category, which is how the 2026-11-17 chat got its model list.
const products = [
  { id: 'ap1', name: 'COMFLAST CF-WA 933', sku: 'CFWA933', type: 'Product', unit: 'pcs',
    brand: 'COMFLAST', category: 'ACCESS POINT', description: '<p>900Mbps outdoor AP, 2.4/5GHz</p>',
    price: { amount: 120000, currency: 'TZS' }, images: [] },
  { id: 'ap2', name: 'RG RAP 52 OD', sku: 'RAP52OD', type: 'Product', unit: 'pcs',
    brand: 'RUIJIE', category: 'ACCESS POINT', description: '<p>Outdoor AP with detachable antenna, IP65</p>',
    price: { amount: 210000, currency: 'TZS' }, images: [] },
  { id: 'ap3', name: 'TP LINK EAP 110', sku: 'EAP110', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: 'OUTDOOR ACCESS POINT COVERING 70-100 METRES',
    price: { amount: 95000, currency: 'TZS' }, images: [] },
  { id: 'ap4', name: 'TP LINK EAP 225', sku: 'EAP225', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: 'OUTDOOR ACCESS POINT COVERING UP TO 120METRES',
    price: { amount: 180000, currency: 'TZS' }, images: [] },
  { id: 'ap5', name: 'TP LINK EAP 610', sku: 'EAP610', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: 'OUTDOOR ACCESS POINT COVERING UP TO 200 METRES',
    price: { amount: 250000, currency: 'TZS' }, images: [] },
  { id: 'ap6', name: 'TP LINK EAP 650', sku: 'EAP650', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: '<p>Outdoor Wi-Fi 6 AP for large yards</p>',
    price: { amount: 450000, currency: 'TZS' }, images: [] },
  { id: 'ap7', name: 'CAMBIUM XV2-21X', sku: 'XV221X', type: 'Product', unit: 'pcs',
    brand: 'CAMBIUM', category: 'ACCESS POINT', description: '<p>Wi-Fi 6 outdoor AP</p>',
    price: { amount: 390000, currency: 'TZS' }, images: [] },
  { id: 'ap8', name: 'COMFAST CF-E5', sku: 'CFE5', type: 'Product', unit: 'pcs',
    brand: 'COMFAST', category: 'ACCESS POINT', description: '<p>Outdoor CPE, 300Mbps</p>',
    price: { amount: 85000, currency: 'TZS' }, images: [] },
  { id: 'ap9', name: 'TPLINK EAP 615 WALL', sku: 'EAP615', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: '<p>Wall plate AP</p>',
    price: { amount: 175000, currency: 'TZS' }, images: [] },
  { id: 'cat6', name: 'CAT 6 CABLE', sku: 'CAT6', type: 'Product', unit: 'meter',
    brand: 'CSOLUTION', category: 'CABLE', description: '<p>Outdoor cable sold per metre</p>',
    price: { amount: 1500, currency: 'TZS' }, images: [] },
  { id: 'svc-a', name: 'AP INSTALLATION TYPE A', sku: 'AP-A', type: 'Service', unit: 'Job',
    brand: null, category: 'SERVICE', description: '', price: { amount: 120000, currency: 'TZS' }, images: [] },
];

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const tokens = (url.searchParams.get('search') ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const reply = (body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (url.pathname === '/products') {
    return reply({ items: products.filter(item => tokens.every(token =>
      `${item.name} ${item.sku} ${item.brand ?? ''} ${item.category ?? ''}`.toLowerCase().includes(token))) });
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
delete process.env.GEMINI_API_KEY;
delete process.env.CSOLUTION_POS_DB_URL;

const { coverageMeters, resolveDecision, respond, serviceQuestion } = await import('../dist/assistant.js');
const client = { query: async () => ({ rows: [] }) };

after(() => server.close());

const conversation = (memory) => ({
  id: '1', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
  mode: 'bot', stage: 'inquiry', unread_count: 0, last_body: null, last_at: null, memory,
});

test('a coverage distance next to a device is not a cable order', () => {
  assert.equal(serviceQuestion('Nahitaji access point ya mita 300'), false);
  assert.equal(coverageMeters('Nahitaji access point ya mita 300'), 300);
  // A real cable question keeps its current meaning.
  assert.equal(serviceQuestion('bei ya waya mita 300'), true);
  assert.equal(coverageMeters('bei ya waya mita 300'), undefined);
});

test('access point plus a distance lists AP models with prices, never cable', async () => {
  const outcome = await respond(client, conversation({}), 'Nahitaji access point ya mita 300', []);
  assert.doesNotMatch(outcome.body, /Waya|CAT 6/);
  assert.doesNotMatch(outcome.body, /TZS 450,000\b.*mita 300/);
  // The list carries a price per model so the customer can choose immediately.
  assert.match(outcome.body, /COMFLAST CF-WA 933 — TZS 120,000/);
  assert.match(outcome.body, /TP LINK EAP 110 — TZS 95,000 · hadi mita 100/);
  assert.match(outcome.body, /TP LINK EAP 610 — TZS 250,000 · hadi mita 200/);
  // 300 m is answered honestly: nothing here records that range, and the models
  // that stop short are grouped as needing a second AP rather than sold as enough.
  assert.match(outcome.body, /Kwa mita 300, hakuna modeli iliyorekodiwa kufikia umbali huo/);
  assert.match(outcome.body, /chini ya mita 300 peke yake/);
  assert.match(outcome.body, /umbali gani kutoka kwenye router/);
  // "300Mbps" must never be read as a coverage distance.
  assert.doesNotMatch(outcome.body, /CF-E5 — TZS 85,000 · hadi mita 300/);
  assert.ok(outcome.memory.productOptions?.length >= 5);
  assert.equal(outcome.memory.optionQuery, 'access point');
});

test('asking for other models widens the list instead of asking for a name', async () => {
  const first = await respond(client, conversation({}), 'Nahitaji access point', []);
  const second = await respond(client, conversation({
    productOptions: first.memory.productOptions, optionQuery: first.memory.optionQuery,
  }), 'Hauna model zingine?', []);
  assert.doesNotMatch(second.body, /Unaulizia bidhaa gani/);
  assert.match(second.body, /model zingine/);
  // Models that were not in the first list appear now.
  assert.match(second.body, /TP LINK EAP 650 — TZS 450,000|CAMBIUM XV2-21X — TZS 390,000|COMFAST CF-E5 — TZS 85,000/);
});

test('picking a model from the list answers with its specs, not the whole category', async () => {
  const first = await respond(client, conversation({}), 'Nahitaji access point', []);
  const picked = first.memory.productOptions.find(item => item.name === 'RG RAP 52 OD');
  assert.ok(picked, 'RG RAP 52 OD must be one of the listed models');
  const outcome = await respond(client, conversation({
    productOptions: first.memory.productOptions, optionQuery: first.memory.optionQuery,
  }), 'RG RAP 52 OD', []);
  assert.match(outcome.body, /RG RAP 52 OD — TZS 210,000/);
  // The catalog description reaches the customer without HTML tags.
  assert.match(outcome.body, /Outdoor AP with detachable antenna, IP65/);
  assert.doesNotMatch(outcome.body, /<p>/);
  assert.equal(outcome.memory.product?.name, 'RG RAP 52 OD');
  assert.equal(resolveDecision('RG RAP 52 OD', {}).intent, 'product');
});

test('a bare model name does not flip a Kiswahili chat to English', async () => {
  const first = await respond(client, conversation({}), 'Nahitaji access point', []);
  assert.equal(first.memory.language, 'sw');
  const outcome = await respond(client, conversation({
    productOptions: first.memory.productOptions, optionQuery: first.memory.optionQuery, language: 'sw',
  }), 'TP LINK EAP 650', []);
  assert.match(outcome.body, /Ipo stock kwa sasa/);
  assert.doesNotMatch(outcome.body, /Currently in stock/);
});

test('a category request wins over a single model the model picked', async () => {
  // Gemini has been seen answering "access point" with one guessed model. The
  // customer asked for the category, so the list is what they must get.
  const outcome = await respond(client, conversation({}), 'Nahitaji access point kwa mita 300', []);
  assert.ok(outcome.memory.productOptions?.length > 1, 'the reply must be a list, not one product');
  assert.equal(outcome.memory.optionQuery, 'access point');
  assert.match(outcome.body, /TZS \d/);
});

test('a question about how far a device reaches is not an installation quote', async () => {
  const first = await respond(client, conversation({}), 'TP LINK EAP 610', []);
  // The bot offered installation at the end of the quote; that offer must not
  // turn a spec question into a fee message.
  assert.equal(first.memory.awaitingService, true);
  const outcome = await respond(client, conversation(first.memory), 'Nahitaji kujua ina uwezo wa Kwenda umbali gani', []);
  assert.doesNotMatch(outcome.body, /Installation/);
  assert.doesNotMatch(outcome.body, /TZS 35,000/);
  // Coverage comes from the catalog description, not from a guess.
  assert.match(outcome.body, /hadi mita 200/);
  assert.match(outcome.body, /enen?o la wazi/);
  assert.equal(outcome.memory.awaitingService, undefined);
});

test('a yes still quotes installation after the offer', async () => {
  const first = await respond(client, conversation({}), 'TP LINK EAP 610', []);
  const outcome = await respond(client, conversation(first.memory), 'Ndio', []);
  assert.match(outcome.body, /Type A/);
  assert.match(outcome.body, /installation TZS 120,000/);
  assert.match(outcome.body, /Jumla kamili na waya/);
});

test('a device with no stated range gets an honest answer, never a guessed number', async () => {
  const first = await respond(client, conversation({}), 'TP LINK EAP 650', []);
  const outcome = await respond(client, conversation(first.memory), 'Ina uwezo wa kwenda umbali gani?', []);
  assert.doesNotMatch(outcome.body, /Installation|TZS 35,000|TZS 50,000/);
  assert.match(outcome.body, /hayataji umbali|sitatoa namba/);
});

test('a plain details request lists what the catalog holds, not a range lecture', async () => {
  const first = await respond(client, conversation({}), 'TP LINK EAP 650', []);
  const outcome = await respond(client, conversation(first.memory),
    'Niambie details zote za kifaa hiki', []);
  // Brand and category are recorded, so they must appear.
  assert.match(outcome.body, /Brand: TP LINK/);
  assert.match(outcome.body, /ACCESS POINT/);
  assert.match(outcome.body, /TZS 450,000/);
  // "details" is English but the sentence around it is not.
  assert.doesNotMatch(outcome.body, /Currently in stock|Bands:|Power:/);
  // Nothing was asked about distance, so no wall-and-trees explanation.
  assert.doesNotMatch(outcome.body, /ukuta|miti|sitatoa namba/);
});

test('a product with no description says so instead of inventing specs', async () => {
  products.push({ id: 'ap-empty', name: 'TP LINK EAP 770', sku: 'EAP770', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'OUTDOOR ACCESS POINT', description: '',
    price: { amount: 500000, currency: 'TZS' }, images: [] });
  const outcome = await respond(client, conversation({}), 'TP LINK EAP 770 ina band gani na ports ngapi?', []);
  assert.doesNotMatch(outcome.body, /\b(2\.4|5\s?GHz|Wi-Fi 6|802\.11)\b/i);
  assert.match(outcome.body, /hayajaingizwa|kuthibitishie/i);
});

test('a coverage question still shows the price and stock of the device', async () => {
  const first = await respond(client, conversation({}), 'TP LINK EAP 610', []);
  const outcome = await respond(client, conversation(first.memory), 'Ina uwezo wa kwenda umbali gani?', []);
  assert.match(outcome.body, /TP LINK EAP 610 — TZS 250,000/);
  assert.match(outcome.body, /Ipo stock/);
  assert.match(outcome.body, /hadi mita 200/);
});
