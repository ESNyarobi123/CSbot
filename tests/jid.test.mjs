import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
const { isIgnoredJid, pairingNumber } = await import('../dist/jid.js');

test('only one-to-one chats reach the sales inbox', () => {
  assert.equal(isIgnoredJid('255700200020@s.whatsapp.net'), false);
  assert.equal(isIgnoredJid('120363000000000001@g.us'), true);
  assert.equal(isIgnoredJid('status@broadcast'), true);
  assert.equal(isIgnoredJid('123456789@broadcast'), true);
  assert.equal(isIgnoredJid('120363000000000001@newsletter'), true);
});

test('pairing codes need the international number without punctuation', () => {
  assert.equal(pairingNumber('+255 712 345 678'), '255712345678');
  assert.equal(pairingNumber('255-712-345-678'), '255712345678');
});
