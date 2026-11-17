import { db, log } from './db.js';

/**
 * Writes a liveness row so Docker health checks can prove that a long-running service is still
 * turning its main loop and can reach PostgreSQL. Failures are logged, never thrown.
 */
export async function beat(name: string, detail: Record<string, unknown> = {}) {
  try {
    await db.query(`INSERT INTO service_heartbeats (name,beat_at,detail) VALUES ($1,now(),$2)
      ON CONFLICT (name) DO UPDATE SET beat_at=now(),detail=EXCLUDED.detail`, [name, detail]);
  } catch (error) {
    log.warn({ service: name, code: (error as Error).name }, 'Service heartbeat could not be stored');
  }
}

/** Returns true when a heartbeat exists and is newer than the given age. */
export async function beatFresh(name: string, maxAgeSeconds = 45) {
  const result = await db.query<{ fresh: boolean }>(`SELECT beat_at > now() - ($2::int * interval '1 second') AS fresh
    FROM service_heartbeats WHERE name=$1`, [name, maxAgeSeconds]);
  return Boolean(result.rows[0]?.fresh);
}
