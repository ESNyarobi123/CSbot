import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
process.env.DEEPSEEK_API_KEY = 'local-test-key';

const { audioAllowed, audioType, maxAudioBytes, pendingVoice, transcribe } = await import('../dist/voice.js');
const { replyEligible } = await import('../dist/reply-policy.js');
const { config } = await import('../dist/config.js');
const { JWT } = await import('google-auth-library');

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

test('Kiswahili and unclassified voice notes go to staff without Google credentials', async (t) => {
  const call = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected'); });
  assert.equal(await transcribe(audio, 'sw'), undefined);
  assert.equal(await transcribe(audio), undefined);
  assert.equal(call.mock.callCount(), 0);
});

test('configured Tanzanian Swahili voice uses Google Speech with an English alternative', async (t) => {
  config.GOOGLE_SPEECH_CREDENTIALS = JSON.stringify({ type: 'service_account',
    client_email: 'fixture@example.test', private_key: 'fixture' });
  t.after(() => { config.GOOGLE_SPEECH_CREDENTIALS = undefined; });
  t.mock.method(JWT.prototype, 'getAccessToken', async () => ({ token: 'test-google-token' }));
  const call = t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [
    { alternatives: [{ transcript: 'Nahitaji access point' }] },
    { alternatives: [{ transcript: 'ya nje' }] },
  ] }));
  assert.deepEqual(await transcribe(audio), { text: 'Nahitaji access point ya nje' });
  const [url, request] = call.mock.calls[0].arguments;
  assert.equal(url, 'https://speech.googleapis.com/v1/speech:recognize');
  assert.equal(request.headers.authorization, 'Bearer test-google-token');
  const parsed = JSON.parse(request.body);
  assert.equal(parsed.config.languageCode, 'sw-TZ');
  assert.deepEqual(parsed.config.alternativeLanguageCodes, ['en-US']);
  assert.equal(parsed.config.encoding, 'OGG_OPUS');
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
