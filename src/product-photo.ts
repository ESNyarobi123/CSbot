import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { catalog, money, readProduct, searchProducts } from './pos.js';
import type { Conversation } from './store.js';
import type { Outcome } from './assistant.js';

export interface ProductPhotoContext { model?: string }

const key = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const family = /\b(?:(?:RG[ -]?)?RAP[ -]?\d{2,5}(?:PRO)?(?:[ -](?:OD|G))?|CF[ -]?WA[ -]?\d{2,5}|(?:EAP|WR|AP|RB|CCR|CRS|ER)[ -]?\d{2,5}[A-Z0-9]*(?:-(?:HD|OUTDOOR|AX|PRO))?)\b/gi;

export function labelModel(text: string) {
  const codes = new Map<string, string>();
  for (const match of text.matchAll(family)) codes.set(key(match[0]), match[0].toUpperCase());
  return codes.size === 1 ? [...codes.values()][0] : undefined;
}

async function readLabel(bytes: Buffer) {
  const image = await sharp(bytes, { limitInputPixels: 24_000_000 }).rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).grayscale().png().toBuffer();
  // Pipe both ways. No receipt or device photo is written to disk or sent to an AI service.
  return new Promise<string>((resolve, reject) => {
    const ocr = spawn('tesseract', ['stdin', 'stdout', '-l', 'eng', '--psm', '11'], {
      stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000, killSignal: 'SIGKILL',
      env: { ...process.env, OMP_THREAD_LIMIT: '1' },
    });
    let output = '';
    ocr.stdout.setEncoding('utf8');
    ocr.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 16000) ocr.kill('SIGKILL');
    });
    ocr.on('error', reject);
    ocr.on('close', code => code === 0 ? resolve(output) : reject(new Error('Unreadable label')));
    ocr.stdin.on('error', () => undefined);
    ocr.stdin.end(image);
  });
}

const refersToPhoto = /\b(hii|hiki|hiyo|hicho|hili|kwenu|hapo|bei|mnauza|mnayo|inapatikana|stock|available|availability|this|that|price|sell|cost)\b/i;
const privateOrSupport = /\b(malipo|lipa|nimelipa|risiti|muamala|receipt|paid|payment|support|tatizo|error|haifanyi|haifunguki)\b/i;

export function photoInquiry(newest: string, stage: Conversation['stage']) {
  if (privateOrSupport.test(newest) || labelModel(newest)) return false;
  const caption = newest.replaceAll('[WhatsApp image]', '').trim();
  if (!caption) return !['ready_to_pay', 'payment_reported', 'paid'].includes(stage);
  return refersToPhoto.test(caption);
}

export async function printedModel(base64: string) {
  return readLabel(Buffer.from(base64, 'base64')).then(labelModel).catch(() => undefined);
}

export async function photoReply(
  photo: ProductPhotoContext, memory: Conversation['memory'], say: (sw: string, en: string) => string,
): Promise<Outcome> {
  // The photo introduces a new item. A later "ile" must never buy the previous quote.
  const { product, lastQuote, quoteFor, optionQuery, productOptions, awaitingService, ...context } = memory;
  if (!photo.model) return { memory: context, body: say(
    'Nimepokea picha. Ukiulizia kifaa hiki, unaweza kuniandikia modeli iliyo kwenye lebo? Nitaangalia bei na stock.',
    'I received the photo. If you’re asking about this device, could you type the model on its label? I’ll check its price and stock.') };
  const model = photo.model;
  try {
    const exact = (item: { type?: string; sku?: string; name: string }) =>
      item.type !== 'Service' && [item.name, item.sku, labelModel(item.name)].some(value => value && key(value) === key(model));
    let matches = (await catalog(model, 30)).items.filter(exact);
    if (!matches.length) matches = (await searchProducts(model, 30)).items.filter(exact);
    if (matches.length === 1) {
      const { product, stock } = await readProduct(matches[0].id);
      const price = money(product.price);
      const available = stock.available ?? stock.available_to_sell > 0;
      const body = say(`Kwenye lebo nimesoma ${model}. ${product.name} ni ${price}. ${available ? 'Ipo stock kwa sasa.' : 'Imeisha stock kwa sasa.'}`,
        `I can read ${model} on the label. ${product.name} is ${price}. ${available ? 'It’s currently in stock.' : 'It’s currently out of stock.'}`);
      const trace = [`Photo label: ${model}`, 'Checked the exact catalog match, current price and availability'];
      return { body, trace, stage: 'quoted', memory: { ...context, trace, facts: { ...context.facts, photo: model, identified: product.name }, product: { id: product.id, name: product.name },
        quoteFor: 'product', lastQuote: `${product.name} — ${price}` } };
    }
  } catch { /* A catalog outage must not turn the pictured item into a stock claim. */ }
  return { memory: context, body: say(`Nimesoma ${model} kwenye picha. Bado sijathibitisha bei na stock ya modeli hiyo. Unaweza kuthibitisha modeli kamili iliyo kwenye lebo?`,
    `I read ${model} in the photo. I couldn’t verify the price and stock for that exact model. Could you confirm the full model on the label?`) };
}
