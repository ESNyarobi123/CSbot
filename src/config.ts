import { z } from 'zod';

const optional = z.preprocess(value => value === '' ? undefined : value, z.string().optional());

export const config = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  ADMIN_API_TOKEN: optional,
  SESSION_KEY: optional,
  ALLOW_MOCK: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  DEEPSEEK_API_KEY: optional,
  GOOGLE_SPEECH_CREDENTIALS: optional,
  DEEPSEEK_MODEL: z.literal('deepseek-flash').default('deepseek-flash'),
  SYNC_FULL_HISTORY: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  POS_BASE_URL: z.preprocess(value => value === '' ? undefined : value,
    z.url({ protocol: /^https?$/ }).optional()),
  POS_API_TOKEN: optional,
  CSOLUTION_POS_DB_URL: optional,
  CSOLUTION_QUOTATION_URL: z.preprocess(value => value === '' ? undefined : value, z.url({ protocol: /^https?$/ }).optional()),
  CSOLUTION_QUOTATION_TOKEN: optional,
  WOTEFY_PLANS_URL: optional,
  LUBFY_PLANS_URL: optional,
  WOTEFY_DIAGNOSTICS_URL: optional,
  WOTEFY_DIAGNOSTICS_KEY: optional,
  LUBFY_DIAGNOSTICS_URL: optional,
  LUBFY_DIAGNOSTICS_KEY: optional,
  POS_BRANCH_ID: optional,
  PRODUCT_IMAGE_HOSTS: z.string().default('').transform(value =>
    value.split(',').map(host => host.trim().toLowerCase()).filter(Boolean)),
  DEBOUNCE_MS: z.coerce.number().int().min(0).max(5000).default(1250),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  // A chat taken over by a human stays silent until an agent releases it. Real
  // agents miss that, so an idle handoff returns to the bot after this window.
  // 0 disables the resume. Notification-only sends use takeover:false instead.
  HANDOFF_IDLE_MINUTES: z.coerce.number().int().min(0).max(10080).default(180),
  // Proactive follow-ups. Hours after the event; 0 disables that follow-up.
  FOLLOWUP_QUOTE_HOURS: z.coerce.number().int().min(0).max(720).default(24),
  FOLLOWUP_PAYMENT_HOURS: z.coerce.number().int().min(0).max(720).default(1),
  FOLLOWUP_HANDOFF_HOURS: z.coerce.number().int().min(0).max(720).default(2),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
}).parse(process.env);

export function sessionKey() {
  const raw = config.SESSION_KEY;
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    throw new Error('SESSION_KEY must be 32 random bytes encoded in base64');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('Invalid SESSION_KEY length');
  return key;
}
