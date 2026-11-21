import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
process.env.GEMINI_MODEL = 'primary';
process.env.GEMINI_FALLBACK_MODEL = 'fallback';
const { availableModels, recordModelFailure } = await import('../dist/gemini-availability.js');

test('overload skips only the affected model and restores it after the cooldown', () => {
  recordModelFailure('primary', { status: 503 }, 100);
  assert.deepEqual(availableModels(101), ['fallback']);
  recordModelFailure('fallback', { status: 429 }, 200);
  assert.deepEqual(availableModels(201), []);
  assert.deepEqual(availableModels(30100), ['primary']);
  assert.deepEqual(availableModels(60200), ['primary', 'fallback']);
  recordModelFailure('primary', new SyntaxError('Invalid output'), 60300);
  assert.deepEqual(availableModels(60301), ['primary', 'fallback']);
});
