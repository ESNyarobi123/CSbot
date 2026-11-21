import type { Conversation } from './store.js';

const business = /\b(?:wotefy|lubfy|mfumo|billing|router|wifi|wi-fi|access point|hotspot|internet|intaneti|wireless|kuunganisha|umbali|kilomit\w*|mikrotik|microtick|microtik|omada|mesh(?:ing)?|installation|ufungaji|katalogi|mtandao|kifaa|kusajiliwa|stock|bei|price|catalog|subscription|vifurushi|kifurushi|packages?|kujiunga|kusajili|signup|sign up|register|portal|ssid|voucher|vifaa|sku|ofisi(?:ni)?|opening hours|malipo|nimelipa|kulipia|paid|payment|order|mhudumu|cudy|ruijie|reyee|comfast|faida|mapato|profit|income|revenue|biashara|business)\b|\b(?:eap|rap|wr|rb|ax|ap)[ -]?\d{2,5}\b/i;
/**
 * "Mko wapi?" is a customer asking where the shop is, and it used to be judged
 * as idle chatter because it names no product.
 */
const placeAsk = /\b(?:mko|mupo|upo|uko|mnapatikana|unapatikana|mnaishi|unaishi|ofisi|duka|address|anwani|location|mahali)\b[^.?!]*\b(?:wapi|lini)\b|\b(?:ofisi\w*|duka)\s*(?:yenu|yako|zenu|zako|kwenu|kwako)\b/i;
const unrelated = /\b(?:game|gme|mpira|football|birthday|familia|family|chakula|dinner|lunch)\b/i;
const detail = /\b(?:ap|eap|eneo|mita|meters?|metres?|km|kilomet\w*|wazi|nje|ndani|ukuta|kuta|miti|indoor|outdoor|users?|watumiaji|wateja|bajeti|budget|modeli?|models?|zingine|nyingine|nyengine|hii|hiyo|hiki|ile|kwenu|mnayo|ileile|same|picha|email|imeli|kifaa|navifaa|tatizo|shida|haifunguki|nje|ukumbini|jengo|majengo|shuleni|subscription|month|mwezi)\b/i;
const bareLocation = /^(?:nipo|niko|tupo|i(?:’m|'m| am) in)\s+[\p{L} -]{2,48}[.! ]*$/iu;
const salutation = /^(?:kaka|dada|mkuu|boss|bro|brother|chief|mzee|mambo|habari|vipi|sasa|hello|hi|hey|shikamoo|salama|poa|safi|nzuri|asante|thanks|sawa|ok)(?:[ ,]+(?:yako|yenu|zenu|za|tu|je|sana|basi|aisee|dah|there|kaka|dada|mkuu|boss|bro|ndugu|vipi|mambo|habari|poa|safi|nzuri|salama))*[.!? ]*$/i;

// "Tatizo" or "shida" on its own is the customer telling us why they came. The
// old gate treated it as a bare word and said nothing at all.
const trouble = /\b(?:tatizo|matatizo|shida|problem|support|msaada|imesimama|imekwama|haifunguki|haifanyi kazi|haifanyi|imekataa|error|imefeli|failed|offline|haionekani)\b/i;
const emailOnly = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function replyEligible(text: string, memory: Conversation['memory'], history: { direction: string; body: string }[], photo: boolean) {
  const value = text.trim();
  if (unrelated.test(value) && !/\b(?:router|hotspot|wi-fi|wifi|portal|wotefy|lubfy|internet)\b/i.test(value)) return false;
  if (salutation.test(value)) {
    // A greeting is worth one warm answer on first contact — that is how a new
    // customer is invited to say what they need. Repeating it later is silence,
    // not another "which system?".
    const firstContact = history.every(line => line.direction !== 'outbound');
    return firstContact && !memory.support && !memory.product && !memory.plan && !memory.planning;
  }
  // An address is never idle chatter; it is someone asking to be helped.
  if (memory.survey && /^(?:ni |kwenye |eneo la |ni eneo la )?(?:hosteli?|soko(?:ni)?|makazi|nyumba|shule|hoteli|hostels?|market|school|hotel)[.! ]*$/i.test(value)) return true;
  if (memory.survey?.waitingFor === 'users' && /\b\d{1,5}\b/.test(value) && value.split(/\s+/).length <= 5) return true;
  if (emailOnly.test(value)) return true;
  if (placeAsk.test(value)) return true;
  if (business.test(value) || trouble.test(value)
    || /\b(nataka mtu|need a human|talk to an agent|ready to pay|namba ya kulipia)\b/i.test(value)) return true;
  if (photo && /\b(?:kwenu|mnayo|mnauza|inapatikana|stock|sell|available|cost|price)\b/i.test(value)) return true;
  const lastReply = history.filter(line => line.direction === 'outbound').at(-1)?.body || '';
  if (bareLocation.test(value)) return /\b(?:mkoa|mji|city|delivery|usafirishaji|location|uko wapi)\b/i.test(lastReply) && business.test(lastReply);
  if (/\b(?:naweza|na weza|can i) (?:ku)?(?:pata|get) (?:hii|hiyo|this|that)|\b(?:mnayo|mnauza) (?:hii|hiyo)/i.test(value)) return true;
  if (memory.support && (memory.support.problem || memory.support.waitingFor)) {
    return detail.test(value) || emailOnly.test(value) ||
      (memory.support.waitingFor === 'problem' && /\b(?:ina|hai|ime|ume|error|failed|screen|ukurasa|login|offline)/i.test(value));
  }
  const active = !!(memory.product || memory.productOptions?.length || memory.plan || memory.planning || memory.onboarding || memory.requirements || business.test(lastReply));
  // After a quote, "na 610 je?" is a follow-up on a model, not idle chatter. A
  // bare number is only read this way in a short message, so a long sentence
  // that happens to contain a figure is still judged on its words.
  const shortModelFollowUp = value.split(/\s+/).length <= 6 && /\b\d{2,4}\b/.test(value);
  if (active && (detail.test(value) || shortModelFollowUp
      || /^(?:ndio|ndiyo|yes|hapo|ya (?:kwanza|pili)|\d{1,4})[.! ]*$/i.test(value)
      || (photo && /image|photo|picha/i.test(value)))) return true;
  return /\b(?:how much|naomba msaada|nahitaji msaada|need help with my|namba ya mauzo|niko tayari kulipa|i.ll take it|naichukua)\b/i.test(value);
}
