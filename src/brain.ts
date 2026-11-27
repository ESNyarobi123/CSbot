import { deepseekJson } from './deepseek.js';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { log } from './db.js';
import type { Conversation } from './store.js';

/**
 * The thinking layer.
 *
 * The sales rules in assistant.ts decide *what* to do. This module is what the
 * bot knows and how it phrases an answer: the facts it has picked up from the
 * customer, the ones it keeps between chats, and a composer that may only use
 * the facts it is handed. A model allowed to write from memory invents ports and
 * ranges; one that is handed a sheet and checked against it cannot.
 */

export type Facts = Record<string, string>;

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------------- *
 * What the customer has told us
 * ------------------------------------------------------------------------- */

const metres = /\b(?:mita|metres?|meters?|mtr)\s*(\d{1,5})\b|\b(\d{1,5})\s*(?:mita|metres?|meters?|mtr)\b/i;
// "kilomita" is how most customers spell it in a WhatsApp message; only
// "kilometa"/"km" were read, so a 2 km link request lost its distance.
const kilometres = /\b(?:kilomit\w*|kilomet\w*|km)\s*(\d+(?:[.,]\d+)?)\b|\b(\d+(?:[.,]\d+)?)\s*(?:kilomit\w*|kilomet\w*|km)\b/i;
export function siteDistance(text: string) {
  if (/\b(?:waya|cables?|wires?|kebo|nyaya|cat\s?-?\s?6)\b/i.test(text)) return undefined;
  const km = kilometres.exec(text);
  const match = km || metres.exec(text);
  if (!match) return undefined;
  const value = Number((match[1] ?? match[2]).replace(',', '.')) * (km ? 1000 : 1);
  return value > 0 && value <= 100000 ? Math.round(value) : undefined;
}
const users = /\b(\d{1,5})\s*(?:\+)?\s*(?:wateja|watumiaji|clients?|users?|devices?|simu)\b|\b(?:wateja|watumiaji|clients?|users?)\s*(?:hadi\s*|karibu\s*)?(\d{1,5})\b/i;
const openArea = /\b(wazi|open area|bila kizuizi|no obstacles|open space)\b/i;
const obstructed = /\b(kizuizi|vizui?zi|ukuta|kuta|miti|mti|walls?|trees?|obstructed|maghorofa|floors?)\b/i;
const systems = /\b(wotefy|lubfy)\b/i;
const omada = /\b(omada|eap|tp ?-? ?link)\b/i;
const multiVendor = /\b(mikrotik|routeros|cudy|ruijie|reyee|cambium|unifi|ubiquiti|comfast)\b/i;
const modelLike = /\b(?:[a-z]{2,6}[ -]?\d{2,4}[a-z]?)\b/gi;
const useCases: [RegExp, string][] = [
  [/\b(hoteli|hotel|lodge|guest ?house)\b/i, 'hotel'],
  [/\b(shule|school|chuo|college)\b/i, 'school'],
  [/\b(ofisi|office|kampuni|company)\b/i, 'office'],
  [/\b(mgahawa|restaurant|cafe|kahawa)\b/i, 'restaurant'],
  [/\b(kanisa|church|msikiti|mosque)\b/i, 'worship'],
  [/\b(duka|supermarket|shop)\b/i, 'shop'],
  [/\b(kliniki|hospital|clinic)\b/i, 'clinic'],
  [/\b(nyumbani|home|nyumba)\b/i, 'home'],
  [/\b(hostel|bweni|apartment|flats?)\b/i, 'hostel'],
];

/**
 * Read the site facts out of a sentence. Only what the customer actually wrote:
 * a budget that was never mentioned stays absent instead of becoming a default.
 */
export function recall(text: string, previous?: Facts): Facts {
  const facts: Facts = { ...previous };
  const put = (key: string, value: string | undefined) => {
    if (value && value !== facts[key]) facts[key] = value;
  };
  const distance = siteDistance(text);
  if (distance) put('coverage_m', String(distance));
  const people = users.exec(text);
  if (people) put('clients', people[1] ?? people[2]);
  if (/\b(ndani|indoor)\b/i.test(text)) put('place', 'indoor');
  if (/\b(nje|outdoor|uwani|shamba)\b/i.test(text)) put('place', 'outdoor');
  if (/bila (?:kizuizi|vizuizi)|no obstacles/i.test(text)) put('site', 'open');
  else if (obstructed.test(text)) put('site', 'obstructed');
  else if (openArea.test(text)) put('site', 'open');
  const system = systems.exec(text)?.[1]?.toLowerCase();
  if (system) put('system', system);
  const owns = /\b(?:nina|tuna|natumia|ninatumia|tunatumia|i have|we have|i use|we use|already have)\b/i.test(text);
  if (owns && omada.test(text)) put('fleet', 'omada');
  else if (owns && multiVendor.test(text)) put('fleet', 'multivendor');
  for (const [pattern, label] of useCases) {
    if (pattern.test(text)) { put('use', label); break; }
  }
  // "natumia Omada controller" and "nina EAP 610" tell the bot what is already
  // on site, which changes the recommendation more than any other single fact.
  const models = [...new Set((text.match(modelLike) ?? []).map(clean).map(item => item.toUpperCase()))]
    .filter(item => /\d/.test(item) && !/^(MITA|METRES?|METERS?|WATEJA|USERS?|WATU)\b/.test(item))
    .slice(0, 4);
  if (owns && models.length) {
    const known = new Set((facts.equipment ?? '').split(' · ').filter(Boolean));
    for (const model of models) known.add(model);
    put('equipment', [...known].slice(0, 8).join(' · '));
  }
  // "Nina Omada controller" names no model, but it is the single most useful
  // fact for a recommendation: the controller decides which AP family fits.
  if (/\b(?:nina|tunatumia|natumia|ninatumia|tuna|i have|we have|i use|we use|already have|tayari nina)\b/i.test(text)) {
    const owned: [RegExp, string][] = [
      [/\bomada\b/i, 'OMADA CONTROLLER'], [/\bmikrotik\b/i, 'MIKROTIK ROUTEROS'],
      [/\b(?:reyee|ruijie)\b/i, 'REYEE NETWORK'], [/\b(?:unifi|ubiquiti)\b/i, 'UNIFI CONTROLLER'],
      [/\bcudy\b/i, 'CUDY AP'], [/\bcambium\b/i, 'CAMBIUM'],
    ];
    const known = new Set((facts.equipment ?? '').split(' · ').filter(Boolean));
    for (const [pattern, label] of owned) if (pattern.test(text)) known.add(label);
    if (known.size) put('equipment', [...known].slice(0, 8).join(' · '));
  }
  const budget = /\b(?:bajeti|budget)[^.\n]{0,40}?(\d[\d,.]{2,})\s*(k|elfu|million|milioni)?/i.exec(text);
  if (budget) put('budget', `${budget[1]}${budget[2] ? ' ' + budget[2] : ''}`);
  if (/\bmesh(?:ing)?\b/i.test(text)) put('asked_mesh', 'yes');
  if (/\b(cctv|camera|kamera)\b/i.test(text)) put('also', 'cctv');
  if (/\b(printer|printa|risiti)\b/i.test(text)) put('also', 'printer');
  if (/\b(mfumo|system|billing|bili)\b/i.test(text)) put('also', 'billing');
  const town = /\b(?:ukija|kuja|huku|nipo|niko)\s+([\p{L}]{3,24})\s+mjini\b/iu.exec(text);
  if (town) put('town', town[1].toLowerCase());
  if (/\b(?:surv(?:ey|aey|ei)|invest(?:ment)?|uwekezaji|kuwekeza)\b/i.test(text)
      && /\b(?:wi-?fi|hotspot|billing|intaneti|internet)\b/i.test(text)) {
    put('goal', 'start a wifi billing site');
  }
  return facts;
}

/** The facts as the customer would recognise them, for the playground panel. */
export function factList(facts?: Facts) {
  if (!facts) return [];
  const labels: Record<string, string> = {
    coverage_m: 'Distance to cover', clients: 'Concurrent users', place: 'Indoor / outdoor',
    site: 'Site', system: 'Billing system', fleet: 'Existing fleet', equipment: 'Equipment already owned',
    use: 'Use case', budget: 'Budget', asked_mesh: 'Asked about mesh', also: 'Also interested in',
    last_model: 'Last model discussed',
    photo: 'Model read from photo',
    town: 'Town',
    goal: 'Goal',
  };
  return Object.entries(facts)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => ({ key, label: labels[key] ?? key, value: value.replace(/\b\w/g, c => c.toUpperCase()) }));
}

/** Facts in one block for a prompt, newest site knowledge first. */
export function factBrief(facts?: Facts) {
  if (!facts) return '';
  // The last model is continuity for the chat, not something the customer said
  // about their site; handing it to the composer invites "you already own it".
  return Object.entries(facts).filter(([key, value]) => Boolean(value) && key !== 'last_model')
    .map(([key, value]) => `${key}: ${value}`).join('\n');
}

/* ------------------------------------------------------------------------- *
 * What the shop remembers between chats
 * ------------------------------------------------------------------------- */

type Db = Pool | PoolClient;

/**
 * A customer who comes back on Friday should not explain their compound again.
 * The memory is per WhatsApp number, so it survives a closed conversation and
 * the bot's own restart.
 */
export async function loadCustomerMemory(client: Db, accountId: string, jid: string): Promise<Facts> {
  try {
    const found = await client.query<{ facts: Facts }>(
      'SELECT facts FROM customer_memory WHERE account_id=$1 AND jid=$2', [accountId, jid]);
    return found.rows[0]?.facts ?? {};
  } catch (error) {
    // A missing table during a rolling deploy must not stop the reply.
    log.debug({ code: (error as Error).name }, 'Customer memory unavailable');
    return {};
  }
}

export async function saveCustomerMemory(client: Db, accountId: string, jid: string, facts: Facts) {
  if (!facts || !Object.keys(facts).length) return;
  const bounded = Object.fromEntries(Object.entries(facts)
    .filter(([, value]) => typeof value === 'string' && value.length <= 300).slice(0, 24));
  await client.query(`INSERT INTO customer_memory (account_id,jid,facts) VALUES ($1,$2,$3)
    ON CONFLICT (account_id,jid) DO UPDATE SET facts=EXCLUDED.facts,updated_at=now()`,
  [accountId, jid, bounded]).catch(error =>
    log.debug({ code: (error as Error).name }, 'Customer memory not saved'));
}

/* ------------------------------------------------------------------------- *
 * The composer
 * ------------------------------------------------------------------------- */

const composed = z.object({
  answer: z.string().min(1).max(1600),
  confidence: z.number().min(0).max(1).default(0.5),
});

/** Every number the customer could be shown, so a generated one can be checked. */
export function numbersIn(text: string) {
  return new Set((text.match(/\d+(?:[.,]\d+)?/g) ?? []).map(value => value.replace(',', '.')));
}

/**
 * A generated answer may reuse the sheet's figures and nothing else. The check
 * is deliberately blunt: an answer with one number that is not in the facts is
 * thrown away and the deterministic reply is used, because a confident wrong
 * port count costs a sale and a support call.
 */
export function grounded(answer: string, sources: string) {
  const allowed = numbersIn(sources);
  for (const value of numbersIn(answer)) {
    if (!allowed.has(value)) return { ok: false as const, value };
  }
  return { ok: true as const };
}

export interface ComposeInput {
  question: string;
  /** Only facts the answer may use: datasheet, price, stock, approved knowledge. */
  facts: string;
  language: 'sw' | 'en';
  /** One line describing what the customer is trying to do, e.g. "cover 300 m outdoors". */
  goal?: string;
  /** Recent turns, so "hiyo" has a referent. Not a source of prices or ranges. */
  context?: string;
}

/** The last few turns, short enough to keep the model on the current question. */
export function chatContext(history: { direction: string; body: string }[]) {
  return history.slice(-4).map(line =>
    `${line.direction === 'inbound' ? 'Customer' : 'Shop'}: ${line.body.replace(/\s+/g, ' ').trim().slice(0, 220)}`)
    .filter(line => line.length > 12).join('\n');
}

/**
 * Write the reply in the customer's language from the supplied facts. Returns
 * undefined when the model is offline or wrote something the facts do not
 * support, so the caller can fall back to the deterministic lines.
 */
export async function compose(input: ComposeInput): Promise<{ answer: string; confidence: number } | undefined> {
  const language = input.language === 'en' ? 'English' : 'Kiswahili';
  const prompt = `${input.context ? `EARLIER MESSAGES (what the customer is referring to; prices, ranges and stock still come only from FACTS)\n${input.context}\n\n` : ''}FACTS (the only truth you may use)
${input.facts}

CUSTOMER MESSAGE
${input.question}${input.goal ? `\n\nGOAL\n${input.goal}` : ''}`;
  const systemInstruction = `You are CSbot, the WhatsApp assistant for Connect Solution, a Tanzanian network-equipment shop in Sinza Makaburini, Dar es Salaam.
Write the reply in ${language}.

Rules, in order of importance:
1. Use ONLY the FACTS block. Every number, model name, port, band, range, client count, power figure and compatibility claim must appear in FACTS. Never fill a gap with what you know about similar hardware.
2. A missing field means UNKNOWN, never "no". If FACTS carry no stated range, do not say the device is short of the distance and do not say it reaches it: say the range is not recorded, then offer the next honest step (ask for the site size, or have the team confirm).
3. "Managed by" is not the same as "works with". Say which controller manages the device. Never claim a device cannot work alongside another brand unless FACTS state that incompatibility; instead say what the customer would gain by staying with the system they already run.
4. If FACTS do not answer the question, say plainly which detail is not recorded, then either ask one question that would settle it or say the team will confirm it. Never apologise twice.
5. Answer the actual question first, then at most one useful next step. Explain like an experienced network engineer talking to a shop owner: short sentences, concrete words, no marketing.
6. When the customer names a site requirement (distance, users, walls), compare it only against fields FACTS actually carry. If FACTS carry the range and it is shorter than the distance, say so and mention how many units would be realistic.
7. Mention the price and stock only when FACTS contain them. Never quote installation or cable unless the customer asked for it.
8. No headings, no markdown bold, no emoji. A short list of specs is fine when the customer asked for specs.
9. When FACTS say the sheet is unverified, present the figures as the shop's record and offer to confirm with the manufacturer.
10. Never promise a discount, a delivery date or stock you were not given.
11. Use EARLIER MESSAGES only to see which device or site the customer means. Never copy a price, range or stock figure from them.
12. Close with at most one question, and only when one missing fact would change the recommendation.`;

  const value = await deepseekJson({ schema: composed, system: systemInstruction, prompt, maxTokens: 650 });
  if (!value) return;
  const check = grounded(value.answer, `${input.facts}\n${input.question}`);
  if (!check.ok) {
    log.warn('Composed answer used a number outside the facts');
    return;
  }
  return { answer: clean(value.answer), confidence: value.confidence };
}

/* ------------------------------------------------------------------------- *
 * Reading a photo the customer sends
 * ------------------------------------------------------------------------- */

const identified = z.object({
  brand: z.string().max(60).default(''),
  model: z.string().max(80).default(''),
  kind: z.string().max(60).default(''),
  confidence: z.number().min(0).max(1).default(0),
  visible: z.string().max(500).default(''),
});

/**
 * Identify the box in a customer photo. Only an identification, not a price and
 * not a spec sheet: the caller looks the model up in the shop before saying
 * anything about it.
 */
export async function identifyDevice(
  image: { base64: string; mimetype: string },
) {
  const systemInstruction = `You identify networking hardware from a customer photo for a Tanzanian shop.
Return JSON only. "model" is the exact model printed on the device or its label (for example "EAP 650", "RG-RAP6262(G)", "hAP ax2"), or "" when no model is legible.
"brand" is the maker. "kind" is a short category ("access point", "router", "switch", "antenna", "cable").
"visible" lists only what you can actually read or see: band, port count, LEDs, label text. Never guess a specification that is not visible.
Use confidence below 0.5 when the photo is too far away, blurry or shows only part of the device.`;
  return deepseekJson({ schema: identified, system: systemInstruction, prompt: 'Identify this device.', image, maxTokens: 400 });
}

const understood = z.object({
  kind: z.enum(['device', 'pricing', 'portal', 'receipt', 'error', 'document', 'other']).default('other'),
  summary: z.string().max(400).default(''),
  brand: z.string().max(60).default(''),
  model: z.string().max(80).default(''),
  confidence: z.number().min(0).max(1).default(0),
});
export type UnderstoodImage = z.infer<typeof understood>;

/**
 * Read whatever the customer sent and say what kind of image it is. The photo
 * flow used to assume every picture is hardware and answer "write the model on
 * the label" — which is nonsense for a Wi-Fi package page or a receipt. This is
 * the general fallback: it classifies the image and the caller replies to that
 * kind, so a portal screenshot is met with a portal question, not a label one.
 */
export async function understandImage(
  image: { base64: string; mimetype: string },
): Promise<UnderstoodImage | undefined> {
  const systemInstruction = `You look at whatever the customer sent and describe it for Connect Solution, a Tanzanian network-equipment shop.
Return JSON only. Decide "kind":
- "device": networking hardware — access point, router, switch, antenna, its box or label.
- "pricing": a price list, a Wi-Fi package/pricing page (prices and data bundles), or a table of mobile-money providers, currencies or payment methods.
- "portal": a Wi-Fi login or landing page a customer sees to connect.
- "receipt": a payment receipt or transaction confirmation.
- "error": an error message or a broken screen.
- "document": a letter, form or written document.
- "other": anything else.
"summary" is one short sentence describing what is visible (for example "a Wi-Fi package page listing 1GB for TSh 500"). "model" and "brand" are filled only when kind is "device" and the model is legible; otherwise empty strings.
Use confidence below 0.5 when the image is too unclear to classify.`;
  return deepseekJson({ schema: understood, system: systemInstruction, prompt: 'Describe this image.', image, maxTokens: 460 });
}
