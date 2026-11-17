import { isJidBroadcast, isJidGroup, isJidNewsletter, isJidStatusBroadcast } from 'baileys';

/**
 * Chats CSbot never stores: groups, broadcasts, status updates and newsletters. A sales inbox only
 * deals with one-to-one conversations, and skipping the rest keeps the message table small.
 */
export function isIgnoredJid(jid: string) {
  return isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid);
}

/** Baileys writes +255...@s.whatsapp.net; WhatsApp Web's auth screen wants the digits only. */
export function pairingNumber(phone: string) {
  return phone.replace(/\D/g, '');
}
