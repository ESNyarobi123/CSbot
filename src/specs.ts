import type { Pool, PoolClient } from 'pg';
import { db, row } from './db.js';

/**
 * One device's datasheet facts. The shop's fleet grows, so the answers live in
 * a table rather than in code: a new model is a row, not a deploy.
 */
export type DeviceSpec = {
  model_key: string;
  brand: string | null;
  model: string;
  deployment: 'indoor' | 'outdoor' | 'both' | null;
  wifi: string | null;
  bands: string | null;
  ports: string | null;
  poe: string | null;
  coverage_m: number | null;
  users: number | null;
  notes: string | null;
  source_url: string | null;
  verified: boolean;
};

/** "TP-LINK EAP 650", "eap650" and "EAP-650" must reach the same row. */
export function specKey(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Candidate keys for a product. The full name wins, then the name with the
 * brand stripped, then the SKU, so "TP LINK EAP 650" and a bare "650" both land.
 */
export function specKeys(product: { name: string; sku?: string | null; brand?: string | null }) {
  const keys = new Set<string>([specKey(product.name)]);
  if (product.brand) {
    const brand = specKey(product.brand);
    const name = specKey(product.name);
    if (brand && name.startsWith(brand)) keys.add(name.slice(brand.length));
  }
  if (product.sku && /\d/.test(product.sku)) keys.add(specKey(product.sku));
  return [...keys].filter(key => /\d/.test(key));
}

type Queryable = Pool | PoolClient;

export async function specsFor(
  product: { name: string; sku?: string | null; brand?: string | null },
  client: Queryable = db,
) {
  const keys = specKeys(product);
  if (!keys.length) return undefined;
  const found = await client.query<DeviceSpec>(
    'SELECT * FROM device_specs WHERE model_key = ANY($1)', [keys]);
  return found.rows[0];
}

/**
 * The spec sheet in customer language. Only recorded fields are printed: an
 * empty column must never turn into a guessed band or a made-up range.
 */
export function specLines(
  spec: DeviceSpec,
  say: (sw: string, en: string) => string,
) {
  const lines: string[] = [];
  if (spec.deployment) {
    lines.push(say(`Matumizi: ${spec.deployment === 'both' ? 'ndani na nje' : spec.deployment === 'indoor' ? 'ndani (indoor)' : 'nje (outdoor)'}`,
      `Use: ${spec.deployment === 'both' ? 'indoor and outdoor' : spec.deployment}`));
  }
  if (spec.wifi) lines.push(say(`Wi-Fi: ${spec.wifi}`, `Wi-Fi: ${spec.wifi}`));
  if (spec.bands) lines.push(say(`Bendi: ${spec.bands}`, `Bands: ${spec.bands}`));
  if (spec.ports) lines.push(say(`Ports: ${spec.ports}`, `Ports: ${spec.ports}`));
  if (spec.poe) lines.push(say(`Umeme: ${spec.poe}`, `Power: ${spec.poe}`));
  if (spec.coverage_m) {
    lines.push(say(`Umbali uliotajwa: hadi mita ${spec.coverage_m} (eneo la wazi)`,
      `Stated range: up to ${spec.coverage_m} m (open area)`));
  }
  if (spec.users) {
    lines.push(say(`Inashauriwa kwa wateja hadi ${spec.users} kwa wakati mmoja`,
      `Recommended for up to ${spec.users} concurrent clients`));
  }
  return lines;
}

/** Every model the shop has a datasheet row for, newest edit first. */
export async function listSpecs(limit = 50, client: Queryable = db) {
  return (await client.query<DeviceSpec>(
    'SELECT * FROM device_specs ORDER BY verified DESC, updated_at DESC, model LIMIT $1', [limit])).rows;
}

export async function saveSpec(input: Omit<DeviceSpec, 'model_key' | 'updated_at'> & { model_key?: string }) {
  const key = input.model_key ? specKey(input.model_key) : specKey(input.model);
  return row<DeviceSpec>(db, `INSERT INTO device_specs
      (model_key,brand,model,deployment,wifi,bands,ports,poe,coverage_m,users,notes,source_url,verified)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (model_key) DO UPDATE SET brand=EXCLUDED.brand,model=EXCLUDED.model,
      deployment=EXCLUDED.deployment,wifi=EXCLUDED.wifi,bands=EXCLUDED.bands,ports=EXCLUDED.ports,
      poe=EXCLUDED.poe,coverage_m=EXCLUDED.coverage_m,users=EXCLUDED.users,notes=EXCLUDED.notes,
      source_url=EXCLUDED.source_url,verified=EXCLUDED.verified,updated_at=now() RETURNING *`,
  [key, input.brand, input.model, input.deployment, input.wifi, input.bands, input.ports, input.poe,
    input.coverage_m, input.users, input.notes, input.source_url, input.verified]);
}
