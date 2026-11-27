export type AdminSupportAction = { kind: 'resolved' | 'details' | 'reply'; text: string };

export function adminSupportAction(message: string): AdminSupportAction | undefined {
  const text = message.trim();
  const reply = /^(?:mjibu hivi|mwandikie(?: hivi)?|reply(?: with)?|send to customer)\b[\s:,.–—-]+([\s\S]+)$/i.exec(text);
  if (reply?.[1].trim()) return { kind: 'reply', text: reply[1].trim() };

  const details = /^(?:tunahitaji(?: taarifa(?: hizi)?)?|omba(?: taarifa(?: hizi)?)?|muulize|mwulize|need (?:the following )?(?:details|information)|ask(?: the customer)?)\b[\s:,.–—-]+([\s\S]+)$/i.exec(text);
  const detailRequest = details?.[1].trim();
  if (detailRequest && /[\p{L}\p{N}]/u.test(detailRequest) &&
      !/^(?:(?:taarifa|hizi|hayo|details|information|tafadhali|please)[\s:.,!?–—-]*)+$/i.test(detailRequest)) {
    return { kind: 'details', text: detailRequest };
  }

  const resolved = /^(?:tatizo limetatuliwa|shida imeisha|tume\s*sha\s*(?:solve(?:na)?|fix|tatua|rekebisha)|tume\s*(?:fix|solve(?:na)?|tatua|rekebisha)|imetatuliwa|imefungwa|resolved|fixed|we (?:have )?fixed)\b[\s:,.–—-]*([\s\S]*)$/i.exec(text);
  if (resolved && !text.endsWith('?') && !/\b(?:bado|haijaisha|not yet|pending)\b/i.test(resolved[1])) {
    const detail = resolved[1].trim();
    return { kind: 'resolved', text: /^(?:(?:hii|hilo|hiyo) )?(?:shida|tatizo)(?: (?:hii|hili|hiyo|ya mteja|la mteja)){0,2}[.! ]*$/i.test(detail) ? '' : detail };
  }
}

// A price, availability or photo request is a new commercial question, even
// when the customer omits the question mark while answering a support case.
export function asksNewCommercialQuestion(text: string) {
  return /\b(?:bei|price|gharama|cost)\s+(?:ya|za|yake|gani|ngapi|of|for)\b|\b(?:how much|do you have|in stock|ipo stock|stock ipo)\b|\b(?:naomba|nataka|nahitaji|i want to)\s+(?:kununua|kuagiza|buy|order|picha|photos?)\b|\b(?:naomba|nitumie|nioneshe|nionyeshe|send|show)\s+(?:the\s+|a\s+)?(?:picha|photos?|images?)\b/i.test(text);
}
