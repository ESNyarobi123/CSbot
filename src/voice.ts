import { config } from './config.js';
import { documentJson } from './pos.js';
import { z } from 'zod';
import { log } from './db.js';

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

// The ASR supported language list includes English. A chat that primarily
// uses Swahili or has no language history stays with human transcription.
export async function transcribe(
  audio: { mimetype: string; bytes: Buffer }, language?: 'sw' | 'en',
): Promise<{ text: string } | undefined> {
  const key = config.DEEPSEEK_API_KEY;
  const type = audioType(audio.mimetype);
  if (!key || language !== 'en' || Date.now() < retryAfter ||
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
