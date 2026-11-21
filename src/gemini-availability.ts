import { config } from './config.js';

// Each running service remembers a provider overload across text, vision and voice.
const retryAfter = new Map<string, number>();

export function availableModels(now = Date.now()) {
  return [...new Set([config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODEL])]
    .filter(model => (retryAfter.get(model) ?? 0) <= now);
}

export function recordModelFailure(model: string, error: unknown, now = Date.now()) {
  const status = Number((error as { status?: unknown } | null)?.status);
  const delay = status === 429 ? 60_000 : status === 503 ? 30_000 : 0;
  if (delay) retryAfter.set(model, now + delay);
}
