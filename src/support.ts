import { emailOf, emailPattern, smallTalkOnly, supportQuestion, symptomOf, systemFrom, systemLabel } from './customer-text.js';
import type { Conversation } from './store.js';

/**
 * Support intake. A customer with a broken system is asked for the problem, the
 * system and the login email before any diagnosis, because "sijui nini
 * kinaendelea" is not enough to open an account or read a log. Each answer is
 * kept in memory, so the three questions are asked once and never repeated.
 */
export function supportIntake(
  text: string, support: NonNullable<Conversation['memory']['support']>,
  say: (sw: string, en: string) => string,
): { support: NonNullable<Conversation['memory']['support']>; reply?: string; ready: boolean } {
  const next = { ...support };
  const email = emailOf(text);
  if (email) next.email = email;
  const detectedSystem = systemFrom(text);
  if (detectedSystem) next.system = detectedSystem;
  // The email answer itself is not the problem description.
  const rest = text.replace(emailPattern, ' ')
    .replace(/\b(?:wote[ -]?fy|ss[ -]?domada|lub[ -]?fy)\b/gi, ' ')
    .replace(/[\s.,!?;:]+/g, ' ').trim();
  const generic = /^(?:kaka|mkuu|boss|tatizo|shida|problem|support|msaada|nina (?:shida|tatizo)|mfumo wako|nipo .+|niko .+)$/i;
  // "My email is the same one" is an answer, not a refusal. Asking again is what
  // made this conversation loop three times.
  const repeatedEmail = /\b(?:ile ile|ileile|ndo ile|ndiyo ile|ni ile|ndio ile|same (?:email|one)|usual email|hio hio|hiyo hiyo)\b/i.test(text);
  if (repeatedEmail) next.sameEmail = true;
  if (next.problem && generic.test(next.problem.trim())) delete next.problem;
  const onlyIdentityAnswer = generic.test(rest) || rest.length < 3
    || smallTalkOnly(rest)
    || /^(?:ndio|ndiyo|sawa|ok|okay|yes|no|hapana|ndo)$/i.test(rest);
  // "I have three devices" is not a problem description, so it is checked before
  // the sentence is stored as one.
  if (/\b(?:vifaa|navifaa|devices)\s+(?:viwili|vitatu|vingi|mbili|\d+)|\b(?:two|three|several|multiple|\d+) devices/i.test(text) && !email) {
    next.waitingFor = 'device';
    return { support: next, ready: false, reply: say('Ni kipi kati ya hivyo kina shida? Niambie modeli yake au jinsi unavyokitambua, na kinachoonekana unapokiwasha.',
      'Which device is affected? Tell me its model or how you recognise it, and what happens when you turn it on.') };
  }
  if (!next.problem && rest.length > 3 && !onlyIdentityAnswer && !repeatedEmail && (supportQuestion(rest) ||
      (next.waitingFor === 'problem' && rest.split(/\s+/).length >= 3))) {
    next.problem = rest.slice(0, 500);
  }
  if (next.waitingFor === 'device' && !onlyIdentityAnswer) {
    next.problem = [next.problem, rest].filter(Boolean).join(' · ').slice(0, 500);
    if (next.system) return { support: next, ready: true };
  }
  if (!next.problem) {
    next.waitingFor = 'problem';
    // Repeating the same opening question after the system was named makes the
    // bot look deaf, so the second ask refers to what the customer just said.
    return { support: next, ready: false, reply: next.sameEmail
      ? say('Sawa, nitatumia ile email ya awali — timu itaikuta. Sasa niambie kinachotokea: ukurasa au kifaa gani, na unaona ujumbe gani?',
        'Understood, the team will use the email already on file. Now tell me what happens: which page or device, and what message do you see?')
      : next.system
        ? say(`Sawa, shida iko kwenye ${systemLabel(next.system)}. Niambie kinachotokea — ukurasa au kifaa gani, na unaona ujumbe gani?`,
          `Understood, this is about ${systemLabel(next.system)}. What happens — which page or device, and what message do you see?`)
        : say(
          'Pole sana. Nieleze kwa ufupi shida ipoje — nini kinatokea na ulikuwa unafanya nini wakati imetokea?',
          'Sorry about that. In one or two sentences, what exactly happens and what were you doing when it started?') };
  }
  if (!next.system) {
    next.waitingFor = 'system';
    return { support: next, ready: false, reply: say(
      'Asante. Shida hii iko kwenye mfumo upi — WoteFy au LubFy?',
      'Thanks. Which system is this about — WoteFy or LubFy?') };
  }
  if (!next.email) {
    if (repeatedEmail) {
      // They told us it is the address already on file. The team can match it.
      return { support: next, ready: true };
    }
    if (next.waitingFor === 'email') {
      next.attempts = (next.attempts || 0) + 1;
      return { support: next, ready: false, reply: say(
        'Sijapata anwani ya email kwenye ujumbe huo. Unaweza kuendelea bila email. Kifaa au ukurasa gani unaonyesha tatizo?',
        'I couldn’t find an email address in that message. We can continue without it. Which device or screen shows the problem?') };
    }
    next.waitingFor = 'email';
    return { support: next, ready: false, reply: say(
      'Asante. Nipe email uliyosajili nayo kwenye akaunti (ile unayoingia nayo) ili timu ikague akaunti yako.',
      'Thanks. What is the email on your account (the one you sign in with)? The team needs it to check the right account.') };
  }
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
type Say = (sw: string, en: string) => string;
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

export function supportDetails(support: SupportDetails, say: Say) {
  const problem = singleLine(support.problem);
  const email = support.email || (support.sameEmail
    ? say('Email iliyotajwa awali', 'Previous email referenced')
    : say('Haijatolewa', 'Not provided'));
  const checkResult = singleLine(support.checkResult);
  return [
    `*${say('Mfumo', 'System')}* ${support.system ? systemLabel(support.system) : say('Bado haujabainishwa', 'To be confirmed')}`,
    `*${say('Changamoto', 'Reported issue')}* ${problem ? reportedProblem(problem, say) : say('Maelezo bado yanahitajika', 'More details needed')}`,
    `*${say('Email ya akaunti', 'Account email')}* ${email}`,
    checkResult && `*${say('Matokeo ya ukaguzi', 'Check result')}* ${checkResult}`,
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
    supportDetails(support, say),
    `*${say('Hatua inayofuata', 'What happens next')}*\n${next}`,
    requestEvidence && say('Ukiweza, tuma modeli ya kifaa au picha ya ujumbe unaoona.',
      'If you can, send the device model or a screenshot of the message you see.'),
  ].filter(Boolean).join('\n\n');
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

/** Read-only checks based on the portal, trial and device flows in both platforms. */
export function firstSupportStep(
  support: NonNullable<Conversation['memory']['support']>,
  say: (sw: string, en: string) => string,
) {
  const symptom = symptomOf(support.problem ?? '');
  if (symptom === 'power') return say(
    'Angalia kwanza kama adapta au PoE inayotumika ni ile iliyopendekezwa kwa modeli hiyo, halafu hakiki taa ya power. Modeli ni ipi, na taa yoyote inawaka?',
    'Check that the power adapter or PoE supply is the one recommended for this model, then check the power light. What model is it, and do any lights turn on?');
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
}
