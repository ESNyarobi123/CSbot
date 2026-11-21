import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
const { labelModel, photoReply, photoInquiry, understoodReply } = await import('../dist/product-photo.js');

test('a photo can identify one printed model; two different models require clarification', () => {
  assert.equal(labelModel('Ruijie Reyee\nRG-RAP62-OD\nWi-Fi 6 AX3000'), 'RG-RAP62-OD');
  assert.equal(labelModel('SKU EAP650  EAP 650'), 'EAP 650');
  assert.equal(labelModel('AX3000 Wi-Fi 6   IP55'), undefined);
  assert.equal(labelModel('Compare EAP 650 and EAP 610'), undefined);
});

test('receipt captions and explicit model names skip image recognition', () => {
  for (const caption of ['Nimelipa hii', 'Bei ya EAP 650?']) {
    assert.equal(photoInquiry(caption, 'inquiry'), false);
  }
  assert.equal(photoInquiry('[WhatsApp image]', 'ready_to_pay'), false);
  assert.equal(photoInquiry('Na weza pata hii kwenu?', 'inquiry'), true);
});

test('an unreadable new photo asks for the label and drops an older product reference', async () => {
  const out = await photoReply({}, { product: { id: 'old', name: 'Old' }, lastQuote: 'old price', language: 'sw' }, sw => sw);
  assert.match(out.body, /modeli.*lebo/);
  assert.equal(out.memory.product, undefined);
  assert.equal(out.memory.lastQuote, undefined);
  assert.equal(out.memory.language, 'sw');
});

test('a Wi-Fi package screenshot is met with a package question, never a label request', () => {
  const out = understoodReply(
    { kind: 'pricing', summary: 'a Wi-Fi package page listing 1GB for TSh 500', brand: '', model: '', confidence: 0.9 },
    { product: { id: 'old', name: 'Old' }, lastQuote: 'old price', language: 'sw' }, sw => sw);
  assert.match(out.body, /package|bei/i);
  assert.doesNotMatch(out.body, /modeli.*lebo/i);
  assert.equal(out.memory.product, undefined);
  assert.equal(out.memory.lastQuote, undefined);
});

test('a login portal is recognised as a portal, not hardware', () => {
  const out = understoodReply(
    { kind: 'portal', summary: 'a Wi-Fi login page', brand: '', model: '', confidence: 0.9 },
    { language: 'en' }, sw => sw);
  assert.match(out.body, /login page/i);
  assert.doesNotMatch(out.body, /model/i);
});

test('a payment receipt is read as a payment, not asked for a device model', () => {
  const out = understoodReply(
    { kind: 'receipt', summary: 'a mobile money payment confirmation', brand: '', model: '', confidence: 0.9 },
    { language: 'sw' }, sw => sw);
  assert.match(out.body, /risiti|malipo/i);
  assert.equal(out.stage, 'payment_reported');
  assert.equal(out.handoff, true);
});

test('an error screen starts a support intake, not a device lookup', () => {
  const out = understoodReply(
    { kind: 'error', summary: 'a red error dialog', brand: '', model: '', confidence: 0.9 },
    { language: 'sw' }, sw => sw);
  assert.match(out.body, /WoteFy|LubFy/);
  assert.doesNotMatch(out.body, /modeli|lebo/i);
  assert.equal(out.memory.support?.waitingFor, 'problem');
});
