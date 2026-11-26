/*
 * Spoken times into digits before a caption phrase is translated (alpha.24, QA24-CAPLANG-2e; the owner's answer
 * 2e: "spoken times into digits first"). In a24-caplang2's reading of 336 machine translations, 7 of the 9 critical
 * errors were times said in words: "sava aath" (8:15) became 8:30, and 4:45 became 5:30 or "45 hours". The same
 * sentences with the times written as digits came through right 36 times of 36. So a phrase's times said in words
 * become digits ("સવા આઠ વાગ્યે" -> "8:15 વાગ્યે"), and everything else in it is left exactly as it came.
 *
 * - The digits are ASCII ("8:15", not "૮:૧૫"): the form measured in all three languages (Devanagari digits gave
 *   "4: 45 p.m." once), and the form the translator writes back.
 * - Only the words of the time change. The clock word after it (vagye, baje, o'clock) stays, as in the measured
 *   sentences ("8:15 વાગ્યે", "8:15 बजे"), and so do the words around it, unnormalised.
 * - Scripts: Gujarati speech in Gujarati letters, Hindi in Devanagari, English in Latin letters, as the recognisers
 *   write them (Route C and Whisper with the speaker's language chosen; translated captions need it chosen). No
 *   recognised set had romanised Gujarati or Hindi (cap-caplang2's ASR chain, 96 phrases), so none is read here.
 *   Digits the recogniser wrote (turbo writes "7" at times) are taken as an hour or minutes inside a time.
 * - Accuracy before coverage: anything not sure to be a time is left as spoken. Sava, sadha/saadhe, pona/paune,
 *   dodh/dedh and adhi/dhai are also everyday quantities ("સાડા ત્રણ કિલો", 3.5 kg; "डेढ़ घंटा", an hour and a half),
 *   so a quarter word is a time only with an hour after it and a clock word after that. An hour word is a time only
 *   with a clock word after it. Left as spoken, each marked UNSURE where it is decided below:
 *   - a quarter word without an hour ("सवा बजे", which can mean 1:15), or an hour without a clock word
 *     ("सुबह साढ़े आठ");
 *   - a range or an estimate ("सात-आठ बजे", "सात से साढ़े आठ बजे", "seven or eight o'clock"): a number just before;
 *   - a quarter word misheard as another word the recognisers were seen to write ("साधे", "પૂર્ણ"): the hour after
 *     it is left in words too, so the translation is not given a sure-looking wrong time;
 *   - English minutes to an hour ("twenty to nine", also a range), and an hour alone ("at eight").
 *   - Gujarati and Hindi word lists are the writer's, not a native reader's: the owner's reader checks them.
 *
 * A24-captrans calls it on each settled phrase before it goes to the translator. It is pure: no clock, no state.
 */

/** A word of the phrase: a run of letters, marks, digits and joiners, where it is, and its key to compare. */
interface Word {
  text: string;
  key: string;
  start: number;
  end: number;
}
/** What replaces words[from..to] (the words after them stay as they came). */
interface Match {
  from: number;
  to: number;
  text: string;
}

const WORD = /[\p{L}\p{M}\p{N}\u200c\u200d]+/gu;
/** The gap between two words of one time: spaces only. */
const SPACES = /^\s+$/u;
/** The gap between a number and the next word that makes them one count or estimate ("सात-आठ", "seven eight"). */
const JOINED = /^[\s\-\u2010-\u2015]+$/u;

/** Each list's words compared as NFC (साढ़े's ढ़ comes as one code point, U+095D, or as ढ and its nukta). */
const nfc = (word: string): string => word.normalize('NFC');
const setOf = (words: readonly string[]): ReadonlySet<string> => new Set(words.map(nfc));
const mapOf = (rows: readonly (readonly [number, readonly string[]])[]): ReadonlyMap<string, number> =>
  new Map(rows.flatMap(([n, words]) => words.map((w) => [nfc(w), n] as const)));

interface Rules {
  /** Hours 1-12 said in words. */
  hours: ReadonlyMap<string, number>;
  /** Minutes 1-59 said in words. */
  minutes: ReadonlyMap<string, number>;
  /** Quarter words before an hour: minutes added (paune/pona: a quarter to). */
  quarters: ReadonlyMap<string, number>;
  /** Half past one and half past two, said in one word (dodh/dedh, adhi/dhai), in minutes after midnight. */
  halves: ReadonlyMap<string, number>;
  /** Words after an hour that make it a time (at, until, of, will strike...): kept as spoken. */
  clock: ReadonlySet<string>;
  /** "X vagine Y minit" / "X bajkar Y minat": the word between the hour and the minutes. */
  past: ReadonlySet<string>;
  /** The minutes' word, and (Gujarati) its form that says "at", which becomes the clock word for "at". */
  minute: ReadonlySet<string>;
  minuteAt: ReadonlySet<string>;
  at: string;
  /** Words that join two numbers into a range or a choice ("से", "या", "કે"). */
  joiners: ReadonlySet<string>;
  /**
   * UNSURE (the owner's reader): words the recognisers wrote for a quarter word (cap-caplang2's ASR chain, the
   * generated clips): never read as one, but an hour after one is left in words too.
   */
  lookAlikes: ReadonlySet<string>;
  /** A number with an ending that makes it a range's start ("સાતથી", from seven): Gujarati joins it on. */
  fromEnding: RegExp | null;
  /** The digits this language's recognisers write besides ASCII. */
  zero: number;
}

/*
 * Gujarati. UNSURE (the owner's reader): every spelling here is the writer's; a word missing only leaves its time
 * as spoken, a word with a wrong number would be wrong. Minutes 1-59 in full.
 */
const GU_HOURS: readonly (readonly [number, readonly string[]])[] = [
  [1, ['એક']],
  [2, ['બે']],
  [3, ['ત્રણ']],
  [4, ['ચાર']],
  [5, ['પાંચ']],
  [6, ['છ']],
  [7, ['સાત']],
  [8, ['આઠ']],
  [9, ['નવ']],
  [10, ['દસ', 'દશ']],
  [11, ['અગિયાર', 'અગ્યાર']],
  [12, ['બાર']],
];
const GU_MINUTES: readonly (readonly [number, readonly string[]])[] = [
  ...GU_HOURS,
  [13, ['તેર']],
  [14, ['ચૌદ']],
  [15, ['પંદર']],
  [16, ['સોળ']],
  [17, ['સત્તર']],
  [18, ['અઢાર']],
  [19, ['ઓગણીસ']],
  [20, ['વીસ']],
  [21, ['એકવીસ']],
  [22, ['બાવીસ']],
  [23, ['તેવીસ']],
  [24, ['ચોવીસ']],
  [25, ['પચ્ચીસ', 'પચીસ']],
  [26, ['છવ્વીસ']],
  [27, ['સત્તાવીસ']],
  [28, ['અઠ્ઠાવીસ']],
  [29, ['ઓગણત્રીસ']],
  [30, ['ત્રીસ']],
  [31, ['એકત્રીસ']],
  [32, ['બત્રીસ']],
  [33, ['તેત્રીસ']],
  [34, ['ચોત્રીસ']],
  [35, ['પાંત્રીસ']],
  [36, ['છત્રીસ']],
  [37, ['સાડત્રીસ']],
  [38, ['આડત્રીસ']],
  [39, ['ઓગણચાલીસ']],
  [40, ['ચાલીસ']],
  [41, ['એકતાલીસ']],
  [42, ['બેતાલીસ']],
  [43, ['તેતાલીસ']],
  [44, ['ચુંમાલીસ']],
  [45, ['પિસ્તાલીસ']],
  [46, ['છેતાલીસ']],
  [47, ['સુડતાલીસ']],
  [48, ['અડતાલીસ']],
  [49, ['ઓગણપચાસ']],
  [50, ['પચાસ']],
  [51, ['એકાવન']],
  [52, ['બાવન']],
  [53, ['ત્રેપન']],
  [54, ['ચોપન']],
  [55, ['પંચાવન']],
  [56, ['છપ્પન']],
  [57, ['સત્તાવન']],
  [58, ['અઠ્ઠાવન']],
  [59, ['ઓગણસાઠ']],
];
const GUJARATI: Rules = {
  hours: mapOf(GU_HOURS),
  minutes: mapOf(GU_MINUTES),
  quarters: mapOf([
    [15, ['સવા']],
    [30, ['સાડા']],
    [-15, ['પોણા']],
  ]),
  halves: mapOf([
    [90, ['દોઢ']],
    [150, ['અઢી']],
  ]),
  // vage, vagye, vagya (it is ... o'clock), vagyo (one o'clock), vagyani/no/na/nu (of), vagyathi (from), vagshe
  // (will strike), vagvama (to: "five vagvama ten minutes"), vagvana/ni (about to), vagta (as it strikes), vagi
  // ("vagi gaya", it has struck). Not vagine: that one needs its minutes.
  clock: setOf([
    'વાગે',
    'વાગ્યે',
    'વાગ્યા',
    'વાગ્યાં',
    'વાગ્યો',
    'વાગી',
    'વાગ્યાની',
    'વાગ્યાનો',
    'વાગ્યાના',
    'વાગ્યાનું',
    'વાગ્યાનાં',
    'વાગ્યાથી',
    'વાગશે',
    'વાગવામાં',
    'વાગવાના',
    'વાગવાની',
    'વાગતાં',
    'વાગતા',
  ]),
  past: setOf(['વાગીને']),
  minute: setOf(['મિનિટ', 'મિનીટ']),
  // UNSURE (the owner's reader): "આઠ વાગીને પંદર મિનિટે" (at 8:15) becomes "8:15 વાગ્યે", the measured form for
  // "at"; "મિનિટ" alone becomes the time alone ("હવે 9:05 થઈ છે").
  minuteAt: setOf(['મિનિટે', 'મિનીટે']),
  at: 'વાગ્યે',
  joiners: setOf(['કે', 'અથવા', 'યા', 'ને', 'અને', 'થી']),
  lookAlikes: setOf(['સાળા', 'પૂર્ણ']),
  fromEnding: /^(.+)થી$/u,
  zero: 0x0ae6,
};

/* Hindi. UNSURE (the owner's reader): as Gujarati's, the writer's spellings; minutes 1-59 in full. */
const HI_HOURS: readonly (readonly [number, readonly string[]])[] = [
  [1, ['एक']],
  [2, ['दो']],
  [3, ['तीन']],
  [4, ['चार']],
  [5, ['पाँच', 'पांच']],
  // छे: as the recogniser (Whisper turbo) wrote six.
  [6, ['छह', 'छः', 'छे']],
  [7, ['सात']],
  [8, ['आठ']],
  [9, ['नौ']],
  [10, ['दस']],
  [11, ['ग्यारह']],
  // बारा: as the recogniser (Whisper turbo) wrote twelve.
  [12, ['बारह', 'बारा']],
];
const HI_MINUTES: readonly (readonly [number, readonly string[]])[] = [
  ...HI_HOURS,
  [13, ['तेरह']],
  [14, ['चौदह']],
  [15, ['पंद्रह', 'पन्द्रह']],
  [16, ['सोलह']],
  [17, ['सत्रह']],
  [18, ['अठारह']],
  [19, ['उन्नीस']],
  [20, ['बीस']],
  [21, ['इक्कीस']],
  [22, ['बाईस']],
  [23, ['तेईस']],
  [24, ['चौबीस']],
  [25, ['पच्चीस']],
  [26, ['छब्बीस']],
  [27, ['सत्ताईस']],
  [28, ['अट्ठाईस', 'अठ्ठाईस']],
  [29, ['उनतीस']],
  [30, ['तीस']],
  [31, ['इकतीस']],
  [32, ['बत्तीस']],
  [33, ['तैंतीस']],
  [34, ['चौंतीस']],
  [35, ['पैंतीस']],
  [36, ['छत्तीस']],
  [37, ['सैंतीस']],
  [38, ['अड़तीस']],
  [39, ['उनतालीस']],
  [40, ['चालीस']],
  [41, ['इकतालीस']],
  [42, ['बयालीस']],
  [43, ['तैंतालीस']],
  [44, ['चवालीस', 'चौवालीस']],
  [45, ['पैंतालीस']],
  [46, ['छियालीस']],
  [47, ['सैंतालीस']],
  [48, ['अड़तालीस']],
  [49, ['उनचास']],
  [50, ['पचास']],
  [51, ['इक्यावन']],
  [52, ['बावन']],
  [53, ['तिरपन']],
  [54, ['चौवन']],
  [55, ['पचपन']],
  [56, ['छप्पन']],
  [57, ['सत्तावन']],
  [58, ['अट्ठावन']],
  [59, ['उनसठ']],
];
const HINDI: Rules = {
  hours: mapOf(HI_HOURS),
  minutes: mapOf(HI_MINUTES),
  // साढ़े and डेढ़ with and without the nukta (a common way to type them; neither is another word).
  quarters: mapOf([
    [15, ['सवा']],
    [30, ['\u0938\u093e\u0922\u093c\u0947', '\u0938\u093e\u0922\u0947']],
    [-15, ['पौने']],
  ]),
  halves: mapOf([
    [90, ['\u0921\u0947\u0922\u093c', '\u0921\u0947\u0922']],
    [150, ['ढाई']],
  ]),
  // baje, baja (one o'clock), baj ("baj gaye", it has struck), bajenge/bajega (will be), bajne (about to; "bajne
  // mein", to), bajte (as it strikes). Not bajkar/bajke: those need their minutes.
  clock: setOf(['बजे', 'बजा', 'बज', 'बजेंगे', 'बजेगा', 'बजने', 'बजते']),
  past: setOf(['बजकर', 'बजके']),
  minute: setOf(['मिनट', 'मिनिट']),
  minuteAt: setOf([]),
  at: '',
  joiners: setOf(['से', 'या', 'और', 'व']),
  lookAlikes: setOf(['साधे', 'पॉने']),
  fromEnding: null,
  zero: 0x0966,
};

/** English words, compared in lower case. */
const EN_UNITS: readonly string[] = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_TEENS: readonly string[] = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS: readonly string[] = ['twenty', 'thirty', 'forty', 'fifty'];
const EN_HOURS = new Map([...EN_UNITS, 'ten', 'eleven', 'twelve'].map((w, i) => [w, i + 1] as const));
const EN_NUMBERS = new Set([
  'zero',
  ...EN_UNITS,
  ...EN_TEENS,
  ...EN_TENS,
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
]);
const EN_JOINERS = new Set(['or', 'to', 'and']);
/** Words before "H MM" that make it a time ("at eight fifteen", "it's eight fifteen"). */
const EN_BEFORE = new Set([
  'at',
  'by',
  'until',
  'till',
  'from',
  'around',
  'about',
  'before',
  'after',
  'since',
]);
/** What may follow "H MM" said after such a word: the phrase's end, a stop, or one of these words. */
const EN_AFTER =
  /^(?:\s*$|\s*[.,;:!?)]|\s+(?:and|or|on|at|in|sharp|tonight|today|tomorrow|then|please|exactly)(?![\p{L}\p{N}]))/iu;
/** What makes "H MM" a time with nothing before it: am, pm, in the morning... */
const EN_DAYTIME =
  /^\s+(?:a\.?m\.?|p\.?m\.?|in\s+the\s+(?:morning|afternoon|evening)|at\s+night)(?![\p{L}\p{N}])/iu;

const clockText = (hour: number, minutes: number): string => `${hour}:${String(minutes).padStart(2, '0')}`;
/** A quarter word's time: sava/saadhe add 15 or 30 minutes, paune/pona take 15 off (a quarter to one: 12:45). */
function quarterTime(hour: number, offset: number): string {
  if (offset >= 0) return clockText(hour, offset);
  return clockText(hour === 1 ? 12 : hour - 1, 60 + offset);
}

/** A word of digits as a number: ASCII, or this language's own digits (one script in a word). */
function digitsOf(word: string, zero: number): number | null {
  if (/^[0-9]{1,2}$/u.test(word)) return Number(word);
  if (zero === 0) return null;
  let n = 0;
  let count = 0;
  for (const ch of word) {
    const d = (ch.codePointAt(0) ?? 0) - zero;
    count += 1;
    if (d < 0 || d > 9 || count > 2) return null;
    n = n * 10 + d;
  }
  return count > 0 ? n : null;
}

function wordsOf(text: string, lower: boolean): Word[] {
  return [...text.matchAll(WORD)].map((m) => ({
    text: m[0],
    key: lower ? m[0].toLowerCase() : nfc(m[0]),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** The phrase with each match's words replaced, every other character as it came. */
function rewrite(text: string, words: readonly Word[], find: (i: number) => Match | null): string {
  let out = '';
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const match = find(i);
    if (!match) continue;
    const first = words[match.from];
    const last = words[match.to];
    if (!first || !last) continue;
    out += text.slice(cursor, first.start) + match.text;
    cursor = last.end;
    i = match.to;
  }
  return out + text.slice(cursor);
}

function normalizeIndic(text: string, r: Rules): string {
  const words = wordsOf(text, false);
  const gap = (i: number): string => {
    const a = words[i];
    const b = words[i + 1];
    return a && b ? text.slice(a.end, b.start) : '';
  };
  const spaced = (i: number): boolean => SPACES.test(gap(i));
  const key = (i: number): string => words[i]?.key ?? '';
  const hourAt = (i: number): number | null => {
    const word = words[i];
    if (!word) return null;
    const n = r.hours.get(word.key) ?? digitsOf(word.key, r.zero);
    return n !== null && n >= 1 && n <= 12 ? n : null;
  };
  const minutesAt = (i: number): number | null => {
    const word = words[i];
    if (!word) return null;
    const n = r.minutes.get(word.key) ?? digitsOf(word.key, r.zero);
    return n !== null && n >= 1 && n <= 59 ? n : null;
  };
  const numberLike = (i: number): boolean => {
    const k = key(i);
    if (k === '') return false;
    if (r.minutes.has(k) || r.quarters.has(k) || r.halves.has(k) || r.lookAlikes.has(k)) return true;
    if (/\p{N}/u.test(k)) return true;
    const stem = r.fromEnding?.exec(k)?.[1];
    return stem !== undefined && r.minutes.has(stem);
  };
  /**
   * UNSURE (the owner's reader): a number just before ("સાત આઠ વાગ્યે", "सात-आठ बजे"), or a number and a joiner
   * ("सात से साढ़े आठ बजे", "સાત કે આઠ"): an estimate or a range, left as spoken whole.
   */
  const inRange = (i: number): boolean => {
    if (i < 1) return false;
    if (numberLike(i - 1) && JOINED.test(gap(i - 1))) return true;
    return i >= 2 && r.joiners.has(key(i - 1)) && spaced(i - 1) && spaced(i - 2) && numberLike(i - 2);
  };

  return rewrite(text, words, (i) => {
    if (inRange(i)) return null;
    // An hour, vagine/bajkar, minutes, minit/minat: "આઠ વાગીને પંદર મિનિટે" -> "8:15 વાગ્યે", "आठ बजकर पंद्रह
    // मिनट" -> "8:15".
    const hour = hourAt(i);
    if (hour !== null && spaced(i) && r.past.has(key(i + 1)) && spaced(i + 1) && spaced(i + 2)) {
      const minutes = minutesAt(i + 2);
      const unit = key(i + 3);
      if (minutes !== null && r.minute.has(unit))
        return { from: i, to: i + 3, text: clockText(hour, minutes) };
      if (minutes !== null && r.minuteAt.has(unit))
        return { from: i, to: i + 3, text: `${clockText(hour, minutes)} ${r.at}` };
    }
    // A quarter word, an hour, a clock word: "સવા આઠ વાગ્યે" -> "8:15 વાગ્યે".
    const offset = r.quarters.get(key(i));
    if (offset !== undefined) {
      const after = hourAt(i + 1);
      if (after !== null && spaced(i) && spaced(i + 1) && r.clock.has(key(i + 2)))
        return { from: i, to: i + 1, text: quarterTime(after, offset) };
      return null;
    }
    // Dodh/dedh, adhi/dhai and a clock word: "ढाई बजे" -> "2:30 बजे".
    const half = r.halves.get(key(i));
    if (half !== undefined && spaced(i) && r.clock.has(key(i + 1)))
      return { from: i, to: i, text: clockText(Math.floor(half / 60), half % 60) };
    // An hour in words and a clock word: "છ વાગ્યે" -> "6 વાગ્યે".
    const word = words[i];
    if (word && r.hours.has(word.key) && hour !== null && spaced(i) && r.clock.has(key(i + 1)))
      return { from: i, to: i, text: String(hour) };
    return null;
  });
}

function normalizeEnglish(text: string): string {
  const words = wordsOf(text, true);
  const gap = (i: number): string => {
    const a = words[i];
    const b = words[i + 1];
    return a && b ? text.slice(a.end, b.start) : '';
  };
  const spaced = (i: number): boolean => SPACES.test(gap(i));
  const key = (i: number): string => words[i]?.key ?? '';
  const after = (i: number): string => {
    const word = words[i];
    return word ? text.slice(word.end) : '';
  };
  /** Not joined to the next word by a hyphen or an apostrophe ("eight-year-old", "eight's"). */
  const free = (i: number): boolean => !/^[-\u2010-\u2015'\u2019]\p{L}/u.test(after(i));
  const numberLike = (i: number): boolean => EN_NUMBERS.has(key(i)) || /\p{N}/u.test(key(i));
  const inRange = (i: number): boolean => {
    if (i < 1) return false;
    if (numberLike(i - 1) && JOINED.test(gap(i - 1))) return true;
    return i >= 2 && EN_JOINERS.has(key(i - 1)) && spaced(i - 1) && spaced(i - 2) && numberLike(i - 2);
  };
  const hourAt = (i: number, digits: boolean): number | null => {
    const n = EN_HOURS.get(key(i)) ?? (digits ? digitsOf(key(i), 0) : null);
    return n !== null && n >= 1 && n <= 12 ? n : null;
  };
  /** Minutes in words from word i: [the minutes, the last word], tens and a unit joined by a space or a hyphen. */
  const minutesFrom = (i: number, most: number): readonly [number, number] | null => {
    const k = key(i);
    let found: readonly [number, number] | null = null;
    if (k === 'oh' && spaced(i)) {
      const unit = EN_UNITS.indexOf(key(i + 1));
      if (unit >= 0) found = [unit + 1, i + 1];
    } else if (EN_TEENS.includes(k)) found = [10 + EN_TEENS.indexOf(k), i];
    else if (EN_TENS.includes(k)) {
      const tens = 20 + 10 * EN_TENS.indexOf(k);
      const unit = EN_UNITS.indexOf(key(i + 1));
      found = unit >= 0 && /^(?:\s+|-)$/u.test(gap(i)) ? [tens + unit + 1, i + 1] : [tens, i];
    } else if (EN_UNITS.includes(k)) found = [EN_UNITS.indexOf(k) + 1, i];
    return found && found[0] <= most ? found : null;
  };
  /** "at", "by"..., or "it is", "it's", "it was" just before word i. */
  const timeWordBefore = (i: number): boolean => {
    if (i >= 1 && spaced(i - 1) && EN_BEFORE.has(key(i - 1))) return true;
    if (i >= 2 && spaced(i - 1) && (key(i - 1) === 'is' || key(i - 1) === 'was'))
      return key(i - 2) === 'it' && spaced(i - 2);
    return (
      i >= 2 && spaced(i - 1) && key(i - 1) === 's' && /^['\u2019]$/u.test(gap(i - 2)) && key(i - 2) === 'it'
    );
  };

  return rewrite(text, words, (i) => {
    if (inRange(i)) return null;
    // (a) quarter past H, a quarter to H, half past H, M (minutes) past H. "M to H" is left as spoken: UNSURE,
    // "five to ten" is as often a range.
    let q = i;
    if (key(q) === 'a' && spaced(q) && key(q + 1) === 'quarter') q += 1;
    let offset: number | null = null;
    /** The word "past" or "to". */
    let link = -1;
    if (key(q) === 'quarter' && spaced(q) && (key(q + 1) === 'past' || key(q + 1) === 'to')) {
      offset = key(q + 1) === 'past' ? 15 : -15;
      link = q + 1;
    } else if (q === i && key(q) === 'half' && spaced(q) && key(q + 1) === 'past') {
      offset = 30;
      link = q + 1;
    } else if (q === i) {
      const minutes = minutesFrom(i, 29);
      if (minutes && spaced(minutes[1])) {
        let w = minutes[1] + 1;
        if ((key(w) === 'minutes' || key(w) === 'minute') && spaced(w)) w += 1;
        if (key(w) === 'past') {
          offset = minutes[0];
          link = w;
        }
      }
    }
    if (offset !== null) {
      const hour = spaced(link) ? hourAt(link + 1, true) : null;
      if (hour === null || !free(link + 1)) return null;
      return { from: i, to: link + 1, text: quarterTime(hour, offset) };
    }
    // H o'clock: "eight o'clock" -> "8 o'clock".
    const hour = hourAt(i, false);
    if (hour === null) return null;
    if (spaced(i) && key(i + 1) === 'o' && /^['\u2019]$/u.test(gap(i + 1)) && key(i + 2) === 'clock')
      return { from: i, to: i, text: String(hour) };
    // H MM: "at eight fifteen" -> "at 8:15", only after a time word or before am, pm, in the morning...
    if (!spaced(i)) return null;
    // Minutes from ten up, or "oh five": "eight five" is two numbers.
    const minutes = minutesFrom(i + 1, 59);
    if (!minutes || EN_UNITS.includes(key(i + 1)) || !free(minutes[1])) return null;
    const rest = after(minutes[1]);
    if (EN_DAYTIME.test(rest) || (timeWordBefore(i) && EN_AFTER.test(rest)))
      return { from: i, to: minutes[1], text: clockText(hour, minutes[0]) };
    return null;
  });
}

/**
 * A caption phrase with its times said in words written as digits, for the translator (QA24-CAPLANG-2e). Gujarati
 * and Hindi: the quarter words with an hour and a clock word ("સવા આઠ વાગ્યે" -> "8:15 વાગ્યે", "पौने पाँच बजे" ->
 * "4:45 बजे"), dodh/dedh and adhi/dhai ("ढाई बजे" -> "2:30 बजे"), an hour and minutes ("आठ बजकर पंद्रह मिनट" ->
 * "8:15"), and an hour before a clock word ("छह बजे" -> "6 बजे"). English: quarter past, half past, a quarter to,
 * minutes past, o'clock, and "eight fifteen" where it is sure to be a time. Anything else, and anything not sure to
 * be a time, is left exactly as it came.
 */
export function normalizeSpokenTimes(text: string, lang: 'gu' | 'hi' | 'en'): string {
  if (lang === 'en') return normalizeEnglish(text);
  return normalizeIndic(text, lang === 'gu' ? GUJARATI : HINDI);
}
