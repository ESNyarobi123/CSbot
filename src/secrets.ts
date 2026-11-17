import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { sessionKey } from './config.js';

export function seal(value: string, context: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey(), nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function unseal(value: string, context: string) {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', sessionKey(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
