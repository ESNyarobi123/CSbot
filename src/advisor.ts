import type { GoogleGenAI } from '@google/genai';
import type { PoolClient } from 'pg';
import { compose, factBrief, type Facts } from './brain.js';
import { money, readProduct, searchProducts } from './pos.js';
import { sheetFor, specsFor, specsForMany, specBrief } from './specs.js';
import type { Conversation } from './store.js';

/**
 * Turns a device question into a grounded answer.
 *
 * The rule engine already knows which product the customer means. This module
 * gathers everything the shop actually recorded about it — datasheet, price,
 * stock, the other models it can be compared with, the customer's own site —
 * and writes the reply from that. The deterministic lines are still the
 * fallback when the model is down or writes a figure the facts do not carry.
 */

type Say = (sw: string, en: string) => string;

export interface Advice {
  answer: string;
  /** What the bot read and why, shown in the admin playground. */
  trace: string[];
}

const cleanSpecs = (text?: string | null) =>
  (text ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();

async function readWithRetry(id: string) {
  let last: unknown;
  for (const wait of [0, 300, 700]) {
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    try {
      return await readProduct(id);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

function goalFrom(facts?: Facts) {
  if (!facts) return '';
  const parts: string[] = [];
  if (facts.coverage_m) parts.push(`needs Wi-Fi to reach about ${facts.coverage_m} m`);
  if (facts.clients) parts.push(`${facts.clients} devices connected at once`);
  if (facts.site === 'obstructed') parts.push('the site has walls, trees or floors in the way');
  if (facts.site === 'open') parts.push('the site is open');
  if (facts.place) parts.push(`installation is ${facts.place}`);
  if (facts.use) parts.push(`the site is a ${facts.use}`);
  if (facts.equipment) parts.push(`already owns: ${facts.equipment}`);
  if (facts.fleet === 'omada') parts.push('already runs the Omada ecosystem');
  if (facts.asked_mesh) parts.push('asked about mesh');
  return parts.join('; ');
}

/** A short, comparable line for a model the customer could pick instead. */
function relatedLine(name: string, price: string | undefined, coverage: number | undefined,
  users: number | undefined, mesh: boolean | null | undefined, say: Say) {
  const bits = [price, coverage ? say(`hadi mita ${coverage}`, `up to ${coverage} m`) : '',
    users ? say(`hadi watumiaji ${users}`, `up to ${users} users`) : '',
    mesh ? say('mesh', 'mesh') : ''].filter(Boolean);
  return `- ${name}${bits.length ? ' — ' + bits.join(' · ') : ''}`;
}

export interface AdviceInput {
  ai?: GoogleGenAI;
  client: PoolClient;
  product: { id: string; name: string };
  question: string;
  memory: Conversation['memory'];
  say: Say;
  language: 'sw' | 'en';
  /** Approved knowledge that mentions this device or its system, if any. */
  knowledge?: string;
  /**
   * Facts the caller appends to the reply itself (installation fees, cable).
   * Without them the composer says "not recorded" and the deterministic lines
   * then quote a price, so one reply contradicts itself.
   */
  extraFacts?: string[];
}

/**
 * Answer a spec, coverage, compatibility or comparison question about one
 * device. Undefined means "nothing recorded to answer from" — the caller then
 * uses the honest fallback rather than letting a model guess.
 */
export async function adviseOnDevice(input: AdviceInput): Promise<Advice | undefined> {
  const trace: string[] = [];
  let product: Awaited<ReturnType<typeof readProduct>>['product'];
  let stock: Awaited<ReturnType<typeof readProduct>>['stock'];
  try {
    ({ product, stock } = await readWithRetry(input.product.id));
  } catch {
    trace.push(`Catalog read failed for ${input.product.name}`);
    return undefined;
  }
  const sheet = await specsFor(product, input.client).catch(() => undefined);
  const description = cleanSpecs(product.description);
  trace.push(`Device: ${product.name}`);
  if (sheet) {
    const filled = Object.entries(sheet).filter(([key, value]) =>
      !['model_key', 'updated_at', 'source_url'].includes(key) && value !== null && value !== ''
      && value !== false && !(Array.isArray(value) && !value.length)).length;
    trace.push(`Datasheet: ${filled} recorded fields${sheet.verified ? ', verified' : ', not yet verified'}`);
  } else {
    trace.push('Datasheet: none recorded for this model');
  }
  // A model with neither a sheet nor a description has nothing to reason from.
  if (!sheet && !description) return undefined;

  const inStock = stock.available ?? stock.available_to_sell > 0;
  const facts: string[] = [
    `Product: ${product.name}`,
    `Price: ${money(product.price)}`,
    `Stock: ${inStock ? 'in stock' : 'out of stock'}`,
    [product.brand && `Brand: ${product.brand}`, product.category && `Category: ${product.category}`,
      product.warranty ? `Warranty: ${product.warranty} months` : ''].filter(Boolean).join(' · '),
    description && `Shop description: ${description}`,
  ].filter(Boolean);

  if (sheet) {
    facts.push('--- DATASHEET ---', specBrief(sheet));
  }

  // The alternatives a real engineer would mention next to this one. Same
  // category, real prices, only recorded facts, and never the cable by the metre.
  try {
    const { items } = await searchProducts(product.category || product.name, 20);
    const others = items.filter(item => item.id !== product.id && item.type !== 'Service'
      && !/^(m|meter|metre|metres|meters)$/i.test(item.unit ?? '')
      && !/cable|service/i.test(item.category ?? '')).slice(0, 4);
    if (others.length) {
      const sheets = await specsForMany(others, input.client).catch(() => new Map());
      const lines = others.map(item => {
        const other = sheetFor(sheets, item);
        return relatedLine(item.name, item.price ? money(item.price) : undefined,
          other?.coverage_m ?? undefined, other?.users ?? undefined, other?.mesh, input.say);
      });
      facts.push('--- OTHER MODELS THE SHOP STOCKS IN THIS CATEGORY ---', ...lines);
      trace.push(`Compared with ${others.length} other models in ${product.category ?? 'the catalog'}`);
    }
  } catch {
    trace.push('No comparison models could be read');
  }

  const site = factBrief(input.memory.facts);
  if (site) {
    facts.push('--- WHAT THIS CUSTOMER HAS ALREADY TOLD US ---', site);
    trace.push(`Site facts: ${site.replace(/\n/g, ', ')}`);
  }
  if (input.memory.facts?.equipment) {
    facts.push(`Equipment the customer mentioned earlier: ${input.memory.facts.equipment}`);
  }
  if (input.knowledge) facts.push('--- APPROVED SHOP KNOWLEDGE ---', input.knowledge.slice(0, 2500));
  facts.push('--- SYSTEM FIT ---',
    'WoteFy runs on TP-Link Omada EAP. LubFy manages MikroTik, Cudy, TP-Link Omada, Ruijie/Reyee, Cambium and Ubiquiti UniFi.');
  if (input.extraFacts?.length) facts.push('--- QUOTED SEPARATELY IN THIS REPLY ---', ...input.extraFacts);

  const written = await compose({
    ai: input.ai, question: input.question, facts: facts.join('\n'), language: input.language,
    goal: goalFrom(input.memory.facts),
  });
  if (!written) {
    trace.push('Composer unavailable or ungrounded — using the recorded lines');
    return undefined;
  }
  trace.push(`Composed from facts (confidence ${written.confidence.toFixed(2)})`);
  return { answer: written.answer, trace };
}
