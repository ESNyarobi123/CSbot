import { cableQuote, installationOptions, money, readPlans, type systemName } from './pos.js';
import { systemFrom, systemLabel } from './customer-text.js';

type Say = (sw: string, en: string) => string;
type System = typeof systemName.options[number];
type Price = { amount: number; currency: string };
type Device = { name: string; category?: string | null; type?: string; price: Price };
type QuoteProgress = 'supply' | 'cable' | 'system' | 'plan';

export interface InstallationQuoteContext {
  productId?: string;
  quantity?: number;
  cableMeters?: number;
  wantsCable?: boolean;
  supply?: 'shop' | 'customer';
  wantsPlan?: boolean;
  system?: System;
  awaiting?: QuoteProgress;
  planNames?: string[];
}

export const installationWords = /\b(installation|instalation|installationi|install|kufunga|kufungwa|kufungia|kusanikisha|kusanikua|kusanikwa|kuweka mfumo|kuniwekea|kutuwekea|kukuwekea|setup|kuset|ufungaji)\b/i;
export const cableWords = /\b(waya|cable|kebo|nyaya)\b/i;

export function cableMeters(text: string) {
  const match = /\b(?:mita|mtr|metres?|meters?)\s*(\d{1,3})\b/i.exec(text)
    ?? /\b(\d{1,3})\s*(?:mita|mtr|metres?|meters?)\b/i.exec(text)
    ?? /\b(\d{1,3})\s*m\b/i.exec(text);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 && value <= 300 ? value : undefined;
}

export function quoteSupply(text: string) {
  if (/^(?:kwenu|kwako|from you|nitachukua kwenu)[.! ]*$/i.test(text.trim())) return 'shop';
  if (/^(?:tayari ninavyo|tayari ninacho|nayo tayari|ninavyo|i already have it)[.! ]*$/i.test(text.trim())) return 'customer';
  if (/\b(?:nina|nimesha(?:nunua|pata)|nilishanunua|tayari nina|nayo tayari)\b.{0,30}\b(?:kifaa|vifaa|router|access point|ap|eap|mikrotik)\b|\b(?:kifaa changu|kifaa chetu|vifaa vyangu|vifaa vyetu|chenyewe ninacho|already (?:have|own)|own equipment)\b/i.test(text) &&
      !/\b(?:niki|nita|tuta|na)?nunua\b.{0,24}\b(?:kwenu|kwako|from you)\b/i.test(text)) return 'customer';
  if (/\b(?:niki|nita|tuta|na|ku)?nunua\b.{0,24}\b(?:kwenu|kwako|from you)\b|\b(?:(?:kifaa|vifaa) kutoka kwenu|vifaa vyenu|kifaa chenu|buy(?:ing)?(?: the .{0,24})? from you|purchase from you|nikichukua (?:vifaa )?kwenu|kifaa ni cha dukani|kwenu tu)\b/i.test(text)) return 'shop';
  return undefined;
}

export function asksSubscriptionInQuote(text: string) {
  return /\b(?:mfumo|system|subscription|billing|wotefy|lubfy)\b/i.test(text) &&
    /\b(?:kulipia|kulipa|nalipia|nitalipia|malipo|ada|usajili|subscription|kwa mwezi|kwa mwaka|mara ya kwanza|first time|first payment|pay|bei ya (?:mfumo|wotefy|lubfy))\b/i.test(text);
}

export function updateInstallationQuote(context: InstallationQuoteContext, text: string) {
  const length = cableMeters(text);
  const noCable = /\b(?:bila|sitaki|sihitaji|without|no need for)\s+(?:waya|nyaya|cables?)\b/i.test(text);
  return {
    ...context,
    supply: quoteSupply(text) ?? context.supply,
    wantsCable: !noCable && (context.wantsCable || cableWords.test(text) || Boolean(length)),
    cableMeters: noCable ? undefined : (length ?? context.cableMeters),
    wantsPlan: context.wantsPlan || asksSubscriptionInQuote(text),
    system: systemFrom(text) || context.system,
  };
}

export function followsInstallationQuote(text: string, context?: InstallationQuoteContext) {
  if (!context?.awaiting) return false;
  if (context.awaiting === 'cable') return Boolean(cableMeters(text)) && !/\b(?:coverage|range|umbali wa wifi)\b/i.test(text);
  if (context.awaiting === 'supply') return text.trim().split(/\s+/).length <= 9 && Boolean(quoteSupply(text));
  if (context.awaiting === 'system') {
    return Boolean(systemFrom(text)) && text.trim().split(/\s+/).length <= 7
      || Boolean(context.system) && /^(?:ndio|ndiyo|sawa|naam|yes|endelea|go ahead)[.! ]*$/i.test(text.trim());
  }
  return context.planNames?.some(name => text.toLowerCase().includes(name.toLowerCase())) ?? false;
}

export async function installationQuote(product: Device, text: string, say: Say, details: InstallationQuoteContext) {
  delete details.awaiting;
  const cable = details.wantsCable && details.cableMeters
    ? await cableQuote(details.cableMeters).catch(() => undefined) : undefined;
  const cableLine = cable && say(
    `• Waya ${cable.product.name}, mita ${cable.meters} × ${money(cable.product.price)} = ${money(cable)}`,
    `• ${cable.product.name} cable, ${cable.meters} m × ${money(cable.product.price)} = ${money(cable)}`,
  );
  if (!details.supply) {
    details.awaiting = 'supply';
    const ask = say('Vifaa utavinunua kwetu au tayari unavyo? Hilo ndilo huamua gharama ya ufungaji.',
      'Will you buy the equipment from us, or do you already have it? That determines the fitting fee.');
    return [cableLine, ask].filter(Boolean).join('\n\n');
  }

  const rates = await installationOptions(product).catch(() => undefined);
  const matching = rates?.options.filter(option => option.withOurEquipment === (details.supply === 'shop')) ?? [];
  if (matching.length !== 1) {
    return say(`Timu itathibitisha gharama ya kufunga ${product.name} kwa mpangilio huu.`,
      `Our team will verify the fitting fee for ${product.name} for this setup.`);
  }
  const [rate] = matching;
  const quantity = details.quantity ?? 1;
  const equipmentCost = details.supply === 'shop' ? product.price.amount * quantity : 0;
  const fee = { amount: rate.fee, currency: rate.currency };
  const lines = [
    details.supply === 'shop' && `• ${product.name}, ${quantity} × ${money(product.price)} = ${money({ amount: equipmentCost, currency: product.price.currency })}`,
    say(`• Ufungaji ${money(fee)} kwa kazi`, `• Fitting ${money(fee)} per job`),
    cableLine,
  ].filter(Boolean);
  if ((details.supply === 'shop' && rate.currency !== product.price.currency) || (cable && cable.currency !== rate.currency)) {
    return [...lines, say('Bei hizi ziko kwenye sarafu tofauti. Timu itathibitisha jumla utakayolipa.',
      'These lines use different currencies. Our team will verify your final total.')].join('\n');
  }
  const subtotal = equipmentCost + rate.fee + (cable?.amount ?? 0);
  const total = (amount: number) => money({ amount, currency: rate.currency });
  if (details.wantsCable && !cable) {
    if (!details.cableMeters) details.awaiting = 'cable';
    return [...lines,
      say(`Jumla kabla ya waya ni ${total(subtotal)}.`, `The subtotal before cable is ${total(subtotal)}.`),
      details.cableMeters
        ? say('Bei ya waya haikupatikana kwa sasa. Timu itathibitisha gharama yake.', 'We couldn’t retrieve the cable price. Our team will verify it.')
        : say('Utahitaji waya wa mita ngapi?', 'How many metres of cable do you need?'),
    ].join('\n');
  }
  if (!details.wantsPlan) {
    return [...lines, say(`*Jumla* ${total(subtotal)}`, `*Total* ${total(subtotal)}`)].join('\n');
  }

  const partial = say(`*Jumla kabla ya ada ya mfumo* ${total(subtotal)}`, `*Subtotal before subscription* ${total(subtotal)}`);
  if (!details.system) {
    details.awaiting = 'system';
    return [...lines, partial, '', say('Unachagua WoteFy au LubFy? Nikijua mfumo, nitakagua ada ya mpango kutoka kwenye mfumo huo.',
      'Are you choosing WoteFy or LubFy? I can check its current subscription price.')].join('\n');
  }
  const system = systemLabel(details.system);
  const plans = (await readPlans(details.system, 'subscription').catch(() => undefined))?.items ?? [];
  const priced = plans.filter(plan => plan.price && plan.price.currency === rate.currency &&
    (!plan.setup_fee || plan.setup_fee.currency === rate.currency));
  if (!priced.length) {
    return [...lines, partial, '', say(`Timu itathibitisha ada ya ${system} kabla ya kukupa jumla kamili.`,
      `Our team will verify the ${system} subscription price before confirming the full total.`)].join('\n');
  }
  const selected = priced.filter(plan => text.toLowerCase().includes(plan.name.toLowerCase()));
  const show = (selected.length ? selected : priced).slice(0, 4);
  if (show.length > 1) {
    details.awaiting = 'plan';
    details.planNames = show.map(plan => plan.name);
  }
  return [
    ...lines, partial, '', `*${system}*`,
    ...show.map(plan => {
      const rate = plan.price!;
      const cycle = plan.billing_period ?? '';
      const interval = /month|mwezi/i.test(cycle) ? say('kwa mwezi', 'monthly')
        : /year|annual|mwaka/i.test(cycle) ? say('kwa mwaka', 'yearly') : cycle;
      const period = interval ? ` (${interval})` : '';
      const setup = plan.setup_fee ? say(` + ada ya kuanza ${money(plan.setup_fee)}`, ` + setup fee ${money(plan.setup_fee)}`) : '';
      return `• ${plan.name} ${money(rate)}${period}${setup} → ${say('pamoja na oda', 'with your order')} ${total(subtotal + rate.amount + (plan.setup_fee?.amount ?? 0))}`;
    }),
    ...(show.length > 1 ? [say('Unachagua mpango upi?', 'Which plan would you like?')] : []),
  ].join('\n');
}
