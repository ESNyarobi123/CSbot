import { smallTalkOnly } from './customer-text.js';
import { pendingVoice } from './voice.js';

const unrelated = /\b(?:game|gme|mpira|football|birthday|familia|family|chakula|dinner|lunch)\b/i;
const domain = /\b(?:router|hotspot|wi-?fi|portal|wotefy|lubfy|internet|intaneti|switch|access point|omada|mikrotik)\b/i;

export function unrelatedChat(text: string) {
  return unrelated.test(text) && !domain.test(text);
}

const salutation = /^(?:kaka|dada|mkuu|boss|bro|brother|chief|mzee|mambo|habari|vipi|sasa|hello|hi|hey|shikamoo|salama|poa|safi|nzuri|asante|thanks|sawa|ok)(?:[ ,]+(?:yako|yenu|zenu|za|tu|je|sana|basi|aisee|dah|there|kaka|dada|mkuu|boss|bro|ndugu|vipi|mambo|habari|poa|safi|nzuri|salama))*[.!? ]*$/i;

export interface ReplyHistoryLine {
  direction: 'inbound' | 'outbound';
  body: string;
}

const opening = /^(?:kaka|dada|mkuu|boss|bro|brother|chief|mzee|mambo+|habari|vipi|vpp|niaje|hujambo|sijambo|sasa|hello+|hi+|hey+|yo|sup|shikamoo|salama|asubuhi|mchana|jioni|(?:good )?(?:morning|afternoon|evening))\b/i;

export function openingGreeting(text: string) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.every(line => salutation.test(line) || smallTalkOnly(line))) return;
  return lines.find(line => opening.test(line));
}

export function replyEligible(text: string, photo: boolean) {
  const value = text.trim();
  return photo || (value.length > 0 && !pendingVoice(value));
}
