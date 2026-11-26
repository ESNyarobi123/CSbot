import { z } from 'zod';
import { config } from './config.js';
import { log } from './db.js';
import { documentJson } from './pos.js';

const responseSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.literal('stop'),
    message: z.object({ content: z.string().trim().min(1) }),
  })).min(1),
});
let retryAfter = 0;

function redact(text: string) {
  return text
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '[email]')
    .replace(/(?<![\w])(?:\+?255[ -]?|0)(?:[ -]?\d){9}\b/g, '[phone]')
    .replace(/\b(?:Bearer\s+|sk-)[a-zA-Z0-9_-]{16,}\b/g, '[credential]');
}

export async function deepseekJson<T extends z.ZodType>(input: {
  schema: T;
  system: string;
  prompt: string;
  maxTokens: number;
  image?: { mimetype: string; base64: string };
}): Promise<z.infer<T> | undefined> {
  const key = config.DEEPSEEK_API_KEY;
  if (!key || Date.now() < retryAfter) return;
  if (input.image && !/^image\/(?:jpeg|png|gif|webp)$/.test(input.image.mimetype)) return;

  try {
    const content = redact(input.prompt);
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.DEEPSEEK_MODEL, thinking: { type: 'disabled' },
        response_format: { type: 'json_object' }, max_tokens: input.maxTokens,
        messages: [
          { role: 'system', content: input.system + '\nReturn one JSON object matching this schema:\n' + JSON.stringify(z.toJSONSchema(input.schema)) },
          { role: 'user', content: input.image ? [
            { type: 'text', text: content },
            { type: 'image_url', image_url: { url: `data:${input.image.mimetype};base64,${input.image.base64}` } },
          ] : content },
        ],
      }),
    });
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      const cooldown = [401, 402, 403].includes(status) ? 300_000 : status === 429 ? 60_000 : status >= 500 ? 30_000 : 0;
      if (cooldown) retryAfter = Math.max(retryAfter, Date.now() + cooldown);
      log.warn({ model: config.DEEPSEEK_MODEL, status }, 'DeepSeek returned an error');
      return;
    }
    const result = responseSchema.parse(await documentJson(response));
    return input.schema.parse(JSON.parse(result.choices[0].message.content));
  } catch (error) {
    log.warn({ model: config.DEEPSEEK_MODEL, code: (error as Error).name }, 'DeepSeek response was unavailable or invalid');
  }
}
