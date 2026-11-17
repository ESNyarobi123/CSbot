import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';

const { specKey, specKeys, specLines } = await import('../dist/specs.js');

const say = (sw) => sw;

test('the model key survives the way customers type a model', () => {
  const forms = ['TP-LINK EAP650', 'tplink eap-650', 'Tp Link  EAP 650'];
  for (const value of forms) assert.equal(specKey(value), 'TPLINKEAP650', value);
  for (const value of ['EAP-650', 'eap 650']) assert.equal(specKey(value), 'EAP650', value);
});

test('a product name, its brand-stripped form and its SKU all reach the row', () => {
  const keys = specKeys({ name: 'TP LINK EAP 610', sku: 'EAP610', brand: 'TP LINK' });
  assert.ok(keys.includes('TPLINKEAP610'));
  assert.ok(keys.includes('EAP610'));
  assert.deepEqual(specKeys({ name: 'CAT 6 OUTDOOR' }), ['CAT6OUTDOOR']);
});

test('keys without a digit are skipped so a cable is not matched as a device', () => {
  assert.deepEqual(specKeys({ name: 'ACCESS POINT', brand: 'TP LINK' }), []);
});

test('only recorded spec fields are printed', () => {
  const lines = specLines({
    model_key: 'EAP610', brand: 'TP-Link', model: 'EAP610-Outdoor', deployment: 'outdoor',
    wifi: '802.11ax (Wi-Fi 6, AX1800)', bands: '2.4 GHz + 5 GHz', ports: '1× 10/100/1000 Mbps',
    poe: '802.3af/at PoE', coverage_m: 200, users: null, notes: null, source_url: null, verified: true,
  }, say);
  assert.match(lines.join('\n'), /nje \(outdoor\)/);
  assert.match(lines.join('\n'), /Wi-Fi 6/);
  assert.match(lines.join('\n'), /hadi mita 200/);
  // No concurrency figure was recorded, so none is claimed.
  assert.doesNotMatch(lines.join('\n'), /wateja hadi/i);
});

test('an empty row prints nothing at all', () => {
  const lines = specLines({
    model_key: 'X', brand: null, model: 'X', deployment: null, wifi: null, bands: null,
    ports: null, poe: null, coverage_m: null, users: null, notes: null, source_url: null, verified: false,
  }, say);
  assert.deepEqual(lines, []);
});
