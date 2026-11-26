import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';

process.env.DATABASE_URL = 'postgres://localhost/csbot';
process.env.DEEPSEEK_API_KEY = 'local-test-key';
const { deepseekJson } = await import('../dist/deepseek.js');
const input = { schema: z.object({ answer: z.string() }), system: 'Reply from the facts.',
  prompt: 'hello sender@example.test +255712345678', maxTokens: 100 };
const result = content => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });

test('DeepSeek validates structured replies and removes common account identifiers from text', async (t) => {
  const call = t.mock.method(globalThis, 'fetch', async () => result('{"answer":"Sawa"}'));
  assert.deepEqual(await deepseekJson({ ...input, image: { mimetype: 'image/png', base64: 'AAAA' } }), { answer: 'Sawa' });
  const [url, request] = call.mock.calls[0].arguments;
  const payload = JSON.parse(request.body);
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.equal(payload.model, 'deepseek-flash');
  assert.equal(payload.thinking.type, 'disabled');
  assert.equal(payload.messages[1].content[0].text, 'hello [email] [phone]');
  assert.equal(payload.messages[1].content[1].image_url.url, 'data:image/png;base64,AAAA');
});

test('invalid responses fall back and overload cools down subsequent requests', async (t) => {
  const call = t.mock.method(globalThis, 'fetch', async () => result('{"wrong":"format"}'));
  assert.equal(await deepseekJson(input), undefined);
  call.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  assert.equal(await deepseekJson(input), undefined);
  assert.equal(await deepseekJson(input), undefined);
  assert.equal(call.mock.callCount(), 2);
});
