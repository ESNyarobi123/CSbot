import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataSet,
  type SignalDataTypeMap } from 'baileys';
import type { PoolClient } from 'pg';
import { db, row, transaction } from './db.js';
import { seal, unseal } from './secrets.js';

export async function whatsappAuth(accountId: string, version: number): Promise<{
  state: AuthenticationState; saveCreds: () => Promise<unknown>;
}> {
  const context = (type: string, id: string) => JSON.stringify([accountId, version, type, id]);
  const serialize = (data: unknown, type: string, id: string) =>
    seal(JSON.stringify(data, BufferJSON.replacer), context(type, id));
  const deserialize = (data: string, type: string, id: string) =>
    JSON.parse(unseal(data, context(type, id)), BufferJSON.reviver);
  const existing = await row(db, `SELECT value FROM whatsapp_auth WHERE account_id=$1
    AND session_version=$2 AND category='credentials' AND key_id='main'`, [accountId, version]);
  const creds = existing ? deserialize(existing.value, 'credentials', 'main') : initAuthCreds();
  const upsert = `INSERT INTO whatsapp_auth (account_id,session_version,category,key_id,value)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (account_id,session_version,category,key_id)
    DO UPDATE SET value=EXCLUDED.value`;
  const withinSession = async (work: (client: PoolClient) => Promise<unknown>) =>
    transaction(async client => {
      if (await row(client, 'SELECT 1 FROM accounts WHERE id=$1 AND session_version=$2 FOR SHARE', [accountId, version])) {
        return work(client);
      }
    });
  return {
    state: {
      creds,
      keys: {
        async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
          const result = await db.query<{ key_id: string; value: string }>(
            `SELECT key_id,value FROM whatsapp_auth WHERE account_id=$1 AND session_version=$2
              AND category=$3 AND key_id=ANY($4)`, [accountId, version, type, ids]);
          const values: Record<string, SignalDataTypeMap[T]> = Object.create(null);
          for (const item of result.rows) {
            const value = deserialize(item.value, type, item.key_id);
            values[item.key_id] = type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value) : value;
          }
          return values;
        },
        async set(data: SignalDataSet) {
          await withinSession(async client => {
            for (const [type, entries] of Object.entries(data)) {
              for (const [id, value] of Object.entries(entries ?? {})) {
                if (value == null) {
                  await client.query(`DELETE FROM whatsapp_auth WHERE account_id=$1 AND session_version=$2
                    AND category=$3 AND key_id=$4`, [accountId, version, type, id]);
                } else {
                  await client.query(upsert, [accountId, version, type, id, serialize(value, type, id)]);
                }
              }
            }
          });
        },
      },
    },
    saveCreds: () => {
      const encoded = serialize(creds, 'credentials', 'main');
      return withinSession(client => client.query(upsert, [accountId, version, 'credentials', 'main', encoded]));
    },
  };
}
