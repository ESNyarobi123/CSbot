import { emailOf, supportQuestion, systemFrom, systemLabel } from './customer-text.js';
import type { Conversation } from './store.js';

type Say = (sw: string, en: string) => string;
type System = NonNullable<Conversation['memory']['system']>;
const families = [
  ['omada', /\bomada\b|\beap\s*-?\d/i],
  ['mikrotik', /\b(?:mikrotik\b|microtick\b|routeros\b|h[ae]p\b|hex\b|rb\d)/i],
  ['cudy', /\bcudy\b|\bwr\s*-?\d/i],
  ['ruijie', /\b(?:ruijie|reyee)\b|\brg[- ]/i],
  ['unifi', /\b(?:unifi|ubiquiti)\b/i],
  ['cambium', /\b(?:cambium|cnmaestro)\b/i],
] as const;
type Family = typeof families[number][0];
export type SetupContext = { family?: Family; system?: System; model?: string; firmware?: string };

const guides: Record<Family, readonly [string, string]> = {
  omada: [
    'Unganisha AP kwenye uplink na chanzo cha umeme kinachoendana na modeli. Kwenye Omada Controller, hakikisha AP inaonekana na ipo kwenye site sahihi. Portal ya wageni inaunganishwa kwa maelekezo ya mfumo uliochagua.',
    'Connect the AP to the uplink and the power source specified for that model. In Omada Controller, confirm the AP appears under the correct site. Use your chosen platform’s instructions to connect the guest portal.',
  ],
  mikrotik: [
    'Hakikisha MikroTik ina internet kwenye WAN na una nakala ya usanidi wa sasa. Fungua site husika kwenye LubFy, chagua Add Router, kisha linganisha modeli na RouterOS kabla ya kutumia maelekezo ya enrollment yanayotolewa kwenye dashboard.',
    'Check that the MikroTik has WAN internet and back up its current configuration. Open the site in LubFy, choose Add Router, and confirm the model and RouterOS version before following the dashboard’s enrollment instructions.',
  ],
  cudy: [
    'Kwenye Cudy, kagua firmware na uone kama menyu ina External Portal Server. Kisha fungua site kwenye LubFy upate mipangilio ya portal ya site hiyo. Majina ya fields hutegemea firmware ya kifaa.',
    'Check the Cudy firmware and look for External Portal Server in its menu. Then open the site in LubFy for its portal settings. Field names depend on the device firmware.',
  ],
  ruijie: [
    'Fungua site kwenye LubFy na kagua kama modeli yako ina External Portal au WiFiDog. Hifadhi modeli na firmware za kifaa. Mpangilio wa portal utategemea protocol inayopatikana kwenye modeli hiyo.',
    'Open the site in LubFy and check whether the model offers External Portal or WiFiDog. Note the device model and firmware. The portal setup depends on the protocol available on that model.',
  ],
  unifi: [
    'Hakikisha kifaa kinaonekana kwenye site sahihi ya UniFi Network. Kwenye LubFy chagua kama lengo ni portal ya wageni au kufuatilia vifaa kwenye inventory. Hatua za guest authorization hutegemea Network Application na protocol uliyochagua.',
    'Confirm the device appears under the right UniFi Network site. In LubFy, decide whether you are setting up a guest portal or inventory tracking. Guest authorization depends on the Network Application and selected protocol.',
  ],
  cambium: [
    'Tambua kwanza kama Cambium inasimamiwa kupitia cnMaestro Cloud, cnMaestro On-Prem au moja kwa moja kwenye AP. Kwenye LubFy chagua namna hiyo hiyo ya usimamizi; kila moja ina utaratibu wake wa portal.',
    'Identify whether the Cambium is managed through cnMaestro Cloud, cnMaestro On-Prem, or directly on the AP. Select the matching management mode in LubFy; each has a different portal setup.',
  ],
};

const setupRequest = /\b(?:nafungaje|ninafungaje|nitaifungaje|nafanyaje installation|nasanidi vipi|kuinstall vipi|namna ya (?:kuinstall|kufunga|kusanidi|kuunganisha)|jinsi ya (?:kuinstall|kufunga|kusanidi|kuunganisha)|hatua za (?:installation|kufunga|kusanidi|kuunganisha)|how (?:to|do i|can i) (?:install|set up|configure|connect)|installation guide|setup guide|setup steps)\b/i;
const pricing = /\b(?:bei|price|gharama|cost|shingapi|how much|quotation|invoice)\b/i;
const familyOf = (text: string) => families.find(([, pattern]) => pattern.test(text))?.[0];
const firmwareOf = (text: string) =>
  /\b(?:firmware|routeros|version|toleo)\s*(?:(?:ni|is)\s*)?v?([0-9]+(?:\.[0-9]+){1,3})\b|^v?([0-9]+(?:\.[0-9]+){1,3})$/i.exec(text.trim())?.slice(1).find(Boolean);
const modelOf = (text: string) =>
  /\b(?:h[ae]p[ -]+(?:ax\s*(?:lite|\d+)|ac\s*(?:lite|\d+)?|lite)|(?:eap|wr|rb|er|rap|c|ax)[- ]?\d{1,5}[a-z0-9-]*|[a-z]{2,9}-?\d{2,5}[a-z0-9-]*|rg-[a-z]{2,4}\d{3,5}[a-z0-9-]*)\b/i.exec(text)?.[0];

export function installationGuide(text: string, memory: Conversation['memory'], say: Say) {
  const explicit = setupRequest.test(text);
  const system = systemFrom(text);
  const named = familyOf(text);
  const writtenModel = modelOf(text);
  const writtenFirmware = firmwareOf(text);
  const followUp = memory.setup && text.trim().split(/\s+/).length <= 5 && (system || named || writtenModel || writtenFirmware);
  if ((!explicit && !followUp) || pricing.test(text) || supportQuestion(text) || emailOf(text)) return;
  if (!named && /\b(?:ofisi|majengo|nyumba|offices|buildings|houses)\b/i.test(text) &&
      /\b(?:mbili|tatu|two|three|km|kilomet\w*|point.to.point)\b/i.test(text)) return;

  const refersToQuote = /\b(?:hii|hiki|hiyo|ile|yake|this|that|it)\b/i.test(text);
  const quoted = refersToQuote ? memory.product?.name ?? '' : '';
  const previous = explicit || (named && memory.setup?.family && named !== memory.setup.family) ? undefined : memory.setup;
  const family = named ?? familyOf(quoted) ?? previous?.family;
  const selected = system || previous?.system || undefined;
  const model = writtenModel ?? modelOf(quoted) ?? previous?.model;
  const firmware = writtenFirmware ?? previous?.firmware;
  const identity = { family, system: selected, model, firmware };
  memory.setup = identity;

  if (!family) {
    return model
      ? say(`Kwa ${model}, nahitaji chapa kamili na kazi unayotaka kifanye ili nichague mwongozo sahihi. Ni chapa gani iliyo kwenye lebo?`,
        `For ${model}, I need the full brand and intended use to find the right guide. Which brand is on the label?`)
      : say('Tuanze na modeli kamili iliyo kwenye lebo ya kifaa. Nikijua modeli, nitakagua mwongozo na mfumo unaofaa kwa kazi unayotaka.',
        'Let’s start with the exact model from the device label. I can use it to check the guide and which platform fits your setup.');
  }
  if (family === 'omada' && !selected) {
    return say('Omada ina njia tofauti za kuunganisha portal kwenye WoteFy na LubFy. Unatumia mfumo upi kwa kifaa hiki?',
      'Omada uses different portal setup paths for WoteFy and LubFy. Which platform will you use for this device?');
  }
  if (selected === 'wotefy' && family !== 'omada') {
    return say('WoteFy hutumia Omada Controller. Kwa familia hii ya vifaa, tunaweza kukagua njia ya LubFy. Unataka kutumia kifaa hiki kwa Wi-Fi ya kawaida au kwa portal ya wageni?',
      'WoteFy uses Omada Controller. For this device family, we can check the LubFy setup. Are you setting up ordinary Wi-Fi or a guest portal?');
  }

  const target = selected || 'lubfy';
  memory.setup = { ...identity, system: target };
  const [sw, en] = guides[family];
  const platformStep = family === 'omada' ? target === 'wotefy'
    ? say('Kwenye site ya WoteFy, tumia SSID ya wageni iliyoandaliwa kwa portal ya WoteFy. Kagua kuwa SSID na profile ya portal ni za site moja.',
      'In WoteFy, use the guest SSID for that site’s WoteFy portal. Check that the SSID and portal profile are assigned to the same site.')
    : say('Fungua site kwenye LubFy na tumia profile ya portal ya LubFy kwa SSID ya wageni. Kagua kuwa site iliyo kwenye Omada inalingana na ile uliyochagua kwenye LubFy.',
      'Open the site in LubFy and use its portal profile for the guest SSID. Check that the Omada site matches the site selected in LubFy.') : '';
  const title = say(`*Hatua za mwanzo kwenye ${systemLabel(target)}*`, `*First steps for ${systemLabel(target)}*`);
  const next = !model
    ? say('Modeli kamili iliyo kwenye lebo ni ipi?', 'What exact model is shown on the label?')
    : !firmware
      ? say(`Nimepata modeli ${model}. Toleo la firmware linaandikwaje kwenye ukurasa wa kifaa?`,
        `I have the model, ${model}. What firmware version is shown on the device page?`)
      : say(`Nimepata ${model} na firmware ${firmware}. Baada ya kuunganisha portal, jaribu simu moja kwenye SSID ya wageni uone kama ukurasa wa kuingia unatokea. Ukiishia kwenye kosa, nitumie maandishi yake au picha ya skrini.`,
        `I have ${model} with firmware ${firmware}. After linking the portal, test with one phone on the guest SSID and check whether the sign-in page opens. If you hit an error, send me its text or a screenshot.`);
  if (model && firmware) delete memory.setup;
  return [title, say(sw, en), platformStep, next].filter(Boolean).join('\n\n');
}
