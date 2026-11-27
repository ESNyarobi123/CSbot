import { modelQuery, systemName } from './pos.js';

/**
 * Reading the customer's message: who they are, what language they used, and
 * whether it is small talk, a support report or a device enquiry. These are pure
 * functions with no database or network, so the conversation flow in
 * `assistant.ts` and the support intake in `support.ts` can both use them.
 */

export const modelName = /\b(?:cudy|eap|omada|mikrotik|ruijie|reyee|cambium|unifi|router|switch|access point|gateway|sku)\b|\b(?:eap|er|wr|rb)[- ]?\d+/i;

/**
 * True only when the message brings a model or a vendor, so a generic word
 * ("router", "access point") or a cable length is not mistaken for a new device
 * the customer wants priced.
 */
export function namesNewDevice(text: string) {
  const stripped = text
    .replace(/\b\d{1,3}(?:,\d{3})+\b|\b(?:tzs|tsh|sh)\s*\d+\b/gi, ' ')
    .replace(/\b(?:mita|metres?|meters?|mtr)\s*\d{1,3}\b/gi, ' ')
    .replace(/\b\d{1,3}\s*(?:mita|metres?|meters?|mtr)\b/gi, ' ');
  return Boolean(modelQuery(stripped))
    || /\b(?:cudy|omada|mikrotik|ruijie|reyee|cambium|unifi|ubiquiti|comfast)\b/i.test(stripped);
}

export const systemFrom = (text: string) => {
  const aliases = { wotefy: /\b(?:wote[ -]?fy|ss[ -]?domada)\b/i, lubfy: /\blub[ -]?fy\b/i };
  const systems = systemName.options.filter(name => aliases[name].test(text));
  return systems.length === 1 ? systems[0] : '';
};

export const systemLabel = (system: string) => system === 'wotefy' ? 'WoteFy' : system === 'lubfy' ? 'LubFy' : '';

/**
 * A broken system is a support case, not a price request. Kept narrow enough
 * that a stock question ("haipatikani?") does not become one.
 */
const supportWords = /\b(shida|tatizo|matatizo|haifanyi kazi|haifanyi vizuri|haifunguki|haionekani|haiongei|haifikii|umesimama|imesimama|imekwama|imegoma|imefeli|imefail|imekataliwa na mtandao|siwezi kuingia|sijaweza kuingia|haikubali|inaleta error|naipata error|imebadilika ghafla|sina internet|hakuna internet|haipati internet|problem|issue|not working|doesn't work|does not work|can't log ?in|cannot log ?in|can't login|cannot login|failed|stuck|support|troubleshoot)\b/i;

/** A first-line technical report, e.g. "Portal haifunguki kwenye simu". */
const portalFailure = /\b(?:portal|captive portal)\b.{0,60}\b(?:inachelewa|inachukua muda|haitokei)|\b(?:haitoi|hakitoi|haitokei|haimpeleki|haileti|doesn.t open|doesn.t redirect)\b.{0,55}\bportal\b/i;
const trialFailure = /\b(?:free[ -]?trial|jaribio la bure)\b/i;
const failure = /\b(?:haiwa[ -]?connect|hai[ -]?connect|inakuja (?:hivyo|kama)|haifanyi|haifunguki|haitokei|haikubali|haianzi|inagoma|error|failed|unavailable|not working)\b/i;

export function symptomOf(text: string) {
  const line = text.replace(/\n/g, ' ');
  if (/\b(?:nimelipa|wamelipa|amelipa|malipo|paid|payment)\b/i.test(line) &&
      /\b(?:internet|intaneti|wi-?fi|portal|hotspot|voucher|package|kifurushi|subscription)\b/i.test(line) &&
      /\b(?:haijafunguka|haijaanza|haijaingia|haijaactivate|haijaunganishwa|haipati|bado|pending|still|not activated|did not connect)\b/i.test(line)) return 'access_payment';
  if (trialFailure.test(line) && failure.test(line)) return 'trial';
  if (portalFailure.test(line)) return 'redirect';
  if (/\b(?:offline|kimepoteza connection|disconnected)\b/i.test(line) &&
      /\b(?:device|router|kifaa|gateway|eap|access point|mikrotik|cudy)\b/i.test(line)) return 'offline';
  if (/\b(?:router|kifaa|access point|switch|eap)\b.{0,40}\b(?:haiwaki|hakiwaki|hakina umeme|no power|won.t power on)\b/i.test(line)) return 'power';
  return undefined;
}

export function supportQuestion(text: string) {
  return supportWords.test(text) || Boolean(symptomOf(text));
}

/**
 * LubFy posts reseller, withdrawal and agent alerts into the shop WhatsApp.
 * Those are not customers, and answering them with a price list trains the
 * chat to sell to a notification.
 */
export function platformNotice(text: string) {
  if (!/lubfy\.online\/admin\/(?:reseller|resellers|withdrawal|agent|onboarding)/i.test(text)) return false;
  if (!/\b(?:new reseller|withdrawal request|agent request|self registration)\b/i.test(text)) return false;
  // A person who forwards the alert and then asks a question still gets an answer.
  if (/\?/.test(text) || supportQuestion(text)) return false;
  return true;
}

/**
 * "Where do I create the customer account?" is a dashboard question. The word
 * "gateway" in the same sentence is the device they are configuring, not a
 * model they want to buy.
 */
export function accountQuestion(text: string) {
  if (platformNotice(text) || supportQuestion(text)) return false;
  if (/\b(?:bei|price|nunua|buy|order|stock)\b/i.test(text)) return false;
  return /\b(?:accounts?|akaunti|akaunt)\b/i.test(text)
    && /\b(?:wapi|where|jinsi|namna|how|tunafung\w*|tunamtengenez\w*|kufungua|kuunda|create|fungua|inafunguliwa)\b/i.test(text);
}

/**
 * "Does WoteFy work across all of East Africa?" is about where the system
 * operates — a region, country or currency — not about the customer's own site
 * size. The stored "coverage_m" (their 1 km) must not be dragged into this
 * answer, otherwise the bot "remembers but answers the wrong question".
 */
export function regionQuestion(text: string) {
  if (/\b(?:mita|metres?|meters?|mtr|km|kilomit\w*|kilomet\w*)\b/i.test(text)) return false;
  const region = /\b(?:africa|afrika|mashariki|east africa|nchi|country|countries|region|mkoa|currency|currencies|sarafu)\b/i.test(text);
  if (!region) return false;
  return /\b(?:wotefy|lubfy|mfumo|system|billing|malipo|payment|mobile money|mpesa|airtel|orange money|mtn|nafanya kazi|inafanya kazi|unafanya kazi|works?|operate|runs?|supported)\b/i.test(text);
}

/**
 * "Can I make a profit from this business?" is about the viability of the Wi-Fi
 * billing business, not about buying a device. The phrase "naweza pata" must
 * not turn it into a product-availability question ("which product?").
 */
export function profitQuestion(text: string) {
  if (!/\b(?:faida|mapato|profit|income|revenue|biashara|business)\b/i.test(text)) return false;
  return /\b(?:faida|mapato|profit|income|revenue)\b/i.test(text)
    && /\b(?:biashara|business|wifi|wi-?fi|hotspot|billing|intaneti|internet|mfumo|system|wotefy|lubfy)\b/i.test(text);
}

export const emailPattern = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u;

/** Email the customer typed, used to find their account. */
export function emailOf(text: string) {
  return emailPattern.exec(text)?.[0]?.toLowerCase();
}

/**
 * A customer telling the bot to stop. Proactive follow-ups must honour this or
 * the number gets reported and banned, so the message is short and unambiguous.
 */
const optOutPhrases = /\b(?:acha|niachie|nisamehe|sitaki\s+(?:ujumbe|kuendelea|kupokea)|acha\s+(?:kunijibu|kunitumia|kunitaarifu)|usinijibu|usinitumie|stop|unsubscribe|opt[ -]?out|mute)\b/i;
export function optOutRequest(text: string) {
  // "acha nikufahamishe" is the opposite; only a request about the bot's own
  // messages counts, and only when it is the whole message.
  if (text.trim().length > 60) return false;
  if (/\b(?:hapana|endelea|endlea|continue|nikufahamishe|nitaacha|mtu|kifaa)\b/i.test(text)) return false;
  return optOutPhrases.test(text);
}

/** Evaluate each original message before the debounce batch is joined or truncated. */
export function latestConsent(messages: { body: string }[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i].body.trim();
    if (optOutRequest(text)) return 'stop';
    if (/^(?:anza|endelea|start|resume|nirudishe|anza kunijibu|resume replies)[.! ]*$/i.test(text)) return 'resume';
  }
}

// Not everyone on this number is buying. "Mambo", "vipi" or "poa" is a person
// saying hello, and answers itself — a pitch there reads like a call centre and
// loses the friendly chats that later turn into customers.
const smallTalkWords = new Set([
  'mambo', 'mamboo', 'mamboz', 'vipi', 'vpp', 'vip', 'niaje', 'sasa', 'habari', 'hujambo', 'sijambo',
  'shikamoo', 'marahaba', 'salama', 'poa', 'safi', 'fresh', 'nzuri', 'sana', 'asante', 'shukran',
  'karibu', 'ok', 'okay', 'sawa', 'ndio', 'yes', 'hello', 'hi', 'hey', 'yo', 'sup', 'good',
  'morning', 'afternoon', 'evening', 'asubuhi', 'mchana', 'jioni', 'chief', 'mzee', 'bro',
  'brother', 'dada', 'kaka', 'yako', 'za', 'tu', 'je', 'basi', 'haya', 'aisee', 'dah', 'poa',
]);
const greetingWord = /^(mambo+|vipi|vpp|niaje|habari|hujambo|sijambo|shikamoo|salama|poa|safi|nzuri|hello+|hi+|hey+|yo|sup|sasa|morning|afternoon|evening|asubuhi|mchana|jioni|asante|shukran|thanks|thank|thx|kaka|dada|mkuu|boss|bro|brother|chief|mzee)$/;

/** A message that is only a greeting, an acknowledgement or a thank-you. */
export function smallTalkOnly(text: string) {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  if (!words.every(word => smallTalkWords.has(word))) return false;
  return words.some(word => greetingWord.test(word));
}

/** Answer in the same register the person used, then leave the door open. */
export function smallTalkReply(text: string, say: (sw: string, en: string) => string, last?: string) {
  const lower = text.toLowerCase();
  const base = (() => {
    if (/^(asante|shukran|thank you|thanks|thx)\b/.test(lower.trim())) {
      return say('Karibu sana!', 'You’re welcome!');
    }
    if (/\bshikamoo\b/.test(lower)) {
      return say('Marahaba! Karibu — niambie, nikusaidie nini leo?',
        'Hello! Welcome — tell me, what can I help you with today?');
    }
    if (/\b(poa|safi|fresh|nzuri)\b/.test(lower) && !/\b(mambo|vipi|habari)\b/.test(lower)) {
      return say('Vizuri! Karibu — niambie unahitaji nini.',
        'Good to hear! Welcome — tell me what you need.');
    }
    if (/\b(mambo|vipi|vpp|niaje|sup|yo|hi|hey|hello)\b/.test(lower)) {
      return say('Mambo! Poa sana, karibu. Niambie — nikusaidie nini leo?',
        'Hey! All good here. Tell me — what can I help you with today?');
    }
    if (/\b(habari|hujambo|salama|asubuhi|mchana|jioni|morning|afternoon|evening)\b/.test(lower)) {
      return say('Habari! Nzuri, asante. Karibu — nikusaidie nini leo?',
        'Hello! Very well, thanks. Welcome — what can I help you with today?');
    }
    if (/^(sawa|ok|okay|haya|ndio|yes)\b/.test(lower.trim())) {
      return say('Sawa! Nipo hapa — niambie unahitaji nini.',
        'Alright! I’m here — tell me what you need.');
    }
    return say('Karibu! Niambie — nikusaidie nini leo?',
      'Welcome! Tell me — what can I help you with today?');
  })();
  // A returning customer greets again weeks later; picking the thread up is what
  // makes the memory feel like a person rather than a database.
  const thanks = /^(asante|shukran|thank you|thanks|thx)\b/.test(lower.trim());
  return !last || thanks ? base
    : base + say(`\n\nTulikuwa tunaangalia ${last} — ungependa tuendelee na hiyo?`,
      `\n\nWe were looking at ${last} — would you like to continue with it?`);
}

/** What the customer said about their own site, kept between turns. */
export type CustomerProfile = { equipment?: string; budget?: string; useCase?: string };
export function customerProfile(text: string, previous: CustomerProfile | undefined) {
  const profile: CustomerProfile = { ...previous };
  for (const line of text.split(/\n+|(?<=[.!?])\s+/)) {
    const statement = line.trim();
    if (!statement || statement.endsWith('?')) continue;
    if (/\b(?:bajeti (?:yangu|yetu|ni|ya)|my budget|our budget|budget is)\b/i.test(statement) &&
        /\d/.test(statement)) profile.budget = statement.slice(0, 160);
    if (/\b(?:sasa natumia|natumia|tunatumia|ninatumia|nina|tuna|tayari nina|i have|we have|i use|we use)\b/i.test(statement) &&
        modelName.test(statement)) profile.equipment = statement.slice(0, 200);
    if (/\b(?:nataka|ninataka|tunahitaji|lengo langu|i want|we want|i need|we need)\b.*\b(?:hotspot|wifi|wi-fi|wageni|hotel|shule|biashara|guest|guests|school)\b/i.test(statement)) {
      profile.useCase = statement.slice(0, 200);
    }
  }
  return Object.keys(profile).length ? profile : undefined;
}

// Kiswahili and English markers. A bare model name carries neither, so the chat
// keeps the language it started in instead of flipping to English mid-order.
const swMarkers = /\b(naomba|nahitaji|ninahitaji|nataka|bei|gani|ngapi|tafadhali|asante|sawa|ndio|habari|mambo|vipi|je|kwa|ya|za|nini|wapi|lini|kwanini|niletee|nipe|niambie|nijibu|tafuta|ipo|zipo|haipo|hauna|mna|una|nina|sina|kama|lakini|bado|hii|hiyo|hizo|zile|wanangu|mimi|wewe|zote|yote|kifaa|bidhaa|pamoja|maelezo|sifa|hadi)\b/i;
// "details" and "specs" are typed by Kiswahili speakers too ("niambie details zote"),
// so they say nothing about the language. Only unambiguously English words do.
const enMarkers = /\b(the|please|how|what|which|where|when|price|cost|stock|available|need|want|does|can|could|would|thanks|thank|hello|hi|hey|are|your|more|other)\b/i;

/** The language the customer just wrote, when the message makes it obvious. */
export function messageLanguage(text: string): 'sw' | 'en' | undefined {
  const sw = swMarkers.test(text);
  const en = enMarkers.test(text);
  if (sw && !en) return 'sw';
  if (en && !sw) return 'en';
  return undefined;
}

export function adEnquiry(text: string) {
  return /\b(?:tangazo|advertisement|saw your ad|your ad|came from (?:facebook|instagram)|naomba maelezo zaidi|(?:i(?:'m| am) )?interested|more (?:info|information))\b/i.test(text);
}
