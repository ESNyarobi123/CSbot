import { config } from './config.js';
import { documentJson } from './pos.js';
import { z } from 'zod';
import { log } from './db.js';
import { JWT } from 'google-auth-library';

/**
 * A voice note is a first-class customer message in this market. WhatsApp sends
 * it as an OGG/Opus file, so the bytes are stored like any other attachment and
 * the words are recovered here before the conversation engine sees the turn.
 */
export const maxAudioBytes = 16 * 1024 * 1024;

const allowed = new Set([
  'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/wav', 'audio/webm',
]);

/** The base type without WhatsApp's `; codecs=opus` parameter. */
export function audioType(mimetype: string) {
  return mimetype.split(';')[0].trim().toLowerCase();
}

export function audioAllowed(mimetype: string, bytes: number) {
  const type = audioType(mimetype);
  return allowed.has(type) && bytes > 0 && bytes <= maxAudioBytes;
}

/** A placeholder body means "a voice note arrived and nothing has read it yet". */
export function pendingVoice(body: string) {
  return /^\[WhatsApp (?:audio|voice note)\]$/i.test(body.trim());
}

const heard = z.object({ text: z.string() });
let retryAfter = 0;
let googleAuth: JWT | undefined;

async function transcribeSwahili(audio: { mimetype: string; bytes: Buffer }) {
  const raw = config.GOOGLE_SPEECH_CREDENTIALS;
  const type = audioType(audio.mimetype);
  if (!raw || !['audio/ogg', 'audio/wav'].includes(type) || audio.bytes.length > 7 * 1024 * 1024) return;
  try {
    if (!googleAuth) {
      const account = z.object({ type: z.literal('service_account'), client_email: z.email(),
        private_key: z.string().min(1) }).parse(JSON.parse(raw));
      googleAuth = new JWT({ email: account.client_email, key: account.private_key,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    }
    const token = (await googleAuth.getAccessToken()).token;
    if (!token) return;
    const response = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({
        config: { languageCode: 'sw-TZ', alternativeLanguageCodes: ['en-US'], model: 'command_and_search',
          ...(type === 'audio/ogg' ? { encoding: 'OGG_OPUS', sampleRateHertz: 48000 } : {}) },
        audio: { content: audio.bytes.toString('base64') },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      log.warn({ status: response.status }, 'Google Speech could not transcribe a voice note');
      return;
    }
    const result = z.object({ results: z.array(z.object({
      alternatives: z.array(z.object({ transcript: z.string() })),
    })).default([]) }).parse(await documentJson(response));
    const text = result.results.map(item => item.alternatives[0]?.transcript ?? '')
      .join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
    return text ? { text } : undefined;
  } catch (error) {
    log.warn({ code: (error as Error).name }, 'Google Speech transcription was unavailable');
  }
}

export async function transcribe(
  audio: { mimetype: string; bytes: Buffer }, language?: 'sw' | 'en',
): Promise<{ text: string } | undefined> {
  if (!audioAllowed(audio.mimetype, audio.bytes.length)) return;
  if (language !== 'en') return transcribeSwahili(audio);
  const key = config.DEEPSEEK_API_KEY;
  const type = audioType(audio.mimetype);
  if (!key || Date.now() < retryAfter ||
      !['audio/ogg', 'audio/wav'].includes(type) || !audio.bytes.length || audio.bytes.length > 8 * 1024 * 1024) return;

  try {
    const form = new FormData();
    const extension = type === 'audio/ogg' ? 'ogg' : 'wav';
    form.set('file', new Blob([new Uint8Array(audio.bytes)], { type }), `voice.${extension}`);
    const response = await fetch('https://api.deepseek.com/v1/tools/asr', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { authorization: 'Bearer ' + key }, body: form,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429 || response.status === 503) retryAfter = Date.now() + 30_000;
      log.warn({ status: response.status }, 'DeepSeek speech recognition returned an error');
      return;
    }
    const text = heard.parse(await documentJson(response)).text.replace(/\s+/g, ' ').trim().slice(0, 1200);
    return text ? { text } : undefined;
  } catch (error) {
    log.warn({ code: (error as Error).name }, 'DeepSeek speech recognition was unavailable');
  }
}
