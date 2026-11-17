import pg from 'pg';
import { z } from 'zod';
import { config } from './config.js';
import { log } from './db.js';

export const shop = config.CSOLUTION_POS_DB_URL ? new pg.Pool({
  connectionString: config.CSOLUTION_POS_DB_URL,
  max: 4,
  connectionTimeoutMillis: 4000,
  statement_timeout: 4000,
  application_name: 'csbot_catalog_reader',
  options: '-c default_transaction_read_only=on',
}) : undefined;
shop?.on('error', error => log.error({ code: error.name }, 'POS reader connection failed'));

export async function searchShop(search: string) {
  const tokens = search.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  if (!tokens.length) return { items: [] };
  const { rows } = await shop!.query<{ id: string; name: string; sku: string }>(
    `SELECT id,name,sku FROM csbot_catalog.products WHERE NOT EXISTS (
      SELECT 1 FROM unnest($2::text[]) AS term WHERE
      strpos(lower(concat_ws(' ', name, sku, brand)), term)=0
    ) ORDER BY (lower(sku)=lower($1)) DESC,(lower(name)=lower($1)) DESC,name,id LIMIT 6`, [search, tokens]);
  return { items: rows };
}

export async function readShopProduct(id: string) {
  const { rows } = await shop!.query(`SELECT id,name,sku,brand,category,type,unit,description,retail_price,
    currency,available_to_sell,warranty,image_id,image_url
    FROM csbot_catalog.products WHERE id=$1`, [id]);
  const product = z.object({
    id: z.uuid(), name: z.string(), sku: z.string(), brand: z.string().nullable(), category: z.string().nullable(),
    type: z.string(), unit: z.string(), description: z.string().default(''), warranty: z.number().int().nonnegative(),
    retail_price: z.coerce.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/),
    available_to_sell: z.number().int().nonnegative(),
    image_id: z.uuid().nullable(), image_url: z.string().nullable(),
  }).parse(rows[0]);
  const imageUrl = product.image_id ? 'cspos-image:' + product.image_id : product.image_url;
  return {
    product: { id: product.id, name: product.name, sku: product.sku, brand: product.brand,
      category: product.category, type: product.type, unit: product.unit, description: product.description,
      warranty: product.warranty,
      price: { amount: product.retail_price, currency: product.currency },
      available_to_sell: product.available_to_sell,
      available: product.type === 'Service' || product.available_to_sell > 0,
      images: imageUrl ? [{ url: imageUrl, primary: true }] : [] },
    stock: { available_to_sell: product.available_to_sell,
      available: product.type === 'Service' || product.available_to_sell > 0 },
  };
}

/** Paged catalog for the dashboard when CSbot reads the POS database directly. */
export async function listShopCatalog(search: string, limit: number) {
  const tokens = search.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  const { rows } = await shop!.query(`SELECT id,name,sku,brand,category,type,unit,description,retail_price,
    currency,available_to_sell,warranty,image_id,image_url
    FROM csbot_catalog.products WHERE $2::text[] = '{}'::text[] OR NOT EXISTS (
      SELECT 1 FROM unnest($2::text[]) AS term WHERE
      strpos(lower(concat_ws(' ',name,sku,coalesce(brand,''),coalesce(category,''),description)),term)=0)
    ORDER BY (lower(sku)=lower($1)) DESC,(lower(name)=lower($1)) DESC,(type='Service'),(available_to_sell=0),name
    LIMIT $3`, [search, tokens, limit]);
  return rows.map(raw => {
    const imageUrl = raw.image_id ? 'cspos-image:' + raw.image_id : raw.image_url;
    const isService = raw.type === 'Service';
    const available = isService || Number(raw.available_to_sell) > 0;
    return {
      id: raw.id, name: raw.name, sku: raw.sku, brand: raw.brand, category: raw.category,
      type: raw.type, unit: raw.unit, description: raw.description, warranty: Number(raw.warranty),
      price: { amount: Number(raw.retail_price), currency: raw.currency },
      available_to_sell: isService ? 0 : Number(raw.available_to_sell), available,
      images: imageUrl ? [{ url: imageUrl, primary: true }] : [],
    };
  });
}

export async function shopImage(ref: string) {
  if (!shop) return;
  const id = z.uuid().safeParse(ref.slice('cspos-image:'.length));
  if (!id.success) return;
  const { rows } = await shop.query<{ data: Buffer; content_type: string }>(
    'SELECT content_type,data FROM csbot_catalog.product_images WHERE id=$1', [id.data]);
  const item = rows[0];
  if (item) return { image: item.data, mimetype: item.content_type };
}
