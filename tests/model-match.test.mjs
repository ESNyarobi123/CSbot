import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';

// The shop really stocks both a Cudy AP 1300 and a COMFAST CF-WA 933, and both
// advertise the same speed class, so a loose catalog search returns the pair.
const products = [
  { id: 'cudy13', name: 'Cudy AP 1300', sku: 'AP1300', type: 'Product', unit: 'pcs',
    brand: 'CUDY', category: 'OUTDOOR ACCESS POINT',
    description: 'Outdoor AP ya Wi-Fi 5 AC1200 (300 Mbps 2.4 GHz + 867 Mbps 5 GHz), IP65.',
    price: { amount: 250000, currency: 'TZS' }, images: [] },
  { id: 'comfast', name: 'COMFAST CF-WA 933', sku: 'CFWA933', type: 'Product', unit: 'pcs',
    brand: 'COMFAST', category: 'OUTDOOR ACCESS POINT',
    description: 'Outdoor AP ya Wi-Fi 6 AX3000 (574 Mbps 2.4 GHz + 2400 Mbps 5.8 GHz), IP66.',
    price: { amount: 550000, currency: 'TZS' }, images: [] },
  { id: 'eap650', name: 'TP LINK EAP 650', sku: '650', type: 'Product', unit: 'pcs',
    brand: 'TP LINK OMADA', category: 'OUTDOOR ACCESS POINT',
    description: 'Wi-Fi 6 AX3000, PoE 802.3at.',
    price: { amount: 450000, currency: 'TZS' }, images: [] },
  { id: 'cudy3000', name: 'Cudy AP 3000', sku: 'AP3000', brand: 'CUDY',
    description: 'Outdoor access point', price: { amount: 350000, currency: 'TZS' }, images: [] },
  { id: 'comfast3000', name: 'Comfast Outdoor AP 3000', sku: 'AP3000', brand: 'COMFAST',
    description: 'Outdoor access point', price: { amount: 600000, currency: 'TZS' }, images: [] },
  // Matches an "access point" search only through its description, which is how
  // the cable ended up inside an access-point list in production.
  { id: 'cat6', name: 'CAT 6 OUTDOOR', sku: 'CAT6', type: 'Product', unit: 'meter',
    brand: 'CSOLUTION', category: 'CABLE',
    description: 'Waya wa nje unaotumika kwenye installation ya access point.',
    price: { amount: 1500, currency: 'TZS' }, images: [] },
];

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const tokens = (url.searchParams.get('search') ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const reply = (body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (url.pathname === '/products') {
    // A deliberately loose match: one shared word is enough to return the row.
    return reply({ items: products.filter(item => tokens.some(token =>
      `${item.name} ${item.sku} ${item.brand ?? ''} ${item.category ?? ''} ${item.description ?? ''}`
        .toLowerCase().includes(token))) });
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
const client = { query: async () => ({ rows: [] }) };
const conversation = (memory) => ({
  id: '1', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
  mode: 'bot', stage: 'inquiry', unread_count: 0, last_body: null, last_at: null, memory,
});

after(() => server.close());

test('a named model answers with that model, not the first loose match', async () => {
  const cudy = await respond(client, conversation({}), 'Cudy AP 1300 ina band gani?', []);
  assert.match(cudy.body, /Cudy AP 1300 — TZS 250,000/);
  assert.doesNotMatch(cudy.body, /COMFAST/);

  const comfast = await respond(client, conversation({}), 'COMFAST CF-WA 933 ina band gani?', []);
  assert.match(comfast.body, /COMFAST CF-WA 933 — TZS 550,000/);
  assert.doesNotMatch(comfast.body, /Cudy AP/);

  const eap = await respond(client, conversation({}), 'TP LINK EAP 650 ina band gani?', []);
  assert.match(eap.body, /TP LINK EAP 650/);
  assert.doesNotMatch(eap.body, /Cudy|COMFAST/);
});

test('a model query that matches nothing is not answered with a stranger', async () => {
  const reply = await respond(client, conversation({}), 'Cudy AP 9999 ina band gani?', []);
  assert.doesNotMatch(reply.body, /Cudy AP 1300 —|COMFAST CF-WA 933 —/);
});

test('an access-point list holds devices, not the cable that mentions the words', async () => {
  const reply = await respond(client, conversation({}), 'Nahitaji access point', []);
  assert.doesNotMatch(reply.body, /CAT 6/);
  assert.match(reply.body, /Cudy AP 1300 — TZS 250,000/);

  // The cable is still sold when the customer asks for it by name.
  const cable = await respond(client, conversation({}), 'CAT 6 OUTDOOR bei', []);
  assert.match(cable.body, /CAT 6 OUTDOOR — TZS 1,500/);
});

test('asking about a missing model never quotes the previously selected device', async () => {
  const reply = await respond(client, conversation({ product: { id: 'eap650', name: 'TP LINK EAP 650' } }),
    'EAP 9999 ina band gani?', []);
  assert.doesNotMatch(reply.body, /EAP 650 —|450,000/);
  assert.notEqual(reply.stage, 'quoted');
});


test('a copied storefront order preserves the brand when the model SKU is shared', async () => {
  const { searchProducts } = await import('../dist/pos.js');
  const found = await searchProducts('Comfast Outdoor AP 3000');
  assert.ok(found.items.length > 0);
  assert.ok(found.items.every(item => item.brand === 'COMFAST'));
  const reply = await respond(client, conversation({}),
    'Hello LubFy, I would like to order Comfast Outdoor AP 3000 (AP 3000) at TZS 600,000.', []);
  assert.match(reply.body, /Comfast Outdoor AP 3000/);
  assert.match(reply.body, /600,000/);
  assert.doesNotMatch(reply.body, /Cudy AP 3000|350,000/);
  const absent = await searchProducts('Cambium AP 3000');
  assert.equal(absent.items.length, 0);
});
