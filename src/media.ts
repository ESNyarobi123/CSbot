import sharp from 'sharp';
import { config } from './config.js';
import { shopImage } from './csolution-pos.js';
import { posAsset } from './pos.js';
import { db, row } from './db.js';

export const maxImageBytes = 8 * 1024 * 1024;

export function imageAllowed(link: string) {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      config.PRODUCT_IMAGE_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

export async function downloadImage(link: string) {
  if (link.startsWith('cspos-image:')) {
    const stored = await shopImage(link);
    if (stored) return whatsAppImage(stored.image, stored.mimetype);
    return;
  }
  if (link.startsWith('cspos-asset:')) {
    // Pull the photo from the POS catalog API with the token kept server-side.
    const stored = await posAsset(link.slice('cspos-asset:'.length));
    if (stored) return whatsAppImage(stored.image, stored.mimetype);
    return;
  }
  if (link.startsWith('csbot-media:')) {
    const id = /^[1-9]\d{0,17}$/.test(link.slice('csbot-media:'.length)) ? link.slice('csbot-media:'.length) : undefined;
    if (!id) return;
    const stored = await row<{ mimetype: string; bytes: Buffer }>(db,
      'SELECT mimetype,bytes FROM media WHERE id=$1', [id]);
    if (stored) return whatsAppImage(stored.bytes, stored.mimetype);
    return;
  }
  if (!imageAllowed(link)) return;
  const response = await fetch(link, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const maxSize = maxImageBytes;
  if (!response.ok || !response.body || !mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)
      || Number(response.headers.get('content-length')) > maxSize) {
    await response.body?.cancel();
    return;
  }
  const reader = response.body.getReader();
  const parts: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxSize) {
      await reader.cancel();
      return;
    }
    parts.push(Buffer.from(value));
  }
  return whatsAppImage(Buffer.concat(parts), mime);
}

async function whatsAppImage(image: Buffer, mimetype: string) {
  if (mimetype === 'image/webp') {
    if (image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') return;
    const jpeg = await sharp(image, { limitInputPixels: 20000000 }).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 87 }).toBuffer();
    return { image: jpeg, mimetype: 'image/jpeg' };
  }
  const signature = mimetype === 'image/jpeg' ? 'ffd8ff' : '89504e470d0a1a0a';
  if (image.toString('hex', 0, signature.length / 2) === signature) return { image, mimetype };
}
