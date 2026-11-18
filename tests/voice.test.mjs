import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://localhost/csbot';
delete process.env.GEMINI_API_KEY;

const { audioAllowed, audioType, maxAudioBytes, pendingVoice, transcribe } = await import('../dist/voice.js');
const { replyEligible } = await import('../dist/reply-policy.js');

const audio = { mimetype: 'audio/ogg; codecs=opus', bytes: Buffer.from('OggS voice') };

function fakeAi(reply) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async request => {
        calls.push(request);
        return typeof reply === 'function' ? reply(request) : { text: JSON.stringify(reply) };
      },
    },
  };
}

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

test('the transcript is the speech, cleaned, with the audio sent as ogg', async () => {
  const ai = fakeAi({ text: '  Nahitaji access point ya nje,   bei ni shingapi?  ', language: 'sw' });
  const heard = await transcribe(ai, audio);
  assert.equal(heard.text, 'Nahitaji access point ya nje, bei ni shingapi?');
  assert.equal(heard.language, 'sw');
  const [request] = ai.calls;
  assert.equal(request.config.temperature, 0);
  assert.equal(request.contents[0].parts[1].inlineData.mimeType, 'audio/ogg');
  assert.equal(request.contents[0].parts[1].inlineData.data, audio.bytes.toString('base64'));
});

test('an unintelligible note yields no text rather than invented words', async () => {
  const heard = await transcribe(fakeAi({ text: '   ', language: '' }), audio);
  assert.equal(heard.text, '');
  assert.equal(heard.language, '');
});

test('every model failing returns undefined so the chat can go to a person', async () => {
  const failing = fakeAi(() => { throw new Error('503'); });
  assert.equal(await transcribe(failing, audio), undefined);
  assert.ok(failing.calls.length >= 1);
});

test('without a Gemini key there is no transcription attempt', async () => {
  assert.equal(await transcribe(undefined, audio), undefined);
});

test('the placeholder is silent but the recovered words are answered', () => {
  // This is why the worker transcribes before it decides: the placeholder alone
  // never reaches the conversational engine.
  assert.equal(replyEligible('[WhatsApp audio]', {}, [], false), false);
  assert.equal(replyEligible('Nahitaji access point ya nje', {}, [], false), true);
});
