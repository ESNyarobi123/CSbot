import type { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { config } from './config.js';
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

const heard = z.object({
  text: z.string().max(4000).default(''),
  language: z.enum(['sw', 'en', '']).default(''),
});

/**
 * Recover the speech, never the answer. The model is told to transcribe only,
 * because a model that answers the question would put words in the customer's
 * mouth and the reply pipeline would then quote them back.
 */
export async function transcribe(
  ai: GoogleGenAI | undefined, audio: { mimetype: string; bytes: Buffer },
): Promise<{ text: string; language: 'sw' | 'en' | '' } | undefined> {
  if (!ai) return undefined;
  const models = [...new Set([config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODEL])];
  const systemInstruction = `You transcribe WhatsApp voice notes for Connect Solution, a network-equipment shop in Dar es Salaam.
Return JSON only. "text" is the speech exactly as spoken, in the language used (Kiswahili, English, or a mix of both), keeping model names, numbers and brand names as said.
Do not answer the question, do not summarise, do not translate, do not correct the speaker, do not add words that were not said.
Ignore background noise, music and filler sounds. If there is no intelligible speech, return an empty "text".
"language" is "sw" when the speech is mainly Kiswahili, "en" when mainly English, and "" when there is no speech.`;

  for (const model of models) {
    try {
      const generated = await ai.models.generateContent({
        model,
        config: {
          maxOutputTokens: 900,
          temperature: 0,
          responseMimeType: 'application/json',
          responseJsonSchema: z.toJSONSchema(heard),
          systemInstruction,
        },
        contents: [{
          role: 'user',
          parts: [
            { text: 'Transcribe this voice note.' },
            { inlineData: { mimeType: audioType(audio.mimetype), data: audio.bytes.toString('base64') } },
          ],
        }],
      });
      const value = heard.parse(JSON.parse(generated.text ?? ''));
      const text = value.text.replace(/\s+/g, ' ').trim();
      if (!text) return { text: '', language: '' };
      return { text: text.slice(0, 1200), language: value.language };
    } catch (error) {
      log.warn({ model, code: (error as { status?: string })?.status,
        error: String((error as Error)?.message ?? error).slice(0, 200) },
      `Transcription model ${model} failed`);
    }
  }
  return undefined;
}
