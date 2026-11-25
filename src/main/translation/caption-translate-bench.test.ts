/*
 * QA24-CAPLANG-2 (a24-caplang2, MEASURING ONLY, scratch branch s59-cap-caplang2, never merged): how long the offline
 * translation engine (alpha.22's IndicTrans2 pack through TranslationEngine, TranslationHelper and drashti-translate,
 * exactly as Prepare translations runs it) takes per caption phrase, for every direction it has, cold and warm, greedy
 * (beam 1) and careful (beam 5), and what it costs in memory and processor time. Placeholder phrases only: the
 * committed caption fixture's 12 sentences (tests/fixtures/captions/manifest.json) and the everyday sentences below,
 * written for this bench with their translations as references. No recording, no mandir content.
 *
 * It runs only when named: in a CI quick check naming this file (ci.yml's unit step sets UNIT), or with
 * CAPLANG_BENCH=1 locally; in the whole unit suite it is skipped. On CI's Windows runner it builds drashti-translate
 * from its pinned sources (scripts/fetch-translate.mjs, as a full run does), fetches alpha.22's published translation
 * pack from Drashti's own release page (size and SHA-256 pinned, through fetch-caption-models' guarded download),
 * imports it with the real ModelPackStore, then measures on two cores (processor mask 3, as the Performance check and
 * the captions bench limit themselves) and on all four. Results are printed as lines starting CAPLANG.
 *   CAPLANG_BENCH=1            run locally
 *   CAPLANG_BENCH_HELPER       the helper program (else vendor/translate, else built on Windows)
 *   CAPLANG_BENCH_ZIP          the pack zip (else fetched)
 *   CAPLANG_BENCH_STORE        the model-packs folder to import into (kept between local runs)
 *   CAPLANG_BENCH_OUT          a JSON file for every result and output
 *   CAPLANG_BENCH_PLAN         full (local) or ci (default on CI)
 *   CAPLANG_BENCH_EXTRA        a JSON file of extra phrases [{set, from, to, text, ref}] (local only)
 *   CAPLANG_BENCH_SA_HELPER    a measurement-only helper that also takes san_Deva (local only)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, homedir, tmpdir, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { fetchCaptionModel } from '../../../scripts/fetch-caption-models.mjs';
import type { TranslationLanguage } from '../../shared/prepared-translations';
import { ModelPackStore } from '../model-packs/store';
import { affinityArgs, childrenArgs, parseChildren } from '../speech/captions-bench';
import {
  decodeTokens,
  postprocess,
  preprocess,
  restoreSourceClockSpacing,
  routeFor,
} from './indictrans-text';
import { TranslationEngine } from './translation-engine';
import { TranslationHelper } from './translation-helper';

const ROOT = resolve(__dirname, '..', '..', '..');
const env = process.env;
const WINDOWS = process.platform === 'win32';
const NAMED =
  (env['UNIT'] ?? '').split(/\s+/u).some((f) => f.endsWith('caption-translate-bench.test.ts')) ||
  env['CAPLANG_BENCH'] === '1';
const POWERSHELL = `${env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

const PACK = {
  name: 'drashti-translation-indictrans2-dist-int8.zip',
  url: 'https://github.com/Priyansh9121/drashti/releases/download/v1.0.0-alpha.22/drashti-translation-indictrans2-dist-int8.zip',
  hosts: ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
  bytes: 701_897_809,
  sha256: '3d119c431c2e3a0c2a48f8bb4ba0bd44ef99ec4182b1fd49faaf6696d96183aa',
  licence: 'MIT (AI4Bharat IndicTrans2; the licence text is inside the pack)',
  what: 'alpha.22 translation pack (IndicTrans2 distilled, int8), as a Main imports it',
};

type Lang = TranslationLanguage;
interface Phrase {
  set: string;
  id: string;
  en: string;
  gu: string;
  hi: string;
}

/** Everyday and devotional-neutral sentences, 3 to 15 words, with careful references in all three languages. */
const OWN: readonly Omit<Phrase, 'set'>[] = [
  {
    id: 'o01',
    en: 'Please sit down, the program will begin soon.',
    hi: 'कृपया बैठ जाइए, कार्यक्रम जल्दी शुरू होगा।',
    gu: 'કૃપા કરીને બેસી જાઓ, કાર્યક્રમ જલદી શરૂ થશે.',
  },
  {
    id: 'o02',
    en: 'Please switch off your mobile phones.',
    hi: 'कृपया अपने मोबाइल फ़ोन बंद कर दीजिए।',
    gu: 'કૃપા કરીને તમારા મોબાઇલ ફોન બંધ કરી દો.',
  },
  {
    id: 'o03',
    en: 'Thank you all for coming today.',
    hi: 'आज आने के लिए आप सभी का धन्यवाद।',
    gu: 'આજે આવવા બદલ આપ સૌનો આભાર.',
  },
  {
    id: 'o04',
    en: 'We should always speak the truth.',
    hi: 'हमें हमेशा सच बोलना चाहिए।',
    gu: 'આપણે હંમેશાં સાચું બોલવું જોઈએ.',
  },
  {
    id: 'o05',
    en: 'Children, please sit in the front rows.',
    hi: 'बच्चो, कृपया आगे की पंक्तियों में बैठिए।',
    gu: 'બાળકો, કૃપા કરીને આગળની હરોળમાં બેસો.',
  },
  {
    id: 'o06',
    en: 'Drinking water is near the main door.',
    hi: 'पीने का पानी मुख्य दरवाज़े के पास है।',
    gu: 'પીવાનું પાણી મુખ્ય દરવાજા પાસે છે.',
  },
  {
    id: 'o07',
    en: 'Let us sit quietly for a moment.',
    hi: 'आइए, हम एक पल शांति से बैठें।',
    gu: 'ચાલો, આપણે એક ક્ષણ શાંતિથી બેસીએ.',
  },
  {
    id: 'o08',
    en: 'Respect your parents and help them every day.',
    hi: 'अपने माता-पिता का आदर करें और हर दिन उनकी मदद करें।',
    gu: 'તમારાં માતા-પિતાનો આદર કરો અને દરરોજ તેમને મદદ કરો.',
  },
  {
    id: 'o09',
    en: 'The meal will be served after the program.',
    hi: 'कार्यक्रम के बाद भोजन परोसा जाएगा।',
    gu: 'કાર્યક્રમ પછી ભોજન પીરસવામાં આવશે.',
  },
  {
    id: 'o10',
    en: 'Please keep your shoes outside.',
    hi: 'कृपया अपने जूते बाहर रखें।',
    gu: 'કૃપા કરીને તમારાં જૂતાં બહાર રાખો.',
  },
  {
    id: 'o11',
    en: 'Hard work always brings good results.',
    hi: 'कड़ी मेहनत से हमेशा अच्छे परिणाम मिलते हैं।',
    gu: 'સખત મહેનતથી હંમેશાં સારાં પરિણામ મળે છે.',
  },
  {
    id: 'o12',
    en: 'Today we will talk about patience.',
    hi: 'आज हम धैर्य के बारे में बात करेंगे।',
    gu: 'આજે આપણે ધીરજ વિશે વાત કરીશું.',
  },
  {
    id: 'o13',
    en: 'Be kind to everyone you meet.',
    hi: 'आप जिससे भी मिलें, उसके प्रति दयालु रहें।',
    gu: 'તમે જેને પણ મળો, તેમની સાથે દયાળુ બનો.',
  },
  {
    id: 'o14',
    en: 'The car park is behind the hall.',
    hi: 'गाड़ियों की पार्किंग हॉल के पीछे है।',
    gu: 'ગાડીઓનું પાર્કિંગ હૉલની પાછળ છે.',
  },
  {
    id: 'o15',
    en: 'Please help the elderly find a seat.',
    hi: 'कृपया बुज़ुर्गों को बैठने की जगह ढूँढने में मदद करें।',
    gu: 'કૃપા કરીને વડીલોને બેસવાની જગ્યા શોધવામાં મદદ કરો.',
  },
  {
    id: 'o16',
    en: 'We will take a short break now.',
    hi: 'अब हम थोड़ी देर का विराम लेंगे।',
    gu: 'હવે આપણે થોડો વિરામ લઈશું.',
  },
  {
    id: 'o17',
    en: 'The next session starts at half past seven.',
    hi: 'अगला सत्र साढ़े सात बजे शुरू होगा।',
    gu: 'આગળનું સત્ર સાડા સાત વાગ્યે શરૂ થશે.',
  },
  {
    id: 'o18',
    en: 'Good habits keep a family happy.',
    hi: 'अच्छी आदतें परिवार को खुश रखती हैं।',
    gu: 'સારી ટેવો પરિવારને સુખી રાખે છે.',
  },
  {
    id: 'o19',
    en: 'Please clap for our volunteers.',
    hi: 'कृपया हमारे स्वयंसेवकों के लिए तालियाँ बजाइए।',
    gu: 'કૃપા કરીને આપણા સ્વયંસેવકો માટે તાળીઓ પાડો.',
  },
  { id: 'o20', en: 'Everyone is welcome here.', hi: 'यहाँ सभी का स्वागत है।', gu: 'અહીં સૌનું સ્વાગત છે.' },
  {
    id: 'o21',
    en: 'Listen carefully and then answer.',
    hi: 'ध्यान से सुनिए और फिर जवाब दीजिए।',
    gu: 'ધ્યાનથી સાંભળો અને પછી જવાબ આપો.',
  },
  {
    id: 'o22',
    en: 'Anger harms us more than others.',
    hi: 'क्रोध दूसरों से ज़्यादा हमें ही नुकसान पहुँचाता है।',
    gu: 'ગુસ્સો બીજાઓ કરતાં આપણને વધુ નુકસાન કરે છે.',
  },
  {
    id: 'o23',
    en: 'My grandmother tells us a story every night.',
    hi: 'मेरी दादी हर रात हमें एक कहानी सुनाती हैं।',
    gu: 'મારાં દાદી દરરોજ રાત્રે અમને એક વાર્તા કહે છે.',
  },
  {
    id: 'o24',
    en: 'Please do not run in the hall.',
    hi: 'कृपया हॉल में न दौड़ें।',
    gu: 'કૃપા કરીને હૉલમાં દોડશો નહીં.',
  },
  {
    id: 'o25',
    en: 'The festival will be celebrated next Sunday.',
    hi: 'त्योहार अगले रविवार को मनाया जाएगा।',
    gu: 'તહેવાર આવતા રવિવારે ઊજવવામાં આવશે.',
  },
  {
    id: 'o26',
    en: 'Share your food with those who have none.',
    hi: 'जिनके पास खाना नहीं है, उनके साथ अपना खाना बाँटिए।',
    gu: 'જેમની પાસે ખાવાનું નથી, તેમની સાથે તમારું ખાવાનું વહેંચો.',
  },
  {
    id: 'o27',
    en: 'A calm mind makes good decisions.',
    hi: 'शांत मन अच्छे निर्णय लेता है।',
    gu: 'શાંત મન સારા નિર્ણયો લે છે.',
  },
  {
    id: 'o28',
    en: 'The lights will be turned off in two minutes.',
    hi: 'दो मिनट में बत्तियाँ बंद कर दी जाएँगी।',
    gu: 'બે મિનિટમાં લાઇટો બંધ કરી દેવામાં આવશે.',
  },
  {
    id: 'o29',
    en: 'Please stand for the closing prayer.',
    hi: 'कृपया समापन प्रार्थना के लिए खड़े हो जाइए।',
    gu: 'કૃપા કરીને સમાપન પ્રાર્થના માટે ઊભા થાઓ.',
  },
  {
    id: 'o30',
    en: 'We learn something new every day.',
    hi: 'हम हर दिन कुछ नया सीखते हैं।',
    gu: 'આપણે દરરોજ કંઈક નવું શીખીએ છીએ.',
  },
  {
    id: 'o31',
    en: 'Thank you for your patience.',
    hi: 'आपके धैर्य के लिए धन्यवाद।',
    gu: 'તમારી ધીરજ બદલ આભાર.',
  },
  {
    id: 'o32',
    en: 'The exit doors are on both sides.',
    hi: 'बाहर निकलने के दरवाज़े दोनों तरफ़ हैं।',
    gu: 'બહાર નીકળવાના દરવાજા બંને બાજુ છે.',
  },
  {
    id: 'o33',
    en: 'Young people should serve their community with joy.',
    hi: 'युवाओं को खुशी से अपने समाज की सेवा करनी चाहिए।',
    gu: 'યુવાનોએ આનંદથી પોતાના સમાજની સેવા કરવી જોઈએ.',
  },
  {
    id: 'o34',
    en: 'Please speak slowly so that everyone can understand.',
    hi: 'कृपया धीरे बोलिए ताकि सब समझ सकें।',
    gu: 'કૃપા કરીને ધીમેથી બોલો જેથી બધા સમજી શકે.',
  },
  {
    id: 'o35',
    en: 'Simple living brings peace to the heart.',
    hi: 'सादा जीवन मन को शांति देता है।',
    gu: 'સાદું જીવન મનને શાંતિ આપે છે.',
  },
  {
    id: 'o36',
    en: 'Our team cleaned the whole hall this morning.',
    hi: 'हमारी टीम ने आज सुबह पूरा हॉल साफ़ किया।',
    gu: 'અમારી ટીમે આજે સવારે આખો હૉલ સાફ કર્યો.',
  },
  {
    id: 'o37',
    en: 'If you need any help, please ask one of the volunteers at the door.',
    hi: 'अगर आपको किसी मदद की ज़रूरत हो, तो कृपया दरवाज़े पर खड़े किसी स्वयंसेवक से पूछिए।',
    gu: 'જો તમને કોઈ મદદની જરૂર હોય, તો કૃપા કરીને દરવાજા પાસેના કોઈ સ્વયંસેવકને પૂછો.',
  },
  {
    id: 'o38',
    en: 'When we help others without expecting anything, our own hearts become lighter.',
    hi: 'जब हम बिना किसी अपेक्षा के दूसरों की मदद करते हैं, तो हमारा अपना मन हल्का हो जाता है।',
    gu: 'જ્યારે આપણે કોઈ અપેક્ષા વિના બીજાઓને મદદ કરીએ છીએ, ત્યારે આપણું પોતાનું મન હળવું થઈ જાય છે.',
  },
  {
    id: 'o39',
    en: 'The children have practised this song for many weeks, so please listen carefully.',
    hi: 'बच्चों ने कई हफ़्तों तक इस गीत का अभ्यास किया है, इसलिए कृपया ध्यान से सुनिए।',
    gu: 'બાળકોએ ઘણાં અઠવાડિયાં સુધી આ ગીતનો અભ્યાસ કર્યો છે, તેથી કૃપા કરીને ધ્યાનથી સાંભળો.',
  },
  {
    id: 'o40',
    en: 'Tomorrow morning the hall will open at nine, and breakfast will be served at ten.',
    hi: 'कल सुबह हॉल नौ बजे खुलेगा और नाश्ता दस बजे परोसा जाएगा।',
    gu: 'આવતી કાલે સવારે હૉલ નવ વાગ્યે ખૂલશે અને નાસ્તો દસ વાગ્યે પીરસવામાં આવશે.',
  },
  { id: 'o41', en: 'Please be seated.', hi: 'कृपया बैठ जाइए।', gu: 'કૃપા કરીને બેસો.' },
  { id: 'o42', en: 'Thank you very much.', hi: 'आपका बहुत-बहुत धन्यवाद।', gu: 'આપનો ખૂબ ખૂબ આભાર.' },
  { id: 'o43', en: 'Let us begin.', hi: 'आइए, शुरू करें।', gu: 'ચાલો, શરૂ કરીએ.' },
  { id: 'o44', en: 'Please keep quiet.', hi: 'कृपया शांत रहिए।', gu: 'કૃપા કરીને શાંતિ રાખો.' },
];

/** Simple textbook-style Sanskrit sentences (no scripture), for the measurement-only Sanskrit rows. */
const SANSKRIT: readonly { id: string; sa: string; en: string; hi: string; gu: string }[] = [
  {
    id: 's01',
    sa: 'बालकः पुस्तकं पठति।',
    en: 'The boy reads a book.',
    hi: 'लड़का किताब पढ़ता है।',
    gu: 'છોકરો પુસ્તક વાંચે છે.',
  },
  {
    id: 's02',
    sa: 'वयं प्रतिदिनं विद्यालयं गच्छामः।',
    en: 'We go to school every day.',
    hi: 'हम हर दिन विद्यालय जाते हैं।',
    gu: 'અમે દરરોજ શાળાએ જઈએ છીએ.',
  },
  { id: 's03', sa: 'जलं शीतलम् अस्ति।', en: 'The water is cold.', hi: 'पानी ठंडा है।', gu: 'પાણી ઠંડું છે.' },
  {
    id: 's04',
    sa: 'माता भोजनं पचति।',
    en: 'Mother cooks food.',
    hi: 'माँ खाना पकाती है।',
    gu: 'માતા ભોજન રાંધે છે.',
  },
  {
    id: 's05',
    sa: 'अद्य वर्षा भवति।',
    en: 'It is raining today.',
    hi: 'आज बारिश हो रही है।',
    gu: 'આજે વરસાદ પડે છે.',
  },
  {
    id: 's06',
    sa: 'सः उद्याने क्रीडति।',
    en: 'He plays in the garden.',
    hi: 'वह बगीचे में खेलता है।',
    gu: 'તે બગીચામાં રમે છે.',
  },
  {
    id: 's07',
    sa: 'कृपया अत्र उपविशतु।',
    en: 'Please sit here.',
    hi: 'कृपया यहाँ बैठिए।',
    gu: 'કૃપા કરીને અહીં બેસો.',
  },
  {
    id: 's08',
    sa: 'छात्राः ध्यानेन शृण्वन्ति।',
    en: 'The students listen carefully.',
    hi: 'छात्र ध्यान से सुनते हैं।',
    gu: 'વિદ્યાર્થીઓ ધ્યાનથી સાંભળે છે.',
  },
  {
    id: 's09',
    sa: 'वृक्षे खगाः सन्ति।',
    en: 'There are birds on the tree.',
    hi: 'पेड़ पर पक्षी हैं।',
    gu: 'ઝાડ પર પક્ષીઓ છે.',
  },
  {
    id: 's10',
    sa: 'अहं जलं पिबामि।',
    en: 'I drink water.',
    hi: 'मैं पानी पीता हूँ।',
    gu: 'હું પાણી પીઉં છું.',
  },
  {
    id: 's11',
    sa: 'मित्रं गृहम् आगच्छति।',
    en: 'The friend comes home.',
    hi: 'मित्र घर आता है।',
    gu: 'મિત્ર ઘરે આવે છે.',
  },
  {
    id: 's12',
    sa: 'सूर्यः प्रातः उदेति।',
    en: 'The sun rises in the morning.',
    hi: 'सूर्य सुबह उगता है।',
    gu: 'સૂર્ય સવારે ઊગે છે.',
  },
];

/** The committed caption fixture's 12 sentences: Gujarati and Hindi as spoken, English as its manifest gives it. */
function fixturePhrases(): Phrase[] {
  const m = JSON.parse(
    readFileSync(join(ROOT, 'tests', 'fixtures', 'captions', 'manifest.json'), 'utf8'),
  ) as {
    clips: { id: string; text: string }[];
    english: { sentences: { text: string; pair: string }[] };
  };
  // A sentence's number ("hi-01" -> "01") names its clips in both languages (gu-01-f, hi-01-m...).
  const spoken = (language: string, n: string): string =>
    m.clips.find((c) => c.id.startsWith(`${language}-${n}-`))?.text ?? '';
  return m.english.sentences.map((s) => {
    const n = s.pair.slice(3);
    return { set: 'fixture12', id: `f${n}`, en: s.text, gu: spoken('gu', n), hi: spoken('hi', n) };
  });
}

const DIRECTIONS: readonly (readonly [Lang, Lang])[] = [
  ['gu', 'hi'],
  ['hi', 'gu'],
  ['gu', 'en'],
  ['hi', 'en'],
  ['en', 'gu'],
  ['en', 'hi'],
];

interface Plan {
  name: string;
  /**
   * Each run: the processor mask (Windows only; null: every processor), the beam, how many phrases each direction
   * takes (0: all) and how many cold starts.
   */
  runs: { mask: number | null; beam: number; phrases: number; cold: number }[];
  switching: number;
}

function planFor(name: string): Plan {
  if (name === 'smoke') return { name, runs: [{ mask: null, beam: 1, phrases: 2, cold: 1 }], switching: 2 };
  if (name === 'ci')
    return {
      name,
      runs: [
        { mask: 3, beam: 1, phrases: 0, cold: 3 },
        { mask: 3, beam: 5, phrases: 20, cold: 2 },
        { mask: null, beam: 1, phrases: 20, cold: 2 },
      ],
      switching: 8,
    };
  return {
    name,
    runs: [
      { mask: null, beam: 1, phrases: 0, cold: 4 },
      { mask: null, beam: 5, phrases: 0, cold: 3 },
    ],
    switching: 10,
  };
}

function powershell(args: string[]): string {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && k !== 'PSModulePath') e[k] = v;
  const r = spawnSync(POWERSHELL, args, { env: e, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`PowerShell failed (${String(r.status)}): ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** The running helpers: pid, resident or peak memory (MiB) and processor time (ms), as the system reports them. */
function helpers(program: string): { pid: number; mib: number; cpuMs: number; affinity: string }[] {
  if (WINDOWS) {
    const list = parseChildren(powershell(childrenArgs(process.pid))).filter((c) =>
      c.name.toLowerCase().startsWith('drashti-translate'),
    );
    return list.map((c) => {
      const cpu = Number(
        powershell([
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Process -Id ${String(c.pid)}).TotalProcessorTime.TotalMilliseconds`,
        ]),
      );
      return { pid: c.pid, mib: c.peak / 1_048_576, cpuMs: cpu, affinity: String(c.affinity) };
    });
  }
  const r = spawnSync('/bin/ps', ['-A', '-o', 'pid=,rss=,time=,command='], { encoding: 'utf8' });
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes(program) && !l.includes('taskpolicy'))
    .map((l) => {
      const [pid = '0', rss = '0', time = '0:0'] = l.split(/\s+/u);
      const parts = time.split(':').map(Number);
      const seconds = parts.reduce((a, b) => a * 60 + b, 0);
      return { pid: Number(pid), mib: Number(rss) / 1024, cpuMs: seconds * 1000, affinity: '-' };
    });
}

function setMask(mask: number): string {
  return powershell(affinityArgs(process.pid, mask));
}

const quantile = (xs: readonly number[], q: number): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return (s[lo] ?? 0) + ((s[hi] ?? 0) - (s[lo] ?? 0)) * (at - lo);
};
const trio = (xs: readonly number[]): string =>
  `${String(Math.round(quantile(xs, 0.5)))} / ${String(Math.round(quantile(xs, 0.95)))} / ${String(Math.round(Math.max(...xs)))}`;
const words = (s: string): number => s.split(/\s+/u).filter((w) => w !== '').length;

const log = {
  info: (): void => undefined,
  warn: (line: string): void => {
    console.warn(line);
  },
};
/** Every logical processor (the mask a run without a limit is given back). */
const ALL = 2 ** cpus().length - 1;

async function helperProgram(): Promise<string> {
  const given = env['CAPLANG_BENCH_HELPER'];
  if (given) return given;
  const exe = WINDOWS ? 'drashti-translate.exe' : 'drashti-translate';
  const inVendor = join(ROOT, 'vendor', 'translate', `${process.platform}-${process.arch}`, exe);
  if (!existsSync(inVendor)) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'fetch-translate.mjs')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    });
    if (r.status !== 0) throw new Error(`fetch-translate failed (${String(r.status)})`);
    console.log(`CAPLANG build: drashti-translate built in ${String(Date.now() - t0)} ms`);
  }
  return inVendor;
}

async function packZip(): Promise<string> {
  const given = env['CAPLANG_BENCH_ZIP'];
  if (given) return given;
  const t0 = Date.now();
  const file = await fetchCaptionModel('translation-pack', {
    cacheDir: join(homedir(), '.cache', 'drashti', 'caplang-bench'),
    fetch: (url, init) => fetch(url, init),
    pause: (ms) => sleep(ms),
    table: { 'translation-pack': PACK },
  });
  console.log(`CAPLANG fetch: the pack in ${String(Date.now() - t0)} ms`);
  return file;
}

async function storeWithPack(): Promise<ModelPackStore> {
  const root = env['CAPLANG_BENCH_STORE'] ?? join(tmpdir(), 'caplang-bench-store');
  mkdirSync(root, { recursive: true });
  const store = new ModelPackStore({ root, log });
  store.start();
  if (store.forPurpose('translation-gu-hi').length === 0) {
    const t0 = Date.now();
    const r = await store.importPack(await packZip(), 'zip');
    if (!r.ok) throw new Error(`import failed: ${r.message}`);
    console.log(`CAPLANG import: the pack imported in ${String(Date.now() - t0)} ms`);
  }
  return store;
}

interface Row {
  set: string;
  id: string;
  from: string;
  to: string;
  beam: number;
  mask: string;
  ms: number;
  srcWords: number;
  text: string;
  ref: string;
  out: string;
}

describe.skipIf(!NAMED)('caption translation bench (QA24-CAPLANG-2, measuring only)', () => {
  it(
    'times every direction per phrase, cold and warm, greedy and careful',
    { timeout: 5_400_000 },
    async () => {
      const plan = planFor(env['CAPLANG_BENCH_PLAN'] ?? (env['CI'] ? 'ci' : 'full'));
      console.log(
        `CAPLANG machine: ${process.platform}-${process.arch}, ${String(cpus().length)} logical processors (${cpus()[0]?.model ?? '?'}), ${String(Math.round(totalmem() / 1_073_741_824))} GiB, plan ${plan.name}`,
      );
      const program = await helperProgram();
      const store = await storeWithPack();
      const own: Phrase[] = OWN.map((p) => ({ ...p, set: 'own44' }));
      const phrases = [...own, ...fixturePhrases()];
      const extra = env['CAPLANG_BENCH_EXTRA']
        ? (JSON.parse(readFileSync(env['CAPLANG_BENCH_EXTRA'], 'utf8')) as {
            set: string;
            id: string;
            from: Lang;
            to: Lang;
            text: string;
            ref: string;
          }[])
        : [];
      const rows: Row[] = [];
      const cold: { from: string; to: string; beam: number; mask: string; k: number; ms: number }[] = [];
      const memory: {
        route: string;
        beam: number;
        mask: string;
        mib: number;
        cpuMsPerPhrase: number;
        affinity: string;
      }[] = [];
      const switching: { mask: string; ms: number[] } = { mask: '-', ms: [] };
      const tables: string[] = [];

      for (const run of plan.runs) {
        const mask = WINDOWS ? setMask(run.mask ?? ALL) : '-';
        const engine = new TranslationEngine({ program: () => program, models: store, log, beam: run.beam });
        const use = run.phrases === 0 ? phrases : phrases.slice(0, run.phrases);
        // Grouped by model, as one caption language keeps one model loaded.
        for (const route of ['indic-indic', 'indic-en', 'en-indic'] as const) {
          const dirs = DIRECTIONS.filter(([f, t]) => routeFor(f, t) === route);
          const [first] = dirs;
          if (!first) continue;
          for (let k = 0; k < run.cold; k++) {
            engine.stop();
            const p = phrases[(k * 7) % phrases.length];
            if (!p) continue;
            const t0 = performance.now();
            await engine.translate(p[first[0]], first[0], first[1]);
            cold.push({ from: first[0], to: first[1], beam: run.beam, mask, k, ms: performance.now() - t0 });
          }
          const before = helpers(program);
          let count = 0;
          for (const [from, to] of dirs) {
            for (const p of use) {
              const t0 = performance.now();
              const out = await engine.translate(p[from], from, to);
              const ms = performance.now() - t0;
              count += 1;
              rows.push({
                set: p.set,
                id: p.id,
                from,
                to,
                beam: run.beam,
                mask,
                ms,
                srcWords: words(p[from]),
                text: p[from],
                ref: p[to],
                out,
              });
            }
            const extraHere = run === plan.runs[0] ? extra.filter((e) => e.from === from && e.to === to) : [];
            for (const x of extraHere) {
              const t0 = performance.now();
              const out = await engine.translate(x.text, from, to);
              rows.push({
                set: x.set,
                id: x.id,
                from,
                to,
                beam: run.beam,
                mask,
                ms: performance.now() - t0,
                srcWords: words(x.text),
                text: x.text,
                ref: x.ref,
                out,
              });
            }
          }
          const after = helpers(program);
          const a = after[0];
          const b = before.find((h) => h.pid === a?.pid);
          if (a)
            memory.push({
              route,
              beam: run.beam,
              mask,
              mib: Math.round(a.mib),
              cpuMsPerPhrase: b ? Math.round((a.cpuMs - b.cpuMs) / Math.max(1, count)) : Number.NaN,
              affinity: a.affinity,
            });
        }
        // Two caption languages at once with one model loaded at a time: every phrase swaps the model.
        if (run === plan.runs[0]) {
          switching.mask = mask;
          for (let i = 0; i < plan.switching; i++) {
            const p = phrases[i];
            if (!p) continue;
            const to: Lang = i % 2 === 0 ? 'hi' : 'en';
            const t0 = performance.now();
            await engine.translate(p.gu, 'gu', to);
            switching.ms.push(performance.now() - t0);
          }
        }
        engine.stop();
        await sleep(500);
        const lines = [
          `| direction | beam | mask | phrases | words (src) | warm p50 / p95 / max ms | cold (restart) p50 / max ms |`,
          '|---|---:|---|---:|---|---|---|',
        ];
        for (const [from, to] of DIRECTIONS) {
          const r = rows.filter(
            (x) =>
              x.from === from &&
              x.to === to &&
              x.beam === run.beam &&
              x.mask === mask &&
              !x.set.startsWith('asr'),
          );
          const c = cold
            .filter((x) => x.from === from && x.to === to && x.beam === run.beam && x.mask === mask)
            .map((x) => x.ms);
          lines.push(
            `| ${from}->${to} | ${String(run.beam)} | ${mask} | ${String(r.length)} | ${String(Math.min(...r.map((x) => x.srcWords)))}-${String(Math.max(...r.map((x) => x.srcWords)))} | ${trio(r.map((x) => x.ms))} | ${c.length ? `${String(Math.round(quantile(c, 0.5)))} / ${String(Math.round(Math.max(...c)))}` : '-'} |`,
          );
        }
        tables.push(lines.join('\n'));
        console.log(`CAPLANG table beam ${String(run.beam)} mask ${mask}\n${lines.join('\n')}`);
      }

      // Sanskrit (local only): the measurement-only helper that also takes san_Deva, called directly with the Devanagari
      // pipeline (as Hindi's), since the app's engine knows only Gujarati, Hindi and English.
      const sanskrit: Row[] = [];
      const saHelper = env['CAPLANG_BENCH_SA_HELPER'];
      if (saHelper) {
        for (const [to, purpose] of [
          ['en', 'translation-hi-en'],
          ['hi', 'translation-gu-hi'],
          ['gu', 'translation-hi-gu'],
        ] as const) {
          const model = store.forPurpose(purpose)[0];
          if (!model) continue;
          const folder = dirname(model.files.find((f) => basename(f.path) === 'model.bin')?.path ?? '');
          const spm = model.files.find((f) => basename(f.path) === 'source.spm')?.path ?? '';
          const route = routeFor('hi', to);
          const h = new TranslationHelper({ program: saHelper, log });
          await h.start();
          await h.load(route, folder, spm, 2);
          for (const s of SANSKRIT) {
            const prepared = preprocess(s.sa, 'hi');
            const t0 = performance.now();
            const tokens = await h.translate(
              route,
              'san_Deva',
              to === 'en' ? 'eng_Latn' : to === 'hi' ? 'hin_Deva' : 'guj_Gujr',
              prepared.text,
              1,
            );
            const out = restoreSourceClockSpacing(
              s.sa,
              postprocess(decodeTokens(tokens), to, prepared.placeholders),
            );
            sanskrit.push({
              set: 'sanskrit12',
              id: s.id,
              from: 'sa',
              to,
              beam: 1,
              mask: '-',
              ms: performance.now() - t0,
              srcWords: words(s.sa),
              text: s.sa,
              ref: s[to],
              out,
            });
          }
          h.stop();
        }
        const lines = ['| direction | beam | phrases | warm p50 / p95 / max ms |', '|---|---:|---:|---|'];
        for (const to of ['en', 'hi', 'gu']) {
          const r = sanskrit.filter((x) => x.to === to);
          lines.push(`| sa->${to} | 1 | ${String(r.length)} | ${trio(r.map((x) => x.ms))} |`);
        }
        tables.push(lines.join('\n'));
        console.log(`CAPLANG table Sanskrit (measurement-only helper)\n${lines.join('\n')}`);
      }

      const memLines = [
        '| route | beam | mask | helper memory MiB | processor ms per phrase | helper mask |',
        '|---|---:|---|---:|---:|---|',
      ];
      for (const m of memory)
        memLines.push(
          `| ${m.route} | ${String(m.beam)} | ${m.mask} | ${String(m.mib)} | ${String(m.cpuMsPerPhrase)} | ${m.affinity} |`,
        );
      console.log(
        `CAPLANG memory (Windows: peak working set; Mac: resident after the run)\n${memLines.join('\n')}`,
      );
      console.log(
        `CAPLANG switching gu->hi / gu->en alternating (mask ${switching.mask}): ${switching.ms.map((x) => String(Math.round(x))).join(', ')} ms`,
      );
      // The first run's first cold start of each model: the store's file check comes with it (once a run).
      const firstMask = cold[0]?.mask;
      const firstUse = cold.filter((c) => c.k === 0 && c.beam === plan.runs[0]?.beam && c.mask === firstMask);
      console.log(
        `CAPLANG first use after start (file check, helper start, load, first phrase): ${firstUse.map((c) => `${c.from}->${c.to} ${String(Math.round(c.ms))} ms`).join('; ')}`,
      );

      const result = {
        plan,
        machine: {
          platform: process.platform,
          arch: process.arch,
          cpus: cpus().length,
          model: cpus()[0]?.model ?? '?',
        },
        rows,
        sanskrit,
        cold,
        memory,
        switching,
        tables,
      };
      const out = env['CAPLANG_BENCH_OUT'];
      if (out) writeFileSync(out, JSON.stringify(result, null, 1));
      else {
        // CI: the outputs too, in pieces (each line short enough for the job log).
        const json = JSON.stringify({
          rows: rows.map((r) => [r.from, r.to, r.beam, r.mask, r.set, r.id, Math.round(r.ms), r.out]),
          cold,
          memory,
          switching,
        });
        for (let i = 0; i < json.length; i += 3000)
          console.log(`CAPLANG-JSON|${String(i / 3000)}|${json.slice(i, i + 3000)}`);
      }
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.out.trim() !== '')).toBe(true);
    },
  );
});
