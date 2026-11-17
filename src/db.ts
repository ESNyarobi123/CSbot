import pg, { type PoolClient, type QueryResultRow } from 'pg';
import pino from 'pino';
import { config } from './config.js';

export const log = pino({ level: config.LOG_LEVEL, base: undefined });
export const db = new pg.Pool({
  connectionString: config.DATABASE_URL,
  connectionTimeoutMillis: 4000,
  keepAlive: true,
});

db.on('error', error => log.error({ code: error.name }, 'Idle database connection failed'));

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function row<T extends QueryResultRow>(
  client: typeof db | PoolClient, sql: string, params: unknown[] = [],
): Promise<T | undefined> {
  return (await client.query<T>(sql, params)).rows[0];
}
