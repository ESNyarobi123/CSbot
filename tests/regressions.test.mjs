import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';

/**
 * The five failures found while auditing production on 2026-11-18. Each one
 * answered a real customer badly: the shop address for a 2 km link, "not in the
 * POS" for a hotspot to size, the unit price for three units, silence for
 * "na 610 je?", and a reply that says installation is unrecorded and then
 * quotes it.
 */
const products = [
  { id: 'ap6', name: 'TP LINK EAP 650', sku: 'EAP650', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: '<p>Outdoor Wi-Fi 6 AP for large yards</p>',
    price: { amount: 450000, currency: 'TZS' }, images: [] },
  { id: 'ap5', name: 'TP LINK EAP 610', sku: 'EAP610', type: 'Product', unit: 'pcs',
    brand: 'TP LINK', category: 'ACCESS POINT', description: 'OUTDOOR ACCESS POINT COVERING UP TO 200 METRES',
    price: { amount: 430000, currency: 'TZS' }, images: [] },
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
    return reply({ available_to_sell: products.find(item => item.id === availability[1])?.type === 'Service' ? 0 : 5 });
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
delete process.env.LUBFY_PLANS_URL;
delete process.env.WOTEFY_PLANS_URL;

const { customerTurn, quantityOf, siteRequirement } = await import('../dist/assistant.js');
const { siteDistance } = await import('../dist/brain.js');

// Only the shop's own place answer comes back from "the database"; every other
// lookup returns nothing, which is what the tests below rely on.
const client = {
  query: async (sql) => sql.includes('FROM knowledge')
    ? { rows: [{ content: 'Ofisi iko Sinza Makaburini, Dar es Salaam.' }] }
    : { rows: [] },
};

after(() => server.close());

const conversation = (memory = {}) => ({
  id: '1', account_id: 'a', customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null,
  mode: 'bot', stage: 'inquiry', unread_count: 0, last_body: null, last_at: null, memory,
});
const say = (text, memory = {}, history = []) => customerTurn(client, conversation(memory), text, history);

test('a link between the customer\'s two offices is planned, not answered with our address', async () => {
  const reply = await say('Nahitaji kuunganisha ofisi mbili umbali kilomita 2 kwa wireless, nipendekeze nini?');
  assert.doesNotMatch(reply.body, /Sinza|Makaburini/i);
  assert.match(reply.body, /2000/);
  assert.match(reply.body, /point-to-point|kiungo/i);
  // The shop's own address is still one question away, so the fix did not lose it.
  for (const text of ['Ofisi yenu iko wapi', 'mko wapi', 'ofisini kwenu ni wapi', 'je kuna ofisi sehemu nyingine']) {
    assert.match((await say(text)).body, /Sinza/, text);
  }
});

test('a described site is sized instead of searched as a product', async () => {
  const users = await say('Nina hotspot ya wageni, wateja 80 kwa wakati mmoja');
  assert.doesNotMatch(users.body, /Sijaipata|POS|SKU/i);
  assert.match(users.body, /80/);
  assert.match(users.body, /ndani|nje/);
  assert.match(users.body, /mita/i);
  // Without a user count the same site sentence still needs the two facts.
  const hotspot = await say('Nataka kufungua hotspot ya wageni');
  assert.doesNotMatch(hotspot.body, /Sijaipata|POS/i);
  assert.match(hotspot.body, /ndani|nje/);
});

test('a quantity multiplies the price and is kept in the quote', async () => {
  const reply = await say('Nahitaji EAP 650 vitatu, bei jumla ni ngapi?');
  assert.match(reply.body, /1,350,000/);
  assert.equal(reply.memory.lastQuote, 'TP LINK EAP 650 — TZS 450,000 × 3');
  // A model number is never read as a quantity.
  assert.equal(quantityOf('Bei ya EAP 650'), undefined);
  assert.equal(quantityOf('EAP 650 vitatu'), 3);
  assert.equal(quantityOf('nataka vifaa 4'), 4);
  assert.equal(quantityOf('nipe pcs 2'), 2);
  assert.equal(quantityOf('EAP 610 mbili'), 2);
});

test('a model number typed after a quote is a follow-up, not silence', async () => {
  const first = await say('Bei ya EAP 650');
  const next = await say('na 610 je?', first.memory, [{ direction: 'outbound', body: first.body }]);
  assert.notEqual(next.body, '');
  assert.match(next.body, /610/);
  assert.doesNotMatch(next.body, /Waiting for a business enquiry/);
  const quiet = await say('poa sana', first.memory, [{ direction: 'outbound', body: first.body }]);
  assert.match(quiet.body, /Vizuri/);
});

test('site requirements are read from what the customer wrote', () => {
  assert.deepEqual(siteRequirement('wateja 80 kwa wakati mmoja'), { users: 80, hotspot: false });
  assert.deepEqual(siteRequirement('hotspot ya wageni kwa watumiaji 40'), { users: 40, hotspot: true });
  assert.deepEqual(siteRequirement('bei ya EAP 650'), { users: undefined, hotspot: false });
  assert.deepEqual(siteRequirement('nina wateja wengi sana'), { users: undefined, hotspot: false });
  assert.deepEqual(siteRequirement('hotspot ya wageni'), { users: undefined, hotspot: true });
  // "kilomita" is the spelling customers actually use.
  assert.equal(siteDistance('umbali kilomita 2'), 2000);
  assert.equal(siteDistance('kilometa 2'), 2000);
  assert.equal(siteDistance('mita 300'), 300);
});
