import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db, row, transaction } from './db.js';

try {
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('csbot-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = new URL('../db/migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await row(client, 'SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (applied?.checksum === checksum) continue;
      if (applied) throw new Error(`Migration changed after application: ${name}`);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)', [name, checksum]);
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await db.end();
}
