import { z } from 'zod';
import { config } from './config.js';
import { listShopCatalog, readShopProduct, searchShop, shop } from './csolution-pos.js';

export const systemName = z.enum(['wotefy', 'lubfy']);
export const planKind = z.enum(['subscription', 'wifi', 'bundle']);
const productRef = z.object({ id: z.string().min(1), name: z.string().min(1), sku: z.string().optional() });
const price = z.object({ amount: z.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) });
// POS photos are either proxied by CSbot (`cspos-asset:`) or a public HTTPS link.
const assetPath = /\/api\/csbot\/image\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const assetUrl = z.string().regex(/^cspos-asset:\/api\/csbot\/image\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const productImage = z.union([assetUrl, z.string().regex(assetPath), z.url({ protocol: /^https$/ })]);
const productSchema = productRef.extend({
  brand: z.string().max(120).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  type: z.string().max(40).optional(),
  unit: z.string().max(30).optional(),
  description: z.string().max(4000).optional(),
  warranty: z.number().int().nonnegative().optional(),
  agent_price: z.number().nonnegative().nullable().optional(),
  available_to_sell: z.number().int().nonnegative().optional(),
  available: z.boolean().optional(),
  price,
  images: z.array(z.object({ url: productImage,
    primary: z.boolean().optional() })).default([]),
});
const productListSchema = z.object({ items: z.array(productSchema), currency: z.string().optional() });
const stockSchema = z.object({
  available_to_sell: z.number().int().nonnegative(),
  available: z.boolean().optional(),
});
type Product = z.infer<typeof productSchema>;

// Relative POS paths become an internal reference so no token or host is stored in messages.
function proxyAssets(product: Product): Product {
  return { ...product, images: product.images.map(image => ({
    ...image, url: image.url.startsWith('/') ? 'cspos-asset:' + image.url : image.url,
  })) };
}
const planSchema = z.object({
  name: z.string().min(1),
  price: price.optional(),
  percentage: z.number().min(0).max(100).optional(),
  percentage_basis: z.string().optional(),
  billing_period: z.string().optional(),
  setup_fee: price.optional(),
  device_limit: z.number().int().nonnegative().optional(),
  omada_limit: z.number().int().nonnegative().optional(),
  features: z.array(z.string()).default([]),
});

export async function documentJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty upstream response');
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new Error('Upstream response too large');
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function request<T extends z.ZodType>(path: string, schema: T, params: Record<string, string> = {}) {
  if (!config.POS_BASE_URL) throw new Error('POS is not configured');
  const base = new URL(config.POS_BASE_URL);
  if (base.username || base.password || base.search || base.hash) throw new Error('Invalid POS base URL');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (config.POS_BRANCH_ID) url.searchParams.set('branch_id', config.POS_BRANCH_ID);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.POS_API_TOKEN) headers.authorization = `Bearer ${config.POS_API_TOKEN}`;
  const res = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(5500) });
  return schema.parse(await documentJson(res));
}

const searchNoise = new Set(['bei', 'price', 'cost', 'picha', 'photo', 'image', 'picture', 'ya', 'na', 'kwa', 'wa',
  'ni', 'gani', 'ngapi', 'tafadhali', 'please', 'the', 'of', 'for', 'and', 'is', 'it', 'do', 'you', 'have', 'how',
  'much', 'stock', 'available', 'ipo', 'zipo', 'inapatikana', 'nataka', 'naomba', 'show', 'nionesha', 'details',
  'maelezo', 'specification', 'specifications', 'spec', 'camera', 'kamera', 'naitaji', 'nahitaji', 'ninahitaji',
  'tunahitaji', 'tunataka', 'niletee', 'nipa', 'nipe', 'niambie', 'tafuta', 'looking', 'need', 'want', 'would',
  'like', 'can', 'could', 'tell', 'about', 'original', 'new', 'latest', 'me', 'my', 'our', 'us', 'ikoje', 'je',
  'order', 'hello', 'hey', 'hi', 'lubfy', 'wotefy', 'tzs', 'tsh', 'at', 'to',
  'vipi', 'what', 'which', 'does', 'this', 'that', 'there', 'give',
  // Words customers wrap around a model name. Left in, they break the search because
  // the catalog requires every word to appear in the product.
  'hiki', 'hii', 'hiyo', 'hilo', 'hicho', 'huyu', 'kifaa', 'bidhaa', 'cha', 'vya', 'vile', 'nini', 'mm', 'mimi',
  'sasa', 'kwanza', 'pia', 'ila', 'lakini', 'kuhusu', 'kuhus', 'kujua', 'naulizia', 'unaulizia', 'kuniwekea',
  'kuweka', 'pamoja', 'yake', 'yangu', 'hapa', 'mpaka', 'then', 'also', 'price', 'the']);

/** Gemini sometimes adds words like "camera" or "price" that no product name contains. */
function searchTerms(search: string) {
  // "access point ya mita 300" is a coverage distance, not a product word. Left
  // in, every advertised word must match, so the whole search returns nothing.
  const cleaned = search
    .replace(/\b(?:mita|metres?|meters?|mtr|metre)\s*[-–]?\s*\d{1,4}\b/gi, ' ')
    .replace(/\b\d{1,4}\s*[-–]?\s*(?:mita|metres?|meters?|mtr|metre)\b/gi, ' ')
    .replace(/\b(?:coverage|range|umbali|urefu|radius)\b/gi, ' ')
    .replace(/\b(?:ya|za|kwa)\s+(?=\s|$)/gi, ' ');
  const tokens = cleaned.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const kept = tokens.filter(token => token.length > 1 && !searchNoise.has(token));
  // A long request puts the model first ("Tplink omada ap 650 bei yake pamoja na mfumo").
  // Taking the last words loses it, so the model is matched as letters plus digits.
  const phrase = kept.join(' ');
  const pair = /([a-z]{2,6})[ ]?(\d{1,4})/.exec(phrase);
  const digits = kept.filter(token => /\d/.test(token));
  return {
    primary: phrase || cleaned.trim(),
    narrow: kept.slice(-3).join(' '),
    model: pair ? `${pair[1]} ${pair[2]}` : digits.length ? digits[digits.length - 1] : '',
  };
}

export function modelQuery(text: string) {
  return searchTerms(text).model;
}

/** "EAP 650", "TP LINK EAP 650", "650" — a model on its own is a price request. */
export function isModelReference(text: string) {
  const words = text.trim().split(/\s+/);
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const kept = tokens.filter(token => !searchNoise.has(token));
  return kept.length > 0 && kept.length <= 4 && words.length <= 5 && kept.some(token => /\d/.test(token));
}

const productBrands = [
  /\bcomfast\b/i, /\bcudy\b/i, /\b(?:tp[ -]?link|tplink|omada)\b/i,
  /\bmikrotik\b/i, /\b(?:ruijie|reyee)\b/i, /\bcambium\b/i,
  /\b(?:unifi|ubiquiti)\b/i,
];

export function requestedBrand(search: string) {
  const matches = productBrands.filter(pattern => pattern.test(search));
  return matches.length === 1 ? matches[0] : undefined;
}

export async function searchProducts(search: string, limit = 6) {
  const { primary, narrow, model } = searchTerms(search);
  const brand = requestedBrand(search);
  // Try the full requested identity first. Model-only fallback still has to
  // match the brand, because AP3000 is sold by several manufacturers.
  const terms = [...new Set([primary, model, narrow].filter(Boolean))];
  for (const term of terms) {
    const result = shop
      ? await searchShop(term, limit)
      : await request('products', productListSchema, { search: term, limit: String(limit) });
    const items = result.items.filter(item => !brand || brand.test(`${item.name} ${item.brand ?? ''}`));
    if (items.length) return { items: shop ? items : items.map(proxyAssets) };
  }
  return { items: [] };
}

export async function readProduct(id: string): Promise<{ product: Product; stock: z.infer<typeof stockSchema> }> {
  if (shop) return readShopProduct(id);
  if (id === '.' || id === '..') throw new Error('Invalid product id');
  const path = 'products/' + encodeURIComponent(id);
  const [product, stock] = await Promise.all([
    request(path, productSchema), request(path + '/availability', stockSchema),
  ]);
  if (product.id !== id) throw new Error('Mismatched product');
  return { product: proxyAssets(product), stock };
}

/** Full live catalog for the dashboard. Falls back to the read-only database view. */
export async function catalog(search: string, limit = 60) {
  if (!shop && !config.POS_BASE_URL) return { items: [] as Product[], source: 'none' as const };
  if (shop) return { items: await listShopCatalog(search, limit), source: 'database' as const };
  const result = await request('products', productListSchema, { search, limit: String(limit) });
  return { items: result.items.map(proxyAssets), source: 'pos' as const };
}

/** Priced work such as installation, sold per job rather than per unit. */
export async function serviceCatalog(term: string) {
  if (!shop && !config.POS_BASE_URL) return [] as Product[];
  const items = shop ? await listShopCatalog(term, 20) : (await request('products', productListSchema,
    { search: term, limit: '20' })).items.map(proxyAssets);
  // Some price lists mark fitting rows as Service and others as a plain product;
  // the name is what makes it a job, so do not lose the row over its type.
  return items.filter(item => item.type === 'Service' || /\b(?:installation|ufungaji)\b/i.test(item.name));
}

/**
 * Cable is sold per metre, so an installation quote needs a length before it is a
 * real total. Only per-metre lines are multiplied; a coiled pack would be wrong.
 */
export async function cableQuote(meters: number) {
  const seen = new Set<string>();
  const items: Product[] = [];
  for (const term of ['cat 6', 'cable', 'waya']) {
    try {
      for (const item of (await catalog(term, 10)).items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    } catch {
      // Try the next term; the quote simply omits the cable when nothing matches.
    }
  }
  const cable = items.find(item => /\b(cat\s?6|cat6|utp|sftp|cable|kebo|waya)\b/i.test(item.name)
    && item.price.amount > 0
    && ['meter', 'metre', 'm', 'mita'].includes((item.unit ?? '').toLowerCase()));
  if (!cable) return;
  return { meters, product: cable, amount: cable.price.amount * meters, currency: cable.price.currency };
}

export type InstallationOption = {
  id: string;
  name: string;
  /** A when the shop supplies the device, B when the customer already owns it. */
  variant: string;
  /** Undefined when the price list uses a letter this bot does not understand. */
  withOurEquipment?: boolean;
  fee: number;
  total: number;
  currency: string;
};

/**
 * "TYPE A" and a trailing "A" both appear in the CSolution price list. The
 * letter decides who supplies the hardware, so it is read once rather than
 * inferred from the order the rows happen to come back in.
 */
export function variantLetter(name: string) {
  const typed = /\bTYPE\s*([A-Z])\b/i.exec(name)?.[1];
  if (typed) return typed.toUpperCase();
  const tail = /\b([A-Z])$/.exec(name.trim());
  return tail ? tail[1].toUpperCase() : '';
}

/**
 * Installation prices for a device. MikroTik routers and gateways use the GM
 * rate; access points use AP. Every priced variant is returned because Type A
 * (shop supplies the device) and Type B (customer brings one) differ.
 */
export async function installationOptions(product: {
  name: string; category?: string | null; price: { amount: number; currency: string };
}): Promise<{ equipment: 'AP' | 'GM'; options: InstallationOption[] }> {
  const equipment = `${product.name} ${product.category ?? ''}`;
  const kind = /\b(mikrotik|gateway|router|hap|hex)\b/i.test(equipment) ? 'GM' : 'AP';
  const services = await serviceCatalog(kind === 'GM' ? 'GM installation' : 'AP installation');
  const options = services
    .filter(service => new RegExp(`\\b${kind}\\b`, 'i').test(service.name))
    .map(service => {
      const variant = variantLetter(service.name);
      const withOurEquipment = variant === 'A' ? true : variant === 'B' ? false : undefined;
      return {
        id: service.id,
        name: service.name,
        variant,
        withOurEquipment,
        fee: service.price.amount,
        // Type A covers the device the shop supplies. Type B is fitting only —
        // the customer already owns the hardware, so adding its price would
        // quote them for something they are not buying.
        total: withOurEquipment === true
          ? product.price.amount + service.price.amount
          : service.price.amount,
        currency: service.price.currency,
      };
    })
    .sort((a, b) => a.fee - b.fee);
  return { equipment: kind, options };
}

/** Cover photo reference for the dashboard, without paying for a stock lookup. */
export async function productImageRef(id: string) {
  if (shop) return (await readShopProduct(id)).product.images[0]?.url;
  if (!config.POS_BASE_URL) return;
  const product = proxyAssets(await request('products/' + encodeURIComponent(id), productSchema));
  return (product.images.find(image => image.primary) ?? product.images[0])?.url;
}

/** Fetch product photo bytes from the POS with the catalog token attached. */
export async function posAsset(path: string) {
  if (!config.POS_BASE_URL) return;
  if (!/^\/api\/csbot\/image\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(path)) return;
  const base = new URL(config.POS_BASE_URL);
  const url = new URL(path, base);
  if (url.origin !== base.origin) return;
  const cached = assetCache.get(path);
  if (cached) {
    // Refresh insertion order so the least recently used photo is evicted first.
    assetCache.delete(path);
    assetCache.set(path, cached);
    return cached;
  }
  const pending = assetInflight.get(path);
  if (pending) return pending;
  const request = downloadAsset(url, path);
  assetInflight.set(path, request);
  try {
    return await request;
  } finally {
    assetInflight.delete(path);
  }
}

async function downloadAsset(url: URL, path: string) {
  const headers: Record<string, string> = { accept: 'image/png,image/jpeg,image/webp' };
  if (config.POS_API_TOKEN) headers.authorization = `Bearer ${config.POS_API_TOKEN}`;
  // Shop photos are camera-sized, and the catalog server shares one CPU. A short
  // timeout made the dashboard show empty tiles whenever several loaded at once.
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
  const mimetype = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !response.body || !mimetype || !['image/png', 'image/jpeg', 'image/webp'].includes(mimetype)) {
    await response.body?.cancel();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8 * 1024 * 1024) {
      await reader.cancel();
      return;
    }
    chunks.push(Buffer.from(value));
  }
  const asset = { image: Buffer.concat(chunks), mimetype };
  rememberAsset(path, asset);
  return asset;
}

const ASSET_CACHE_BYTES = 16 * 1024 * 1024;
const assetCache = new Map<string, { image: Buffer; mimetype: string }>();
const assetInflight = new Map<string, Promise<{ image: Buffer; mimetype: string } | undefined>>();
let assetCacheBytes = 0;

function rememberAsset(path: string, asset: { image: Buffer; mimetype: string }) {
  if (asset.image.byteLength > ASSET_CACHE_BYTES / 4) return;
  assetCache.set(path, asset);
  assetCacheBytes += asset.image.byteLength;
  for (const [key, value] of assetCache) {
    if (assetCacheBytes <= ASSET_CACHE_BYTES) break;
    assetCache.delete(key);
    assetCacheBytes -= value.image.byteLength;
  }
}

export async function readPlans(
  system: z.infer<typeof systemName>, kind: z.infer<typeof planKind>, site?: string,
): Promise<{ items: z.infer<typeof planSchema>[] }> {
  const publicUrl = system === 'wotefy' ? config.WOTEFY_PLANS_URL : config.LUBFY_PLANS_URL;
  if (kind !== 'subscription' || !publicUrl) {
    return request('service-plans', z.object({ items: z.array(planSchema) }), { system, kind, ...(site ? { site } : {}) });
  }
  const url = z.url({ protocol: /^https$/ }).parse(publicUrl);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5500) });
  const payload = await documentJson(response);
  return { items: publicSubscriptionPlans(system, payload) };
}

const currency = z.string().regex(/^[A-Z]{3}$/);
const cycle = z.string().min(1).max(30);

export function publicSubscriptionPlans(system: z.infer<typeof systemName>, payload: unknown): z.infer<typeof planSchema>[] {
  if (system === 'wotefy') {
    const { data } = z.object({ success: z.literal(true), data: z.array(z.object({
      name: z.string(), price: z.number().nonnegative(), currency, interval: cycle,
      maxSites: z.number().int().nullable(), maxDevices: z.number().int().nullable(), isActive: z.boolean(),
    })) }).parse(payload);
    return data.filter(item => item.isActive).map(item => ({
      name: item.name, price: { amount: item.price, currency: item.currency }, billing_period: item.interval,
      device_limit: item.maxDevices ?? undefined,
      features: [item.maxSites === null ? '' : `${item.maxSites} site(s)`,
        item.maxDevices === null ? '' : `${item.maxDevices} device(s)`].filter(Boolean),
    }));
  }
  const { items } = z.object({ items: z.array(z.object({
    display_name: z.string(), amount_minor: z.number().int().nonnegative(), currency,
    billing_interval: cycle, status: z.string(),
    features: z.object({ sites_limit: z.number().int().nonnegative().optional(),
      routers_limit: z.number().int().nonnegative().optional(),
      omada_routers_limit: z.number().int().nonnegative().optional() }).optional(),
  })) }).parse(payload);
  return items.filter(item => item.status === 'ACTIVE').map(item => ({
    name: item.display_name, price: { amount: item.amount_minor / 100, currency: item.currency },
    billing_period: item.billing_interval,
    omada_limit: item.features?.omada_routers_limit,
    features: [item.features?.sites_limit === undefined ? '' : `${item.features.sites_limit} site(s)`,
      item.features?.routers_limit === undefined ? '' : `${item.features.routers_limit} router(s)`].filter(Boolean),
  }));
}

export function money(value: z.infer<typeof price>) {
  // TZS has no minor units; dropping ".00" keeps WhatsApp quotes readable.
  const digits = value.currency === 'TZS' ? 0 : 2;
  const amount = new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 0, maximumFractionDigits: digits,
  }).format(value.amount);
  return `${value.currency} ${amount}`;
}
