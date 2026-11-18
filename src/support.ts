import { emailOf, emailPattern, smallTalkOnly, supportQuestion, systemFrom, systemLabel } from './customer-text.js';
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
    .replace(/\b(?:wotefy|lubfy)\b/gi, ' ')
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

/** One line for the admin alert, so the team starts with the facts. */
export function supportSummary(support: NonNullable<Conversation['memory']['support']>) {
  return [
    support.problem && `Tatizo: ${support.problem}`,
    support.system && `Mfumo: ${systemLabel(support.system)}`,
    support.email && `Email: ${support.email}`,
  ].filter(Boolean).join(' · ');
}
