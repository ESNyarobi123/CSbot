import { beatFresh } from './heartbeat.js';
import { db } from './db.js';

const name = process.argv[2];
const maxAge = Number(process.argv[3] ?? 45);

try {
  if (!name) throw new Error('Usage: node dist/health.js <service> [max-age-seconds]');
  process.exitCode = (await beatFresh(name, Number.isFinite(maxAge) ? maxAge : 45)) ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  await db.end().catch(() => undefined);
}
