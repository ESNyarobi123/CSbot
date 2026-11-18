import { apiUrl } from './api-url.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Links the shop's own WhatsApp number to CSbot.
 *
 *   npm run pair -- sales              scan a QR code in this terminal
 *   npm run pair -- sales --code       enter an 8-character pairing code instead
 *
 * The pairing code is useful when the phone is not next to the computer:
 * WhatsApp → Linked devices → Link with phone number, then type the code CSbot prints.
 */
const args = process.argv.slice(2);
const id = args.find(value => !value.startsWith('--'));
const useCode = args.includes('--code') || args.includes('-c');
if (!id || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) {
  throw new Error('Usage: npm run pair -- <account-id> [--code]');
}
if (!process.env.ADMIN_API_TOKEN) process.loadEnvFile();
const token = process.env.ADMIN_API_TOKEN;
if (!token) throw new Error('Set ADMIN_API_TOKEN in .env');
const base = apiUrl();
const headers = { authorization: 'Bearer ' + token };

if (useCode) {
  const requested = await fetch(`${base}/v1/accounts/${id}/pairing-code`, { method: 'POST', headers });
  if (!requested.ok) {
    throw new Error('Pairing code request failed (HTTP ' + requested.status + '): ' + await requested.text());
  }
  const { phone } = await requested.json();
  console.log(`Namba itaunganishwa: ${phone}`);
  console.log('WhatsApp → Linked devices → Link with phone number, kisha andika code hii:');
}

let lastQr;
let lastCode;
let connected = false;
let lastStatus;
const deadline = Date.now() + 240000;

while (Date.now() < deadline) {
  const response = await fetch(`${base}/v1/accounts/${id}/pairing?format=terminal`, {
    headers, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Pairing request failed (HTTP ' + response.status + ')');
  const { status, enabled, qr, pairingCode, pairingPhone, pairingState } = await response.json();
  if (enabled === false) throw new Error('Namba imesimamishwa. Washa replies kabla ya kuunganisha.');
  if (status === 'verifying' && lastStatus !== status) console.log('WhatsApp inathibitisha kifaa…');
  lastStatus = status;
  if (useCode && ['failed','expired'].includes(pairingState)) {
    throw new Error('Pairing code haikupatikana au muda wake umeisha. Endesha amri tena kuomba code mpya.');
  }
  if (status === 'connected') {
    console.log('WhatsApp imeunganishwa.');
    connected = true;
    break;
  }
  const errors = ['wrong_number', 'logged_out', 'replaced', 'blocked', 'mock'];
  if (errors.includes(status)) {
    const hint = status === 'wrong_number'
      ? ' Namba iliyojisajili kwenye simu hailingani na phone ya account; tumia reset-session kisha ujaribu tena.'
      : status === 'replaced' ? ' Namba imeunganishwa kwenye kifaa kingine; fungua WhatsApp ya CSbot au tumia reset-session.'
        : '';
    throw new Error('Hali ya WhatsApp: ' + status + '.' + hint);
  }
  if (!useCode && qr && qr !== lastQr) {
    console.log('WhatsApp → Linked devices → Link a device, kisha scan QR hii:');
    console.log(qr);
    lastQr = qr;
  }
  if (useCode && pairingCode && pairingCode !== lastCode) {
    console.log(`  →  ${pairingCode}   (namba ${pairingPhone})`);
    lastCode = pairingCode;
  }
  await sleep(2000);
}
if (!connected) throw new Error('Uthibitisho haukukamilika ndani ya dakika nne. Jaribu tena au tumia reset-session.');
