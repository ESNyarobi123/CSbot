#!/usr/bin/env node
// Archive conversations older than N months to the *_archive tables.
//
// The live tables are the bot's inbox; old chats only slow the queries that
// power it. This moves closed conversations (no open sale) and their messages
// into cold storage, then removes the live rows.
//
//   node scripts/archive.mjs                 # dry run: print what would move
//   node scripts/archive.mjs --apply         # actually move them
//   ARCHIVE_OLDER_THAN_MONTHS=6 node scripts/archive.mjs
//
// Run it from a shell with DATABASE_URL set, or let it read ../.env.

import { readFile } from 'node:fs/promises';
import pg from 'pg';

const env = await (async () => {
  try {
    const text = await readFile(new URL('../.env', import.meta.url), 'utf8');
    return Object.fromEntries(text.split('\n')
      .filter(line => /^[A-Z0-9_]+=/.test(line))
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
  } catch { return {}; }
})();

const apply = process.argv.includes('--apply');
const months = Number(process.env.ARCHIVE_OLDER_THAN_MONTHS ?? env.ARCHIVE_OLDER_THAN_MONTHS ?? 6);
const { DATABASE_URL } = process.env;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL });
await db.connect();

try {
  const { rows } = await db.query(
    `SELECT c.id, c.account_id, c.customer_jid, c.customer_phone, c.customer_name,
            c.mode, c.stage, c.memory, c.updated_at
       FROM conversations c
      WHERE c.updated_at < now() - ($1::int * interval '1 month')
        AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.conversation_id = c.id AND s.closed_at IS NULL)
      ORDER BY c.updated_at
      LIMIT 500`, [months]);

  if (!rows.length) {
    console.log(`No conversations older than ${months} months with a closed sale.`);
    process.exit(0);
  }

  console.log(`${apply ? 'Archiving' : 'Would archive'} ${rows.length} conversations:`);
  for (const row of rows) console.log(`  #${row.id} ${row.customer_jid} (${row.updated_at.toISOString()})`);

  if (!apply) {
    console.log('Dry run. Pass --apply to move these rows.');
    process.exit(0);
  }

  for (const row of rows) {
    const client = await db;
    await client.query('BEGIN');
    try {
      // Copy into archive first: if a copy fails, the live rows stay untouched.
      await client.query(`INSERT INTO conversations_archive
        (id,account_id,customer_jid,customer_phone,customer_name,mode,stage,memory)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING`,
      [row.id, row.account_id, row.customer_jid, row.customer_phone, row.customer_name, row.mode, row.stage, row.memory]);
      await client.query(`INSERT INTO messages_archive (id,conversation_id,direction,actor,body,kind,occurred_at)
        SELECT id,conversation_id,direction,actor,body,kind,occurred_at FROM messages
        WHERE conversation_id=$1 ON CONFLICT (id) DO NOTHING`, [row.id]);

      // Remove live rows, children first (sales_events/sales_alerts reference sales).
      await client.query('DELETE FROM sales_events WHERE conversation_id=$1', [row.id]);
      await client.query('DELETE FROM sales_alerts WHERE conversation_id=$1', [row.id]);
      await client.query('DELETE FROM sales WHERE conversation_id=$1', [row.id]);
      await client.query('DELETE FROM outbound WHERE conversation_id=$1', [row.id]);
      await client.query('DELETE FROM messages WHERE conversation_id=$1', [row.id]);
      await client.query('DELETE FROM conversations WHERE id=$1', [row.id]);
      await client.query('COMMIT');
      console.log(`  archived #${row.id}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`  failed #${row.id}: ${error.message}`);
    }
  }
} finally {
  await db.end();
}
