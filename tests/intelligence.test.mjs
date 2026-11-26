import assert from 'node:assert/strict';
import { test } from 'node:test';

// The thinking layer: what the bot remembers, and the rule that a written
// answer may not contain a figure the shop never recorded.
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.DEEPSEEK_API_KEY;

const { factBrief, factList, grounded, numbersIn, recall } = await import('../dist/brain.js');
const { specBrief, specLines } = await import('../dist/specs.js');
const { regionQuestion } = await import('../dist/customer-text.js');
const { profitQuestion } = await import('../dist/customer-text.js');

const say = (sw) => sw;

test('a distance and a client count become site facts', () => {
  const facts = recall('Nahitaji access point ya mita 300 kwa wateja 120 kwenye uwanja wa wazi');
  assert.equal(facts.coverage_m, '300');
  assert.equal(facts.clients, '120');
  assert.equal(facts.site, 'open');
});

test('walls and trees mark the site as obstructed', () => {
  assert.equal(recall('eneo lina kuta na miti').site, 'obstructed');
});

test('the equipment already owned is kept, not replaced', () => {
  const first = recall('Nina Omada controller nyumbani');
  assert.equal(first.fleet, 'omada');
  assert.match(first.equipment, /OMADA/);
  const second = recall('Nina pia EAP 610', first);
  assert.match(second.equipment, /OMADA/);
  assert.match(second.equipment, /EAP 610/);
});

test('a business-planning sentence remembers the town and the goal', () => {
  const facts = recall('Hivi ukija iringa mjini ukafanya survey unashauri ni invest aje kwenye wifi billing');
  assert.equal(facts.town, 'iringa');
  assert.equal(facts.goal, 'start a wifi billing site');
  assert.equal(recall('Nahitaji access point').goal, undefined);
});

test('a system + region question is geographic, never a site-size question', () => {
  assert.equal(regionQuestion('Nauliza kama mfumo wenu wa wotefy unafanya kazi east africa nzima au'), true);
  assert.equal(regionQuestion('Does your WoteFy system work across all of East Africa?'), true);
  assert.equal(regionQuestion('WoteFy inasaidia nchi zipi?'), true);
  // A distance or coverage figure is still site planning, not a region question.
  assert.equal(regionQuestion('Nahitaji AP ya mita 300 kwa wateja 120 kwenye uwanja wa wazi'), false);
  assert.equal(regionQuestion('Na kwa eneo lile unafikilia nitumie eap gani au ap gani'), false);
});

test('a profitability question is about the business, never a product lookup', () => {
  assert.equal(profitQuestion('nipo kigoma mjini hilo eneo mkiangalia naweza pata faida kwa biashara hii'), true);
  assert.equal(profitQuestion('Je, biashara ya Wi-Fi ina faida?'), true);
  assert.equal(profitQuestion('Naweza pata faida kwa mfumo wa WoteFy?'), true);
  // "naweza pata" alone, or a price/stock word, is not a profit question.
  assert.equal(profitQuestion('Naweza pata hii kwenu?'), false);
  assert.equal(profitQuestion('Bei ya EAP 650 ni ngapi?'), false);
});

test('a use case and a budget are read only when stated', () => {
  const facts = recall('Nataka wifi ya hoteli, bajeti yangu ni 900,000');
  assert.equal(facts.use, 'hotel');
  assert.match(facts.budget, /900,000/);
  assert.equal(recall('Nahitaji access point').budget, undefined);
});

test('facts are listed for the admin without leaking raw keys', () => {
  const listed = factList(recall('mita 300, kuna kuta'));
  assert.ok(listed.some((fact) => fact.label === 'Distance to cover' && fact.value === '300'));
  assert.ok(listed.some((fact) => fact.label === 'Site'));
  assert.match(factBrief(recall('mita 300')), /coverage_m: 300/);
});

test('a composed answer may reuse recorded figures and nothing else', () => {
  const facts = 'Ports: 1× 10/100/1000 Mbps\nStated range: 320 m\nPrice: TZS 300,000';
  assert.equal(grounded('Ina port moja ya 1000 Mbps na bei TZS 300,000.', facts).ok, true);
  const rejected = grounded('Ina ports 4 na bei TZS 300,000.', facts);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.value, '4');
  assert.deepEqual([...numbersIn('mita 1,5 na 320')], ['1.5', '320']);
});

test('the brief carries the fields customers ask about, and no invented ones', () => {
  const brief = specBrief({
    model_key: 'X1', model: 'RG-RAP6262(G)', brand: 'RUIJIE', deployment: 'indoor',
    wifi: '802.11ax (Wi-Fi 6, AX1800)', bands: '2.4 GHz + 5 GHz', ports: '1× 10/100/1000 Mbps',
    poe: '802.3af PoE', coverage_m: null, users: 60, notes: null, source_url: null, verified: false,
    antenna: 'Internal omni-directional', radios: '2.4 GHz 2×2 + 5 GHz 2×2', gain_dbi: 4,
    ip_rating: null, mesh: true, controller: 'Ruijie Reyee cloud', poe_watts: 12.5,
    mounting: 'Ceiling', highlights: ['Reyee units form one network'], aliases: null,
  });
  assert.match(brief, /Antenna: Internal omni-directional/);
  assert.match(brief, /Antenna gain \(dBi\): 4/);
  assert.match(brief, /Mesh: yes/);
  assert.match(brief, /Management: Ruijie Reyee cloud/);
  assert.match(brief, /Concurrent clients: 60/);
  assert.match(brief, /not yet checked/);
  // Nothing recorded means nothing printed.
  assert.doesNotMatch(brief, /Ingress/);
  assert.doesNotMatch(brief, /Stated range/);

  const lines = specLines({
    model_key: 'X1', model: 'RG-RAP6262(G)', brand: null, deployment: null, wifi: null, bands: null,
    ports: null, poe: null, coverage_m: null, users: null, notes: null, source_url: null,
    verified: true, antenna: 'Internal omni-directional', radios: '2.4 GHz 2×2', gain_dbi: null,
    ip_rating: 'IP65', mesh: true, controller: null, poe_watts: null, mounting: null,
    highlights: null, aliases: null,
  }, say);
  assert.ok(lines.some((line) => line.includes('Antena: Internal omni-directional')));
  assert.ok(lines.some((line) => line.includes('IP65')));
  assert.ok(lines.some((line) => line.includes('Mesh: ndio')));
});
