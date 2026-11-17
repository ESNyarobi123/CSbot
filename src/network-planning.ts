import type { PoolClient } from 'pg';
import { money, searchProducts } from './pos.js';
import { specKeys, type DeviceSpec } from './specs.js';
import type { Conversation } from './store.js';

type Memory = Conversation['memory'];
type Say = (sw: string, en: string) => string;
type Option = NonNullable<Memory['productOptions']>[number];
type Item = Awaited<ReturnType<typeof searchProducts>>['items'][number];

export function cleanSpecs(text?: string | null) {
  return (text ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

/** Only a distance explicitly described as wireless coverage qualifies. */
export function coverageOf(text?: string | null) {
  const match = /\b(?:cover(?:age|ing|s)?|range|radius|reach(?:es)?|umbali|inafikia)\b[^.;\d]{0,32}(?:mita\s+)?(\d{1,5})(?:\s*(?:[-–]|to|hadi)\s*(\d{1,5}))?\s*(metres?|meters?|mtr|mita|m)?(?![a-z0-9²])/i.exec(cleanSpecs(text));
  if (!match || (!match[3] && !/mita\s+\d/i.test(match[0]))) return undefined;
  const low = Number(match[1]), high = Number(match[2] ?? match[1]);
  if (!low || high < low) return undefined;
  return { low, high };
}

export function optionOf(item: { id: string; name: string; sku?: string; description?: string | null;
  price?: { amount: number; currency: string } }): Option {
  return { id: item.id, name: item.name, sku: item.sku, price: item.price && money(item.price),
    coverage: coverageOf(item.description)?.high };
}

export function optionLine(item: Option, say: Say) {
  return `• ${item.name}${item.price ? ' — ' + item.price : ''}`
    + (item.coverage ? say(` · hadi mita ${item.coverage}`, ` · up to ${item.coverage} m`) : '');
}

export function listedChoice(text: string, memory: Memory) {
  const normalized = text.trim().toLowerCase().replace(/[.?!]+$/, '');
  const listed = memory.productOptions ?? [];
  const exact = listed.find(item => [item.name, item.sku].some(value => value?.toLowerCase() === normalized));
  if (exact) return exact;
  const ordinal = /^(?:(?:namba|number|option|model|modeli|chaguo|ile|hiyo|the)\s+)?(?:(?:ya|la)\s+)?(\d{1,2}|kwanza|pili|tatu|nne|tano|sita|first|second|third|fourth|fifth|sixth)(?:\s+one)?$/.exec(normalized)?.[1];
  if (!ordinal) return;
  const index = Number(ordinal) || ['kwanza', 'pili', 'tatu', 'nne', 'tano', 'sita'].indexOf(ordinal) + 1
    || ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].indexOf(ordinal) + 1;
  const id = (memory.lastOptionIds ?? listed.map(item => item.id))[index - 1];
  return listed.find(item => item.id === id);
}

async function verifiedSheets(client: PoolClient, items: Item[]) {
  const keys = [...new Set(items.flatMap(specKeys))];
  if (!keys.length) return new Map<string, DeviceSpec>();
  const { rows } = await client.query<DeviceSpec>('SELECT * FROM device_specs WHERE verified AND model_key=ANY($1)', [keys]);
  return new Map(rows.map(sheet => [sheet.model_key, sheet]));
}

const meshMention = /\bmesh(?:ing)?\b/i;
export function mentionsMesh(text: string) {
  return meshMention.test(text);
}

function meshDocumented(item: Item, sheet?: DeviceSpec) {
  const text = cleanSpecs([item.description, sheet?.notes].filter(Boolean).join(' '));
  return meshMention.test(text) && !/\b(no|not|without|unsupported|hakuna|haina|haisaidii|haitumii|haikubali)\b[^.;]{0,40}\bmesh|\bmesh\b[^.;]{0,15}\b(no|unsupported|haipo|not supported|optional|requires verification)\b/i.test(text);
}

function nextQuestion(memory: Memory, say: Say, hasModels: boolean) {
  const req = memory.requirements ?? {};
  if (!req.coverageMeters) return say('Unataka Wi-Fi ifike umbali wa mita ngapi kutoka kwenye AP?', 'How far from the AP do you need Wi-Fi to reach?');
  if (!req.obstacles) return say('Eneo hilo ni la wazi au kuna vizuizi kama kuta na miti?', 'Is that area open, or are there walls or trees in the way?');
  if (!req.users) return say('Unatarajia watu wangapi watumie Wi-Fi kwa wakati mmoja?', 'How many people will use Wi-Fi at the same time?');
  return hasModels ? say('Ungependa nikague stock ya modeli ipi?', 'Which model would you like me to check for stock?')
    : say('Ungependa nikuunganishe na mhudumu akusaidie kukagua eneo na vifaa?', 'Would you like a team member to help check the site and equipment?');
}

/** Use live catalog prices and one batch of verified datasheets for the whole shortlist. */
export async function offerModels(client: PoolClient, query: string, memory: Memory, say: Say,
  planning?: Memory['planning'], more = false) {
  const req = planning ? memory.requirements ?? {} : {};
  const paragraphs: string[] = [];
  if (planning === 'mesh' && !more) {
    paragraphs.push(say('Kwa mesh, unahitaji router yenye intaneti na AP zinazokubali kufanya mesh pamoja. Unganisha AP ya kwanza kwenye router kwa waya. AP ya pili inahitaji umeme na sehemu inayopokea signal nzuri kutoka ya kwanza.',
      'For mesh, you need an internet router and APs that can form a mesh together. Wire the first AP to the router. The second needs power and a spot where it still receives a good signal from the first.'));
  }
  const { items } = await searchProducts(query, 60);
  const equipment = items.filter(item => item.type !== 'Service' && item.available !== false && item.available_to_sell !== 0);
  const sheets = planning ? await verifiedSheets(client, equipment) : new Map<string, DeviceSpec>();
  const models = equipment.flatMap(item => {
    const sheet = specKeys(item).map(key => sheets.get(key)).find(Boolean);
    if (planning === 'mesh' && !meshDocumented(item, sheet)) return [];
    if (req.environment && req.environment !== 'mixed' && sheet?.deployment && sheet.deployment !== 'both' && sheet.deployment !== req.environment) return [];
    const option = optionOf(item);
    if (sheet?.coverage_m) option.coverage = sheet.coverage_m;
    return [{ option, users: sheet?.users }];
  });
  const qualified = models.filter(({ option, users }) =>
    (!req.coverageMeters || (option.coverage ?? 0) >= req.coverageMeters)
    && (!req.users || (users ?? 0) >= req.users));
  const hasRequirements = Boolean(req.coverageMeters || req.users);
  const candidates = hasRequirements && qualified.length ? qualified : models;
  const prior = more ? (memory.productOptions ?? []) : [];
  const seen = new Set(prior.map(item => item.id));
  const page = candidates.filter(({ option }) => !seen.has(option.id)).slice(0, 6);
  if (more && !page.length) {
    return say(`Sijapata modeli nyingine za ${query} kwenye matokeo haya. Unatafuta modeli gani hasa?`,
      `I couldn’t find any further ${query} models in these results. Which model did you have in mind?`);
  }
  const preferences = [req.coverageMeters && say(`mita ${req.coverageMeters}`, `${req.coverageMeters} m`),
    req.users && say(`watumiaji ${req.users} kwa pamoja`, `${req.users} concurrent users`),
    req.obstacles === 'obstructed' && say('eneo lenye vizuizi', 'an obstructed site'),
    req.obstacles === 'open' && say('eneo la wazi', 'an open site')].filter(Boolean).join(', ');
  if (page.length) {
    const lead = more ? say('Hizi ni model zingine kwenye katalogi', 'Here are more models from the catalog')
      : hasRequirements && qualified.length ? say(`Kwa ${preferences}, hivi ni vifaa vya kuanzia kulingana na vipimo vilivyorekodiwa`,
        `For ${preferences}, these are candidates based on recorded specifications`)
      : say('Hizi ni baadhi ya modeli kwenye katalogi', 'Here are models from the catalog');
    paragraphs.push(lead + '\n' + page.map(({ option, users }) => optionLine(option, say)
      + (req.users && users ? say(` · hadi watumiaji ${users}`, ` · up to ${users} users`) : '')).join('\n'));
  }
  if (planning) {
    if (!page.length && planning === 'mesh') {
      paragraphs.push(say('Bado sijapata modeli yenye mesh iliyothibitishwa kwenye maelezo ya vifaa nilivyokagua.',
        'I couldn’t verify mesh support for the models I checked.'));
    } else if (!page.length) {
      paragraphs.push(say('Sijapata kifaa kinacholingana kwenye katalogi.', 'I couldn’t find a matching device in the catalog.'));
    }
    if (hasRequirements && !qualified.length) {
      const highest = Math.max(0, ...models.map(({ option }) => option.coverage ?? 0));
      paragraphs.push(req.coverageMeters && highest && highest < req.coverageMeters
        ? say(`Kwenye orodha hii coverage inayotajwa ni hadi mita ${highest}. Kwa mita ${req.coverageMeters}, huenda ukahitaji AP zaidi ya moja.`,
          `The highest stated range here is ${highest} m. Covering ${req.coverageMeters} m may need more than one AP.`)
        : say(`Kwa ${preferences}, sijapata vipimo vinavyothibitisha kwamba kifaa kimoja kinatosha.`,
          `For ${preferences}, I couldn’t verify that one device meets the stated requirements.`));
    } else if (req.coverageMeters) {
      paragraphs.push(say('Umbali kwenye vipimo ni wa eneo la wazi. Kuta, miti na mahali pa kuweka AP huathiri signal.',
        'Range figures assume open space. Walls, trees and AP placement affect the signal.'));
    }
    paragraphs.push(nextQuestion(memory, say, Boolean(page.length && qualified.length)));
  } else if (page.length) {
    paragraphs.push(say('Ungependa maelezo ya modeli ipi?', 'Which model would you like details about?'));
  } else {
    paragraphs.push(say(`Sijapata modeli za ${query} kwenye katalogi. Una jina la modeli au SKU?`,
      `I couldn’t find a ${query} model in the catalog. Do you have a model name or SKU?`));
  }
  memory.productOptions = [...prior, ...page.map(({ option }) => option)];
  memory.lastOptionIds = page.map(({ option }) => option.id);
  memory.optionQuery = query;
  memory.planning = planning;
  delete memory.awaitingService;
  delete memory.product;
  delete memory.lastQuote;
  delete memory.quoteFor;
  return paragraphs.join('\n\n');
}
