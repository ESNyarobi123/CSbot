import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
process.env.DEEPSEEK_API_KEY = 'local-test-key';

const { audioAllowed, audioType, maxAudioBytes, pendingVoice, transcribe } = await import('../dist/voice.js');
const { replyEligible } = await import('../dist/reply-policy.js');

const audio = { mimetype: 'audio/ogg; codecs=opus', bytes: Buffer.from('OggS voice') };

test('a WhatsApp voice note is an accepted audio attachment', () => {
  assert.equal(audioType('audio/ogg; codecs=opus'), 'audio/ogg');
  assert.equal(audioAllowed('audio/ogg; codecs=opus', 1000), true);
  assert.equal(audioAllowed('audio/mp4', 1000), true);
  assert.equal(audioAllowed('image/jpeg', 1000), false);
  assert.equal(audioAllowed('audio/ogg', 0), false);
  assert.equal(audioAllowed('audio/ogg', maxAudioBytes + 1), false);
});

test('only the placeholder body counts as an unread voice note', () => {
  assert.equal(pendingVoice('[WhatsApp audio]'), true);
  assert.equal(pendingVoice('  [WhatsApp voice note] '), true);
  assert.equal(pendingVoice('Nahitaji access point'), false);
  assert.equal(pendingVoice('[WhatsApp image]'), false);
});

test('English audio uses the speech endpoint with an Ogg file', async (t) => {
  const call = t.mock.method(globalThis, 'fetch', async () => Response.json({ text: '  I need  an access point. ' }));
  assert.deepEqual(await transcribe(audio, 'en'), { text: 'I need an access point.' });
  const [url, request] = call.mock.calls[0].arguments;
  assert.equal(url, 'https://api.deepseek.com/v1/tools/asr');
  assert.equal(request.body.get('file').type, 'audio/ogg');
  assert.equal(await request.body.get('file').text(), 'OggS voice');
});

test('Kiswahili and unclassified voice notes go to staff without calling ASR', async (t) => {
  const call = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected'); });
  assert.equal(await transcribe(audio, 'sw'), undefined);
  assert.equal(await transcribe(audio), undefined);
  assert.equal(call.mock.callCount(), 0);
});

test('blank or unavailable ASR results go to staff', async (t) => {
  const call = t.mock.method(globalThis, 'fetch', async () => Response.json({ text: '   ' }));
  assert.equal(await transcribe(audio, 'en'), undefined);
  call.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  assert.equal(await transcribe(audio, 'en'), undefined);
});

test('the placeholder is silent but the recovered words are answered', () => {
  // This is why the worker transcribes before it decides: the placeholder alone
  // never reaches the conversational engine.
  assert.equal(replyEligible('[WhatsApp audio]', false), false);
  assert.equal(replyEligible('Nahitaji access point ya nje', false), true);
});
