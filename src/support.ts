import { emailOf, emailPattern, smallTalkOnly, supportQuestion, symptomOf, systemFrom, systemLabel } from './customer-text.js';
import type { Conversation } from './store.js';

type Intake = NonNullable<Conversation['memory']['support']>;
type Say = (sw: string, en: string) => string;

const vagueReport = /^(?:(?:kaka|mkuu|boss|bro|dada|tafadhali)\s+)*(?:(?:nina|niko na|kuna|nimepata|naomba|i have|there is|i need)\s+)?(?:shida|tatizo|matatizo|problem|an? issue|support|msaada)(?:\s+(?:ya|la|kwenye|na|katika|with|on|in)\s+(?:(?:the|my|our)\s+)?(?:mfumo|akaunti|system|account)(?:\s+(?:wangu|wetu|wenu|huu|yangu|hii))?)?(?:\s+(?:kaka|mkuu|boss|bro|dada|tafadhali))*$/i;
const multipleDevices = /^(?:(?:nina|niko na|na|natumia|I have|I use)\s*)?(?:vifaa|devices)\s+(?:viwili|vitatu|vingi|mbili|tatu|\d+)(?:\s+(?:tu|mkuu|kaka))?$|^(?:I have\s+)?(?:two|three|several|multiple|\d+) devices$/i;
const sameAccountEmail = /^(?:email|imeli|barua pepe)(?:\s+(?:yangu|yang))?\s+(?:(?:ni|ndo|ndio|ndiyo)\s+)?(?:ile ile|ileile|hiyo hiyo)\b|\b(?:same email|usual email)\b|^(?:(?:ni|ndo|ndio|ndiyo)\s+)?(?:ile ile|ileile|hiyo hiyo)(?:\s+(?:mkuu|kaka))?$/i;
const noSystemName = /\b(?:sijui (?:ni )?(?:mfumo|upi|gani)|sikumbuki (?:mfumo|jina)|not sure which|don.t know (?:which|the system))\b/i;

/** Start with what went wrong. An email helps account-specific checks and remains optional. */
export function supportIntake(text: string, support: Intake, say: Say): { support: Intake; reply?: string; ready: boolean } {
  const next = { ...support };
  const email = emailOf(text);
  if (email) next.email = email;
  const detectedSystem = systemFrom(text);
  if (detectedSystem) next.system = detectedSystem;
  const rest = text.replace(emailPattern, ' ')
    .replace(/\b(?:wote[ -]?fy|ss[ -]?domada|lub[ -]?fy)\b/gi, ' ')
    .replace(/[\s.,!?;:]+/g, ' ').trim();
  const repeatsEmail = sameAccountEmail.test(text.trim());
  if (repeatsEmail) next.sameEmail = true;
  const vague = (input: string) => vagueReport.test(input.trim().replace(/\s+(?:kwenye|katika|with|on|in|wa)$/i, ''));
  if (next.problem && (vague(next.problem) || /^(?:[mn]ipo|niko)\s+\S+/i.test(next.problem))) delete next.problem;
  const contextOnly = !rest || vague(rest) || smallTalkOnly(rest) || repeatsEmail || (rest.length < 40 && noSystemName.test(rest) && !symptomOf(rest)) ||
    /^(?:ndio|ndiyo|sawa|ok|okay|yes|no|hapana|ndo|[mn]ipo .+|niko .+|(?:email|imeli|barua pepe)(?:\s+ya(?:ngu|ko|\s+akaunti))?)$/i.test(rest);
  if (multipleDevices.test(rest)) {
    next.waitingFor = 'device';
    return { support: next, ready: false, reply: say(
      'Kipi kati ya hivyo kina tatizo? Unaweza kukitaja kwa mahali kilipo, kama “kile cha nje”.',
      'Which one is affected? You can describe where it’s installed, for example “the one outside”.') };
  }
  if (!contextOnly && (symptomOf(rest) || supportQuestion(rest) ||
    (['problem', 'device', 'email'].includes(next.waitingFor ?? '') && rest.split(/\s+/).length >= 2 &&
      !/^(?:sijui|sifahamu|sikumbuki|samahani|i don.t know|not sure)(?:\s+(?:modeli?|model|sku|jina|email))?$/i.test(rest)))) {
    if (!next.problem || next.waitingFor === 'device' || next.waitingFor === 'email' || next.waitingFor === 'system') {
      next.problem = [next.problem, rest].filter((item, index, all) => item && all.indexOf(item) === index).join(' · ').slice(0, 500);
    }
  }
  if (!next.problem) {
    next.waitingFor = 'problem';
    const question = next.system
      ? say('Pole kwa usumbufu kwenye ' + systemLabel(next.system) + '. Ni nini hasa kinachotokea unapoitumia?',
        'That sounds frustrating. What happens when you try to use ' + systemLabel(next.system) + '?')
      : say('Pole kwa usumbufu. Kuhusu tatizo hilo, ni hatua ipi inakwama au ujumbe gani unaonekana?',
        'That sounds frustrating. Tell me which step gets stuck or what message you see.');
    return { support: next, ready: false, reply: repeatsEmail
      ? say('Nimeelewa unamaanisha email ya awali. ', 'I understand you mean the previous email. ') + question : question };
  }
  const unknownSystem = noSystemName.test(rest) || (next.waitingFor === 'system' && /^(?:sijui|sikumbuki|not sure|i don.t know)$/i.test(rest));
  if (!next.system && !unknownSystem) {
    next.waitingFor = 'system';
    return { support: next, ready: false, reply: say(
      'Nimepata maelezo ya tatizo. Linatokea kwenye WoteFy au LubFy?',
      'I have the issue details. Does this happen on WoteFy or LubFy?') };
  }
  delete next.waitingFor;
  delete next.attempts;
  return { support: next, ready: true };
}

/** Compact subject for the stored conversation context. */
export function supportSummary(support: NonNullable<Conversation['memory']['support']>) {
  return [
    support.problem && `Tatizo: ${support.problem}`,
    support.system && `Mfumo: ${systemLabel(support.system)}`,
    support.email && `Email: ${support.email}`,
  ].filter(Boolean).join(' · ');
}

type SupportDetails = NonNullable<Conversation['memory']['lastSupport']>;
export type SupportAlertStatus = 'handoff' | 'guidance' | 'reopened';

function singleLine(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim();
}

function reportedProblem(value: string, say: Say) {
  if (/^(?:hivi\s+)?(?:mbona\s+)?vifaa(?:\s+vya[bn]gu)?\s+vina\s*waka na kuzima(?:[\s,.]+(?:shida|tatizo) ni mfumo(?: au)?)?[.!? ]*$/i.test(value)) {
    return say('Vifaa vinawaka na kuzima.', 'The devices keep turning on and off.');
  }
  return value;
}

export function supportDetails(support: SupportDetails, say: Say, includeMissingEmail = true) {
  const problem = singleLine(support.problem);
  const email = support.email || (support.sameEmail
    ? say('Email iliyotajwa awali', 'Previous email referenced')
    : say('Haijatolewa', 'Not provided'));
  const checkResult = singleLine(support.checkResult);
  return [
    `*${say('Mfumo', 'System')}* ${support.system ? systemLabel(support.system) : say('Bado haujabainishwa', 'To be confirmed')}`,
    `*${say('Changamoto', 'Reported issue')}* ${problem ? reportedProblem(problem, say) : say('Maelezo bado yanahitajika', 'More details needed')}`,
    (includeMissingEmail || support.email || support.sameEmail) && `*${say('Email ya akaunti', 'Account email')}* ${email}`,
    checkResult && `*${say('Matokeo ya ukaguzi', 'Check result')}* ${checkResult}`,
    support.verifiedCheck && `*${say('Hali iliyothibitishwa na mfumo', 'Status confirmed by the platform')}* ${support.verifiedCheck.summary}`,
  ].filter(Boolean).join('\n');
}

export function supportReceipt(support: SupportDetails, say: Say, requestEvidence = false) {
  const next = support.email
    ? say('Timu ya support itakagua taarifa hizi na kukujibu hapa kwenye WhatsApp.',
      'Our support team will review these details and reply here on WhatsApp.')
    : say('Timu ya support itaangalia maelezo uliyotoa na kuendelea kukusaidia hapa kwenye WhatsApp.',
      'Our support team will review what you shared and continue helping you here on WhatsApp.');
  return [
    `*${say('Ombi lako la msaada limepokelewa', 'Your support request has been received')}*`,
    supportDetails(support, say, false),
    `*${say('Hatua inayofuata', 'What happens next')}*\n${next}`,
    !support.email && !support.sameEmail && needsAccountCheck(support.problem ?? '') && say(
      'Ukiweza, tuma email unayotumia kuingia ili timu ipate akaunti husika. Maelezo uliyotoa tayari yamepokelewa.',
      'If you can, share the email you use to sign in so the team can find the account. We already have the details you provided.'),
    requestEvidence && say('Ukiweza, tuma picha ya ujumbe unaoona au eleza unachoona kwenye kifaa.',
      'If you can, send a screenshot of the message or describe what you see on the device.'),
  ].filter(Boolean).join('\n\n');
}

export function supportProgress(text: string, memory: Conversation['memory'], say: Say) {
  const support = memory.support ?? memory.lastSupport;
  if (!support?.problem) return;
  const asksProgress = /\b(?:kesi|tatizo|shida|ombi la msaada|support (?:case|ticket|request))\b/i.test(text) &&
    /\b(?:status|update|hatua gani|mmefikia wapi|mmesha|imesha|imefikia wapi|inaendeleaje|iliishia wapi|any news|what(?:'s| is) the status)\b/i.test(text);
  if (!asksProgress) return;
  if (memory.support?.waitingFor) return say(
    'Bado tunakusanya taarifa za tatizo hili. Unaweza kuendelea hapa kwenye chat hii ili nikusaidie.',
    'We’re still collecting details for this issue. You can continue here in this chat.');
  switch (memory.supportUpdate?.status) {
    case 'resolution_queued':
      return say('Timu imeandika taarifa ya suluhisho. Ujumbe unasubiri kufika kwenye WhatsApp.',
        'Support has prepared an update. The WhatsApp message is awaiting delivery.');
    case 'awaiting_confirmation':
      return say('Taarifa ya suluhisho imefika. Tunaendelea kusubiri jibu lako baada ya kujaribu. Je, sasa inafanya kazi?',
        'The resolution update was delivered. We’re waiting to hear how your test went. Does it work now?');
    case 'details':
      return say('Timu inaomba taarifa za ziada. Unaweza kujibu ombi lao hapa kwenye chat hii.',
        'Support asked for more details. You can reply to their request in this chat.');
    case 'resolved':
      return say('Kesi imefungwa. Kama tatizo limerudi, niambie unachoona sasa.',
        'The case is closed. If the issue has returned, tell me what you see now.');
    case 'reopened':
      return say('Kesi imefunguliwa tena baada ya taarifa yako kuwa tatizo bado lipo.',
        'The case was reopened after you reported that the issue was still happening.');
    default:
      if (memory.handoffPending) return say(
        'Ombi lako lipo kwenye foleni ya timu. Taarifa mpya ikipatikana, tutaendelea kwenye chat hii.',
        'Your request is in the support queue. We’ll continue in this chat when there’s an update.');
  }
}

export function supportAdminMessage(
  conversation: Conversation, support: SupportDetails, status: SupportAlertStatus, hasAttachment: boolean,
) {
  const say: Say = (sw) => sw;
  const customer = singleLine(conversation.customer_name) || 'Jina halijapatikana';
  const limit = (value: string | undefined, max: number) => value && value.length > max ? value.slice(0, max - 1) + '…' : value;
  const details = hasAttachment ? { ...support,
    problem: limit(support.problem, 220), checkResult: limit(support.checkResult, 140) } : support;
  const next = status === 'guidance'
    ? 'Soma mazungumzo na fuatilia ikiwa mteja ataripoti kuwa tatizo linaendelea.'
    : support.system && support.email
      ? `Fungua mazungumzo, kagua akaunti kwenye ${systemLabel(support.system)} kwa email hiyo, kisha mjibu mteja kwenye Inbox.`
      : 'Fungua mazungumzo kwenye Inbox, kagua dalili zilizotajwa na omba taarifa zinazohitajika kuendelea.';
  return [
    '*CSbot | Msaada wa kiufundi*',
    [
      `*Hali* ${status === 'guidance' ? 'Mteja amepewa hatua za ukaguzi' :
        status === 'reopened' ? 'Mteja amesema tatizo bado lipo' : 'Inasubiri mhudumu'}`,
      `*Mazungumzo* #${conversation.id}`,
      `*Mteja* ${customer}`,
      conversation.customer_phone && `*WhatsApp* +${conversation.customer_phone.replace(/^\+/, '')}`,
    ].filter(Boolean).join('\n'),
    supportDetails(details, say),
    hasAttachment && '*Kiambatisho* Picha ya mteja',
    `*Hatua inayofuata*\n${next}`,
  ].filter(Boolean).join('\n\n');
}

function needsAccountCheck(problem: string) {
  return symptomOf(problem) === 'access_payment' ||
    /\b(?:akaunti|account|dashboard|sign in|login|siwezi kuingia|[mn]imeshindwa kuingia|bili|billing|muamala|transaction)\b/i.test(problem);
}

/** Read-only checks based on the portal, trial and device flows in both platforms. */
export function firstSupportStep(
  support: NonNullable<Conversation['memory']['support']>,
  say: (sw: string, en: string) => string,
) {
  const symptom = symptomOf(support.problem ?? '');
  if (symptom === 'power') return say(
    'Tuangalie umeme kwanza. Tatizo likitokea, taa ya power inazimika pia au ni Wi-Fi tu inayopotea?',
    'Let’s start with power. When it happens, does the power light also go out, or does only Wi-Fi drop?');
  if (!support.system) return;
  if (symptom === 'access_payment') return say(
    `Kwa ${systemLabel(support.system)}, angalia status inayoonekana kwenye portal au dashboard baada ya malipo. Kama pesa tayari imekatwa, subiri timu ihakiki muamala kabla ya kujaribu kulipa tena. Inaonyesha malipo yanasubiri, au yamekamilika huku intaneti bado haifunguki?`,
    `On ${systemLabel(support.system)}, check the payment status in the portal or dashboard. If you were charged already, wait for us to check before trying to pay again. Does it show a pending payment, or a completed payment with no internet access?`);
  if (symptom === 'redirect') return say(
    `Kwa ${systemLabel(support.system)}, tuangalie kama shida ni portal yenyewe au simu kutofungua portal kiotomatiki. Unganisha simu moja kwenye Wi-Fi husika, kisha jaribu kufungua portal kwenye browser. Je, portal inafunguka kwa mkono?`,
    `On ${systemLabel(support.system)}, let’s check whether the portal works and the phone is failing to open it automatically. Connect one phone to the affected Wi-Fi and try opening the portal in a browser. Does it open manually?`);
  if (symptom === 'trial') return say(
    `Kwa ${systemLabel(support.system)}, tuanze na ujumbe halisi baada ya kubonyeza Free Trial. Jaribu kwenye simu ambayo haijatumia trial ya Wi-Fi hiyo. Ikiwa inagoma hapo pia, inasema nini?`,
    `For ${systemLabel(support.system)}, let’s start with the exact message after tapping Free Trial. Try on a phone that hasn’t used that Wi-Fi’s trial. What does it say if it still fails?`);
  if (symptom === 'offline') return support.system === 'wotefy' ? say(
    'Kwa WoteFy, hakikisha kifaa kina umeme na uplink, kisha angalia status yake kwenye Omada Controller. Kinaonekana Offline huko pia, au kwenye WoteFy pekee?',
    'For WoteFy, check the device power and uplink, then look up its status in Omada Controller. Is it offline there too, or only in WoteFy?') : say(
    'Kwa LubFy, hakikisha router ina umeme na WAN ina internet. Kisha angalia muda wa mwisho kifaa kilipoonekana online kwenye dashboard. Tatizo linahusu router moja au router zote za eneo hilo?',
    'For LubFy, check the router power and WAN connection, then look up when the device was last seen online in the dashboard. Does this affect one router or all routers at that site?');
  if (/\b(?:siwezi kuingia|[mn]imeshindwa kuingia|haikubali kuingia|login (?:inagoma|inashindwa|failed)|can.t log ?in|cannot log ?in)\b/i.test(support.problem ?? '')) return say(
    'Tuanzie kwenye ujumbe unaoonekana unapojaribu kuingia. Unaweza kunakili ujumbe huo au kutuma picha yake, bila kutuma nenosiri au OTP.',
    'Let’s start with the message you see when you try to sign in. You can copy it or send a screenshot. Keep your password and one-time code private.');
}
