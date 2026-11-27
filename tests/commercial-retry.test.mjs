import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
const { acknowledgesCatalogWait } = await import('../dist/commercial-retry.js');
const { retryableSourceFailure, SourceHttpError, documentJson } = await import('../dist/pos.js');

test('catalog retries are restricted to timeouts, connectivity or transient source responses', async () => {
  await assert.rejects(documentJson(new Response('unavailable', { status: 503 })), error => retryableSourceFailure(error));
  assert.equal(retryableSourceFailure(new SourceHttpError(429)), true);
  assert.equal(retryableSourceFailure(new SourceHttpError(404)), false);
  assert.equal(retryableSourceFailure(new SourceHttpError(401)), false);
  assert.equal(retryableSourceFailure(new Error('invalid catalog schema')), false);
  assert.equal(retryableSourceFailure(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })), true);
});

test('waiting for a check keeps it scheduled but a new detail or request does not', () => {
  for (const text of ['Sawa mkuu!', 'Asante sana', 'Sawa nitasubiri']) assert.ok(acknowledgesCatalogWait(text), text);
  for (const text of ['Sawa, na waya mita 50 je?', 'Nataka kifaa chengine', 'acha', 'Bei gani?']) {
    assert.equal(acknowledgesCatalogWait(text), false, text);
  }
});
