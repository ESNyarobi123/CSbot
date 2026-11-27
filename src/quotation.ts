import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { log } from './db.js';
import { documentJson, isModelReference, modelQuery, money, readProduct, requestedBrand, searchProducts } from './pos.js';
import { installationQuote, type OrderPreview } from './installation-quote.js';
import type { Conversation } from './store.js';

export const quotationWords = /\b(?:invoice|ankara|pro[ -]?forma|quotation|nukuu ya bei)\b/i;
const writtenCounts: Record<string, number> = {
  moja: 1, mbili: 2, viwili: 2, tatu: 3, vitatu: 3, nne: 4, vinne: 4, tano: 5, vitano: 5,
  sita: 6, saba: 7, nane: 8, vinane: 8, tisa: 9, kumi: 10,
};
const countPattern = String.raw`(\d+|${Object.keys(writtenCounts).join('|')})`;
const units = '(?:pcs?|pieces?|units?|vifaa|vipande)';
const unitCount = new RegExp(String.raw`\b(?:${countPattern}\s*${units}|${units}\s*${countPattern})\b`, 'gi');
const quantityOnly = new RegExp(String.raw`^(?:(?:idadi|jumla|quantity)\s+)?${countPattern}[.! ]*$`, 'i');
const modelIdentity = /\b(?:eap|er|rb|rap|wr|cf|ax|h[ae]p)[- ]?\d{1,5}[a-z0-9-]*\b/gi;
const normalizeModel = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
const existingInvoice = /\b(?:INV[- ]?\d+|invoice yangu|ankara yangu|my invoice|resend.{0,20}invoice)\b/i;
const combineItems = /\b(?:pamoja na|and|plus|na)\s+(?:(?:\d+|moja|mbili|tatu)\s+)?(?:router|switch|access point|waya|cable|installation|ufungaji|cudy|mikrotik|omada|tp[ -]?link|comfast|eap\s*\d)\b|\+/i;

export type DocumentRequest = {
  kind: 'invoice' | 'quote';
  product?: NonNullable<Conversation['memory']['product']>;
  quantity?: number;
  order?: OrderPreview;
  resumeAfterPlan?: true;
};

const confirmOrder = /^(?:(?:ndio|ndiyo|naam|yes|confirmed|thibitisha)|(?:sawa|ok|okay)(?:[, ]+(?:tuma|nitumie|endelea|send it))?|(?:tuma|nitumie|endelea|send it)(?:\s+(?:invoice|ankara|proforma))?)[.! ]*$/i;
type Say = (sw: string, en: string) => string;

function orderSummary(order: OrderPreview, say: Say) {
  const format = (amount: number) => money({ amount, currency: order.currency });
  const list = order.lines.map(line => {
    const label = line.role === 'installation' ? say('Ufungaji', 'Installation') :
      line.role === 'cable' ? say(`${line.name}, mita ${line.quantity}`, `${line.name}, ${line.quantity} m`)
        : `${line.name} × ${line.quantity}`;
    return `• ${label} — ${format(line.unitPrice * line.quantity)}`;
  });
  const plan = order.plan;
  if (plan) {
    const cycle = /month/i.test(plan.cycle) ? say('/mwezi', '/month') :
      /year|annual/i.test(plan.cycle) ? say('/mwaka', '/year') : plan.cycle ? ' / ' + plan.cycle : '';
    list.push(`• ${plan.name} — ${format(plan.amount)}${cycle}`);
    if (plan.setup) list.push(say(`• Ada ya kuanza — ${format(plan.setup)}`, `• Setup fee — ${format(plan.setup)}`));
  }
  const total = order.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) +
    (plan?.amount ?? 0) + (plan?.setup ?? 0);
  return [...list, say(`*Jumla ya kuanza* ${format(total)}`, `*Initial total* ${format(total)}`)].join('\n');
}

async function proformaTurn(
  text: string, memory: Conversation['memory'], requestKey: string | undefined, say: Say, priorPlanChoice?: string,
) {
  const product = memory.product;
  const quote = memory.installationQuote;
  const pending = memory.documentRequest;
  const confirmed = Boolean(pending?.order && confirmOrder.test(text.trim()));
  const explicit = quotationWords.test(text) && !existingInvoice.test(text);
  if (!product || !quote || quote.productId !== product.id || (!confirmed && !explicit)) return;
  // New items or requests to modify an order must never issue a previous draft.
  const mentioned = [...text.matchAll(modelIdentity)].map(item => normalizeModel(item[0]));
  if (mentioned.some(model => !normalizeModel(product.name).includes(model)) || /\bsku\b/i.test(text) ||
    (!confirmed && (combineItems.test(text) || [...text.matchAll(unitCount)].length))) return;
  const kind = pending?.order ? pending.kind : 'invoice';
  const handoff = () => {
    delete memory.documentRequest;
    memory.documentSummary = memory.lastDocument = pending?.order ? orderSummary(pending.order, say) : product.name;
    return { body: say('Nimepeleka oda kwa timu ya mauzo ithibitishe bei na ikutumie PDF hapa.',
      'I’ve shared your order with sales so they can confirm the prices and send your PDF here.'),
    handoff: true, alertTitle: 'Proforma inahitaji ukaguzi' };
  };
  try {
    const { product: fresh, stock } = await readProduct(product.id);
    let order: OrderPreview;
    if (quote.fitting || quote.supply || quote.wantsPlan) {
      if (quote.supply === 'shop' && stock.available_to_sell < (quote.quantity ?? 1)) return handoff();
      const answer = await installationQuote(fresh, priorPlanChoice && !quote.planName ? priorPlanChoice : text, say, quote);
      if (!quote.order) {
        delete memory.documentRequest;
        if (!quote.awaiting) return handoff();
        if (quote.awaiting === 'plan') memory.documentRequest = { kind, resumeAfterPlan: true };
        return { body: answer };
      }
      order = quote.order;
    } else {
      const quantity = quote.quantity ?? 1;
      if (quote.wantsCable || quote.cableMeters || fresh.type !== 'Stocked' || stock.available_to_sell < quantity) return handoff();
      order = { currency: fresh.price.currency,
        lines: [{ productId: fresh.id, name: fresh.name, quantity, unitPrice: fresh.price.amount, role: 'device' }] };
    }
    const summary = orderSummary(order, say);
    // PostgreSQL JSONB can reorder object keys when a new turn reads memory.
    const comparable = ({ currency, lines, plan }: OrderPreview) => JSON.stringify([currency,
      lines.map(({ productId, name, quantity, unitPrice, role }) =>
        [productId, role === 'installation' ? '' : name, quantity, unitPrice, role]),
      plan && [plan.name, plan.cycle, plan.amount, plan.setup]]);
    if (!confirmed || comparable(pending!.order!) !== comparable(order)) {
      memory.documentRequest = { kind, order };
      return { body: [
        confirmed ? say('Bei au vipengele vya oda vimebadilika. Hii ndiyo oda ya sasa.',
          'The prices or items have changed. Here is the updated order.')
          : say('Hii ndiyo oda uliyotaka niweke kwenye proforma?', 'Is this the order you want on your proforma?'),
        summary, say('Ukithibitisha kwa kuandika *Ndiyo*, nitakutumia PDF hapa.',
          'Reply *Yes* to confirm and I’ll send the PDF here.'),
      ].join('\n\n') };
    }
    if (!requestKey) {
      delete memory.documentRequest;
      return { body: say('Oda imethibitishwa. Kwenye WhatsApp, nitakutumia PDF hapa.',
        'Order confirmed. In WhatsApp, the PDF will be sent here.') };
    }
    const { CSOLUTION_QUOTATION_URL: url, CSOLUTION_QUOTATION_TOKEN: token } = config;
    if (!url || !token) return handoff();
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'proforma', requestId: quotationId(requestKey),
        items: order.lines.map(({ productId, quantity, unitPrice, role }) => ({ productId, quantity, unitPrice, role })),
        currency: order.currency, plan: order.plan }),
    });
    const payload = z.object({ number: z.string().regex(/^PF-[A-F0-9]{20}$/),
      pdf: z.string().base64() }).parse(await documentJson(response));
    const bytes = Buffer.from(payload.pdf, 'base64');
    if (bytes.length < 10 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid proforma PDF');
    delete memory.documentRequest;
    memory.documentSummary = memory.lastDocument = `${payload.number}\n${summary}`;
    return { body: say(`Nimekuandalia proforma ${payload.number}. Unaweza kuangalia vipengele na jumla kwenye PDF hii.`,
      `Here is proforma ${payload.number}. The PDF has a breakdown of the items and total.`),
    document: { name: `Proforma-${payload.number}.pdf`, bytes } };
  } catch (error) {
    log.warn({ code: (error as Error).name }, 'CSolution proforma could not be prepared');
    return handoff();
  }
}

function quotationId(requestKey: string) {
  const id = createHash('sha256').update('csbot-quotation:' + requestKey).digest('hex');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-8${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
}

export async function quotationTurn(
  text: string, memory: Conversation['memory'], requestKey: string | undefined,
  say: Say, priorPlanChoice?: string,
) {
  const explicit = quotationWords.test(text);
  const pending = memory.documentRequest;
  if (!explicit && !pending) return;
  if (!explicit && pending?.resumeAfterPlan) return;
  const proforma = await proformaTurn(text, memory, requestKey, say, priorPlanChoice);
  if (proforma) return proforma;
  if (!explicit && pending?.order) return;
  const counts = [...text.matchAll(unitCount)];
  const bare = pending && quantityOnly.exec(text.trim())?.[1];
  const count = (counts[0]?.[1] ?? counts[0]?.[2] ?? bare ?? '').toLowerCase();
  const quantity = count ? writtenCounts[count] ?? Number(count) : pending?.quantity;
  const itemText = text.replace(unitCount, ' ').replace(quotationWords, ' ');
  const model = bare ? '' : modelQuery(itemText);
  const sku = /\bsku\s*[:#]?\s*([A-Z0-9][A-Z0-9._-]{1,49})\b/i.exec(itemText)?.[1];
  const brand = requestedBrand(itemText);
  if (!explicit && !bare && !counts.length && !sku && (!model || !isModelReference(itemText))) return;

  const kind = explicit
    ? (/\b(?:quotation|nukuu ya bei|pro[ -]?forma)\b/i.test(text) ? 'quote' : 'invoice')
    : pending!.kind;
  const draft: DocumentRequest = { kind, quantity: Number.isInteger(quantity) && quantity! > 0 && quantity! <= 500 ? quantity : undefined };
  delete memory.documentRequest;
  delete memory.documentSummary;

  const handoff = (body: string, details: string) => {
    memory.documentSummary = memory.lastDocument = details;
    return { body, handoff: true, alertTitle: kind === 'invoice' ? 'Ombi la invoice ya mauzo' : 'Quotation inahitaji ukaguzi' };
  };
  if (kind === 'invoice' && existingInvoice.test(text)) {
    return handoff(say('Timu ya mauzo itathibitisha oda husika kwenye POS na kukutumia invoice hapa.',
      'Sales will verify the order in the POS and send your invoice here.'), text.slice(0, 500));
  }
  const namedModels = [...itemText.matchAll(modelIdentity)];
  if (combineItems.test(text) || namedModels.length > 1 || counts.length > 1 || /\b(?:subscription|package|kifurushi|leseni|VAT|TIN|tax|kodi|discount|punguzo)\b/i.test(text)) {
    return handoff(say('Nimepeleka orodha yako kwa timu ya mauzo ili ikague vipengele kabla ya kuandaa hati.',
      'I’ve sent your request to sales so they can review each item before preparing the document.'), text.slice(0, 500));
  }

  const exactModel = namedModels.length ? normalizeModel(namedModels[0][0]) : undefined;
  const placement = /\b(?:outdoor|indoor|wall[ -]?plate)\b/i.exec(itemText)?.[0].toLowerCase().replace(/[^a-z]/g, '');
  if (model || sku) {
    // Resolve only a unique model. Catalog ranking is useful for suggestions, but
    // never selects a product on behalf of the customer for an official quote.
    try {
      const { items } = await searchProducts(sku ?? [brand && itemText.match(brand)?.[0], model].filter(Boolean).join(' '), 12);
      const key = model.replace(/\s/g, '');
      const matches = items.filter(item => {
        if (item.type !== 'Stocked') return false;
        if (sku) return item.sku?.toLowerCase() === sku.toLowerCase();
        const labels = [item.name, item.sku].filter((label): label is string => Boolean(label));
        return (!placement || item.name.toLowerCase().replace(/[^a-z]/g, '').includes(placement)) &&
          labels.some(label => modelQuery(label).replace(/\s/g, '') === key &&
            (!exactModel || [...label.matchAll(modelIdentity)].some(match => normalizeModel(match[0]) === exactModel)));
      });
      if (matches.length === 1) draft.product = { id: matches[0].id, name: matches[0].name };
    } catch (error) {
      log.warn({ code: (error as Error).name }, 'POS unavailable during quotation lookup');
      return handoff(say('Nimepeleka ombi lako kwa timu ya mauzo ili ithibitishe bidhaa na bei kwenye POS.',
        'I’ve passed your request to sales so they can verify the product and price in the POS.'), text.slice(0, 500));
    }
  } else if (!brand) {
    draft.product = pending?.product;
    if (!draft.product && /\b(?:hiyo|ile|hicho|hiki|that one|this one)\b/i.test(text) && memory.quoteFor === 'product') {
      draft.product = memory.product;
    }
  }

  memory.documentRequest = draft;
  if (!draft.product) return { body: say('Niambie brand na modeli ya kifaa, au SKU yake, ili hati iwe ya bidhaa sahihi.',
    'Which brand and model or SKU should appear on the document?') };
  if (!draft.quantity) return { body: say(`Unahitaji ${draft.product.name} ngapi?`, `How many units of ${draft.product.name} do you need?`) };
  delete memory.documentRequest;
  const details = `${draft.product.name} × ${draft.quantity}`;
  if (kind === 'invoice') {
    return handoff(say(`Nimepeleka ombi la invoice ya ${details} kwa timu ya mauzo. Watathibitisha maelezo ya mnunuzi na oda kwenye POS, kisha watakutumia invoice hapa.`,
      `I’ve sent your invoice request for ${details} to sales. They’ll verify the buyer and order in the POS and send your invoice here.`), details);
  }

  const { CSOLUTION_QUOTATION_URL: url, CSOLUTION_QUOTATION_TOKEN: token } = config;
  if (url && token && requestKey) {
    const requestId = quotationId(requestKey);
    try {
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4500),
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, productId: draft.product.id, quantity: draft.quantity }),
      });
      const quote = z.object({
        number: z.string().regex(/^QT-\d+$/), name: z.string().min(1), quantity: z.literal(draft.quantity),
        amount: z.number().int().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/),
      }).parse(await documentJson(response));
      memory.product = draft.product;
      memory.posQuotation = { number: quote.number, productId: draft.product.id, quantity: quote.quantity };
      memory.quoteFor = 'product';
      memory.lastQuote = `${quote.number} · ${quote.name} × ${quote.quantity} · ${money(quote)}`;
      memory.documentSummary = memory.lastDocument = memory.lastQuote;
      return { body: say(`Quotation ya Connect Solution ${quote.number}\n${quote.name} × ${quote.quantity}\nJumla ${money(quote)}\n\nUkitaka kuendelea na oda, niambie nikupatie hatua inayofuata.`,
        `Connect Solution quotation ${quote.number}\n${quote.name} × ${quote.quantity}\nTotal ${money(quote)}\n\nReply here when you’re ready to order.`),
      stage: 'quoted' as const, notify: true, alertTitle: 'Quotation imetengenezwa kwenye POS' };
    } catch (error) {
      log.warn({ code: (error as Error).name }, 'POS quotation could not be confirmed');
    }
  }
  return handoff(say(`Timu ya mauzo itakagua bei na stock ya ${details} na kukutumia quotation hapa.`,
    `Sales will check the price and stock for ${details} and send the quotation here.`), details);
}
