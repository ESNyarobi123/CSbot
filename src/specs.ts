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
  /** Added in 017: the rest of the datasheet customers actually ask about. */
  antenna: string | null;
  radios: string | null;
  gain_dbi: number | string | null;
  ip_rating: string | null;
  mesh: boolean | null;
  controller: string | null;
  poe_watts: number | string | null;
  mounting: string | null;
  highlights: string[] | null;
  aliases: string[] | null;
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

/** The rows for these keys, including the name a customer or the shop uses. */
async function lookup(keys: string[], client: Queryable) {
  if (!keys.length) return [];
  // `aliases` holds alternate spellings ("RAP6262" for "RG-RAP6262(G)"), so a
  // model typed the way the box prints it still finds the sheet.
  return (await client.query<DeviceSpec>(
    `SELECT * FROM device_specs
     WHERE model_key = ANY($1)
        OR EXISTS (SELECT 1 FROM unnest(coalesce(aliases,'{}')) alias
                   WHERE upper(regexp_replace(alias,'[^a-zA-Z0-9]','','g')) = ANY($1))`,
    [keys])).rows;
}

export async function specsFor(
  product: { name: string; sku?: string | null; brand?: string | null },
  client: Queryable = db,
) {
  const keys = specKeys(product);
  if (!keys.length) return undefined;
  const rows = await lookup(keys, client);
  // Prefer the row whose own key matches, then the alias hit.
  return rows.find(entry => keys.includes(entry.model_key)) ?? rows[0];
}

/**
 * Every sheet for a shortlist in one round trip. A list of six devices must not
 * cost six queries while the customer waits.
 */
export async function specsForMany(
  products: { name: string; sku?: string | null; brand?: string | null }[],
  client: Queryable = db,
) {
  const keys = [...new Set(products.flatMap(specKeys))];
  if (!keys.length) return new Map<string, DeviceSpec>();
  const found = await lookup(keys, client);
  const byKey = new Map<string, DeviceSpec>();
  for (const sheet of found) {
    byKey.set(sheet.model_key, sheet);
    for (const alias of sheet.aliases ?? []) byKey.set(specKey(alias), sheet);
  }
  return byKey;
}

/** The sheet belonging to one product, whatever key it was stored under. */
export function sheetFor(sheets: Map<string, DeviceSpec>, product: { name: string; sku?: string | null; brand?: string | null }) {
  return specKeys(product).map(key => sheets.get(key)).find(Boolean);
}

const watts = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

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
  else if (spec.radios) lines.push(say(`Redio: ${spec.radios}`, `Radios: ${spec.radios}`));
  if (spec.bands) lines.push(say(`Bendi: ${spec.bands}`, `Bands: ${spec.bands}`));
  if (spec.radios && spec.wifi) lines.push(say(`MIMO: ${spec.radios}`, `MIMO: ${spec.radios}`));
  if (spec.antenna) {
    const gain = watts(spec.gain_dbi);
    lines.push(say(`Antena: ${spec.antenna}${gain ? ` (${gain} dBi)` : ''}`,
      `Antenna: ${spec.antenna}${gain ? ` (${gain} dBi)` : ''}`));
  }
  if (spec.ports) lines.push(say(`Ports: ${spec.ports}`, `Ports: ${spec.ports}`));
  if (spec.poe) {
    const load = watts(spec.poe_watts);
    lines.push(say(`Umeme: ${spec.poe}${load ? ` (hadi ${load} W)` : ''}`,
      `Power: ${spec.poe}${load ? ` (up to ${load} W)` : ''}`));
  }
  if (spec.ip_rating) lines.push(say(`Kiwango cha kinga: ${spec.ip_rating}`, `Ingress rating: ${spec.ip_rating}`));
  if (spec.coverage_m) {
    lines.push(say(`Umbali uliotajwa: hadi mita ${spec.coverage_m} (eneo la wazi)`,
      `Stated range: up to ${spec.coverage_m} m (open area)`));
  }
  if (spec.users) {
    lines.push(say(`Inashauriwa kwa wateja hadi ${spec.users} kwa wakati mmoja`,
      `Recommended for up to ${spec.users} concurrent clients`));
  }
  if (spec.mesh === true) {
    lines.push(say('Mesh: ndio — inaweza kuunganishwa na AP nyingine za mfumo huo bila waya kati yao',
      'Mesh: yes — it can join other APs of the same system without a cable between them'));
  } else if (spec.mesh === false) {
    lines.push(say('Mesh: haitumiki kwenye model hii', 'Mesh: not supported on this model'));
  }
  if (spec.controller) lines.push(say(`Usimamizi: ${spec.controller}`, `Management: ${spec.controller}`));
  if (spec.mounting) lines.push(say(`Kuweka: ${spec.mounting}`, `Mounting: ${spec.mounting}`));
  if (spec.highlights?.length) {
    lines.push(...spec.highlights.slice(0, 4).map(item => `• ${item}`));
  }
  return lines;
}

/**
 * The sheet as plain facts for the answer composer. Deliberately unformatted:
 * the model writes the sentence, this is the only truth it may use.
 */
export function specBrief(spec: DeviceSpec) {
  const facts: string[] = [];
  const put = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '' || value === false) return;
    facts.push(`${label}: ${value}`);
  };
  put('Model', spec.model);
  put('Brand', spec.brand);
  put('Use', spec.deployment === 'both' ? 'indoor and outdoor' : spec.deployment);
  put('Wi-Fi', spec.wifi);
  put('Bands', spec.bands);
  put('MIMO', spec.radios);
  put('Antenna', spec.antenna);
  put('Antenna gain (dBi)', watts(spec.gain_dbi));
  put('Ports', spec.ports);
  put('Power', spec.poe);
  put('Power draw (W)', watts(spec.poe_watts));
  put('Ingress rating', spec.ip_rating);
  put('Stated range (m, open area)', spec.coverage_m);
  put('Concurrent clients', spec.users);
  if (spec.mesh !== null && spec.mesh !== undefined) put('Mesh', spec.mesh ? 'yes' : 'no');
  put('Management', spec.controller);
  put('Mounting', spec.mounting);
  if (spec.highlights?.length) put('Highlights', spec.highlights.join('; '));
  put('Notes', spec.notes);
  if (!spec.verified) facts.push('Verification: shop record, not yet checked against the datasheet');
  return facts.join('\n');
}

/** Every model the shop has a datasheet row for, newest edit first. */
export async function listSpecs(limit = 50, client: Queryable = db) {
  return (await client.query<DeviceSpec>(
    'SELECT * FROM device_specs ORDER BY verified DESC, updated_at DESC, model LIMIT $1', [limit])).rows;
}

export type SpecInput = Omit<DeviceSpec, 'model_key' | 'updated_at'> & { model_key?: string };

export async function saveSpec(input: SpecInput) {
  const key = input.model_key ? specKey(input.model_key) : specKey(input.model);
  return row<DeviceSpec>(db, `INSERT INTO device_specs
      (model_key,brand,model,deployment,wifi,bands,ports,poe,coverage_m,users,notes,source_url,verified,
       antenna,radios,gain_dbi,ip_rating,mesh,controller,poe_watts,mounting,highlights,aliases)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT (model_key) DO UPDATE SET brand=EXCLUDED.brand,model=EXCLUDED.model,
      deployment=EXCLUDED.deployment,wifi=EXCLUDED.wifi,bands=EXCLUDED.bands,ports=EXCLUDED.ports,
      poe=EXCLUDED.poe,coverage_m=EXCLUDED.coverage_m,users=EXCLUDED.users,notes=EXCLUDED.notes,
      source_url=EXCLUDED.source_url,verified=EXCLUDED.verified,antenna=EXCLUDED.antenna,
      radios=EXCLUDED.radios,gain_dbi=EXCLUDED.gain_dbi,ip_rating=EXCLUDED.ip_rating,mesh=EXCLUDED.mesh,
      controller=EXCLUDED.controller,poe_watts=EXCLUDED.poe_watts,mounting=EXCLUDED.mounting,
      highlights=EXCLUDED.highlights,aliases=EXCLUDED.aliases,updated_at=now() RETURNING *`,
  [key, input.brand, input.model, input.deployment, input.wifi, input.bands, input.ports, input.poe,
    input.coverage_m, input.users, input.notes, input.source_url, input.verified,
    input.antenna ?? null, input.radios ?? null, input.gain_dbi ?? null, input.ip_rating ?? null,
    input.mesh ?? null, input.controller ?? null, input.poe_watts ?? null, input.mounting ?? null,
    input.highlights ?? null, input.aliases ?? null]);
}
