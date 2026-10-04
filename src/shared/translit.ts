/*
 * Rule-based transliteration (PLAN.md 3): Gujarati and Devanagari (Hindi)
 * to Roman letters, in two styles.
 *
 * - Plain (the default): no accent marks, spelt as people usually write
 *   these words in Roman letters ("Swami", "bhagwan", "darshan").
 * - With accent marks: ISO 15919 ("svāmī", "bhagvān", "darśan").
 *
 * Words read as they are said: the "a" every consonant carries is dropped
 * at the end of a word ("ghar", not "ghara") and in the middle where it is
 * not said ("bachpan", "akshardham"), but kept after a cluster ending in y,
 * r, l, v or a nasal ("satya", "mitra", "dharma") and in words of one
 * letter. Gujarati and Devanagari share one table (Unicode lays the two
 * scripts out in parallel); where they are said differently the word's
 * script decides: ઋ is "ru" and જ્ઞ "gn" in Gujarati, ऋ "ri" and ज्ञ "gy"
 * in Hindi. Anything else (spaces, punctuation, Latin letters) is kept as
 * it is; digits become 0 to 9.
 */

export type TranslitStyle = 'plain' | 'iso';
export const TRANSLIT_STYLES: readonly TranslitStyle[] = ['plain', 'iso'];

type IndicScript = 'gu' | 'hi';
/** [ISO 15919, plain]; plain may differ by script. */
type Roman = readonly [iso: string, plain: string | Readonly<Record<IndicScript, string>>];

const BASE: Record<IndicScript, number> = { hi: 0x900, gu: 0xa80 };

/** Consonants, by their place in the block (the same in both scripts). */
const CONSONANTS: Readonly<Record<number, Roman>> = {
  0x15: ['k', 'k'],
  0x16: ['kh', 'kh'],
  0x17: ['g', 'g'],
  0x18: ['gh', 'gh'],
  0x19: ['ṅ', 'n'],
  0x1a: ['c', 'ch'],
  0x1b: ['ch', 'chh'],
  0x1c: ['j', 'j'],
  0x1d: ['jh', 'jh'],
  0x1e: ['ñ', 'n'],
  0x1f: ['ṭ', 't'],
  0x20: ['ṭh', 'th'],
  0x21: ['ḍ', 'd'],
  0x22: ['ḍh', 'dh'],
  0x23: ['ṇ', 'n'],
  0x24: ['t', 't'],
  0x25: ['th', 'th'],
  0x26: ['d', 'd'],
  0x27: ['dh', 'dh'],
  0x28: ['n', 'n'],
  0x2a: ['p', 'p'],
  0x2b: ['ph', 'ph'],
  0x2c: ['b', 'b'],
  0x2d: ['bh', 'bh'],
  0x2e: ['m', 'm'],
  0x2f: ['y', 'y'],
  0x30: ['r', 'r'],
  0x32: ['l', 'l'],
  // ળ (Gujarati) and ळ.
  0x33: ['ḷ', 'l'],
  0x35: ['v', 'v'],
  0x36: ['ś', 'sh'],
  0x37: ['ṣ', 'sh'],
  0x38: ['s', 's'],
  0x39: ['h', 'h'],
  // ૹ (Gujarati only).
  0x79: ['ẓh', 'zh'],
};

/** A consonant with a nukta under it (sounds from Persian, Arabic and English, and ड़ ढ़). */
const NUKTA: Readonly<Record<number, Roman>> = {
  0x15: ['q', 'k'],
  0x16: ['k͟h', 'kh'],
  0x17: ['ġ', 'g'],
  0x1c: ['z', 'z'],
  0x1d: ['ž', 'zh'],
  0x21: ['ṛ', 'd'],
  0x22: ['ṛh', 'dh'],
  0x28: ['ṉ', 'n'],
  0x2b: ['f', 'f'],
  0x2f: ['ẏ', 'y'],
  0x30: ['ṟ', 'r'],
  0x33: ['ḻ', 'l'],
};

/** Letters that already have the nukta in them (Devanagari), as their consonant and the nukta. */
const WITH_NUKTA: Readonly<Record<number, number>> = {
  0x29: 0x28,
  0x31: 0x30,
  0x34: 0x33,
  0x58: 0x15,
  0x59: 0x16,
  0x5a: 0x17,
  0x5b: 0x1c,
  0x5c: 0x21,
  0x5d: 0x22,
  0x5e: 0x2b,
  0x5f: 0x2f,
};

const R_VOWEL = { gu: 'ru', hi: 'ri' } as const;
const L_VOWEL = { gu: 'lru', hi: 'lri' } as const;

/** Vowels written on their own. */
const VOWELS: Readonly<Record<number, Roman>> = {
  0x04: ['a', 'a'],
  0x05: ['a', 'a'],
  0x06: ['ā', 'a'],
  0x07: ['i', 'i'],
  0x08: ['ī', 'i'],
  0x09: ['u', 'u'],
  0x0a: ['ū', 'u'],
  0x0b: ['r̥', R_VOWEL],
  0x0c: ['l̥', L_VOWEL],
  // ઍ and ऍ, the open e of English loanwords ("bank"); ऎ is the short e of other languages.
  0x0d: ['ê', 'a'],
  0x0e: ['e', 'e'],
  0x0f: ['ē', 'e'],
  0x10: ['ai', 'ai'],
  // ઑ and ऑ, the open o.
  0x11: ['ô', 'o'],
  0x12: ['o', 'o'],
  0x13: ['ō', 'o'],
  0x14: ['au', 'au'],
  0x60: ['r̥̄', R_VOWEL],
  0x61: ['l̥̄', L_VOWEL],
  0x72: ['ê', 'a'],
};

/** Vowel signs, after a consonant. */
const SIGNS: Readonly<Record<number, Roman>> = {
  0x3e: ['ā', 'a'],
  0x3f: ['i', 'i'],
  0x40: ['ī', 'i'],
  0x41: ['u', 'u'],
  0x42: ['ū', 'u'],
  0x43: ['r̥', R_VOWEL],
  0x44: ['r̥̄', R_VOWEL],
  0x45: ['ê', 'a'],
  0x46: ['e', 'e'],
  0x47: ['ē', 'e'],
  0x48: ['ai', 'ai'],
  0x49: ['ô', 'o'],
  0x4a: ['o', 'o'],
  0x4b: ['ō', 'o'],
  0x4c: ['au', 'au'],
  0x62: ['l̥', L_VOWEL],
  0x63: ['l̥̄', L_VOWEL],
};

const CANDRABINDU = 0x01;
const ANUSVARA = 0x02;
const VISARGA = 0x03;
const NUKTA_SIGN = 0x3c;
const AVAGRAHA = 0x3d;
const VIRAMA = 0x4d;
const OM = 0x50;
const ZWJ = 0x200d;
const ZWNJ = 0x200c;

/** The script and place in its block of a character, or null for anything else. */
function placeOf(cp: number): { script: IndicScript; at: number } | null {
  if (cp >= 0x900 && cp <= 0x97f) return { script: 'hi', at: cp - BASE.hi };
  if (cp >= 0xa80 && cp <= 0xaff) return { script: 'gu', at: cp - BASE.gu };
  return null;
}

const pick = (r: Roman, style: TranslitStyle, script: IndicScript): string =>
  style === 'iso' ? r[0] : typeof r[1] === 'string' ? r[1] : r[1][script];

/** One consonant of a cluster: its place, and whether a nukta follows it. */
interface Consonant {
  at: number;
  nukta: boolean;
}

/** A syllable: consonants (none for a vowel on its own), its vowel, and what is said after it. */
interface Syllable {
  consonants: Consonant[];
  /**
   * 'inherent': the "a" a consonant carries; 'sign': a vowel sign; 'none':
   * a virama ends it; 'own': a vowel written on its own.
   */
  vowel: { kind: 'inherent' | 'sign' | 'none' | 'own'; at: number };
  /** Anusvara, chandrabindu and visarga after it, in order. */
  marks: number[];
  /** Its "a" is not said (schwa deletion). */
  silent: boolean;
}

/** A piece of the text: a word in one script, or anything else as it is. */
type Piece =
  | { kind: 'word'; script: IndicScript; syllables: Syllable[] }
  | { kind: 'other'; text: string; script: IndicScript | null };

const isWordPart = (at: number) =>
  CONSONANTS[at] !== undefined ||
  WITH_NUKTA[at] !== undefined ||
  VOWELS[at] !== undefined ||
  SIGNS[at] !== undefined ||
  at === CANDRABINDU ||
  at === ANUSVARA ||
  at === VISARGA ||
  at === NUKTA_SIGN ||
  at === VIRAMA ||
  at === AVAGRAHA;

/** Split text into words (syllable by syllable) and everything between them. */
function pieces(text: string): Piece[] {
  const cps: number[] = [];
  for (const ch of text) cps.push(ch.codePointAt(0) ?? 0);
  const out: Piece[] = [];
  let i = 0;
  const other = (s: string, script: IndicScript | null) => {
    const last = out.at(-1);
    if (last?.kind === 'other' && last.script === script) last.text += s;
    else out.push({ kind: 'other', text: s, script });
  };
  while (i < cps.length) {
    const cp = cps[i] ?? 0;
    const place = placeOf(cp);
    if (!place || !isWordPart(place.at)) {
      other(String.fromCodePoint(cp), place?.script ?? null);
      i++;
      continue;
    }
    const script = place.script;
    const syllables: Syllable[] = [];
    // One word: characters of this script that make up words (joiners are skipped).
    const at = (k: number): number | null => {
      const c = cps[k];
      if (c === undefined) return null;
      const p = placeOf(c);
      return p?.script === script && isWordPart(p.at) ? p.at : null;
    };
    const skipJoiners = () => {
      while (cps[i] === ZWJ || cps[i] === ZWNJ) i++;
    };
    /** A consonant at i (with any nukta after it), or null. */
    const consonant = (): Consonant | null => {
      const a = at(i);
      if (a === null) return null;
      const pre = WITH_NUKTA[a];
      if (pre !== undefined) {
        i++;
        return { at: pre, nukta: true };
      }
      if (CONSONANTS[a] === undefined) return null;
      i++;
      if (at(i) === NUKTA_SIGN) {
        i++;
        return { at: a, nukta: true };
      }
      return { at: a, nukta: false };
    };
    for (let a = at(i); a !== null; a = at(i)) {
      if (VOWELS[a] !== undefined) {
        i++;
        syllables.push({ consonants: [], vowel: { kind: 'own', at: a }, marks: [], silent: false });
      } else if (CONSONANTS[a] !== undefined || WITH_NUKTA[a] !== undefined) {
        const cluster: Consonant[] = [];
        let c = consonant();
        let vowel: Syllable['vowel'] = { kind: 'inherent', at: 0 };
        while (c) {
          cluster.push(c);
          skipJoiners();
          const next = at(i);
          if (next === VIRAMA) {
            i++;
            skipJoiners();
            c = consonant();
            if (!c) vowel = { kind: 'none', at: VIRAMA };
          } else {
            if (next !== null && SIGNS[next] !== undefined) {
              i++;
              vowel = { kind: 'sign', at: next };
            }
            c = null;
          }
        }
        syllables.push({ consonants: cluster, vowel, marks: [], silent: false });
      } else if (a === CANDRABINDU || a === ANUSVARA || a === VISARGA) {
        i++;
        const last = syllables.at(-1);
        if (last) last.marks.push(a);
        else syllables.push({ consonants: [], vowel: { kind: 'own', at: 0x00 }, marks: [a], silent: false });
      } else if (a === AVAGRAHA) {
        i++;
        syllables.push({ consonants: [], vowel: { kind: 'own', at: AVAGRAHA }, marks: [], silent: false });
      } else {
        // A stray sign (a nukta or virama with nothing before it): left out.
        i++;
      }
      skipJoiners();
    }
    if (syllables.length > 0) out.push({ kind: 'word', script, syllables });
  }
  return out;
}

const SONORANT_END = new Set([0x2f, 0x30, 0x32, 0x35, 0x19, 0x1e, 0x23, 0x28, 0x2e]);
const NASALS = new Set([0x19, 0x1e, 0x23, 0x28, 0x2e]);
const LABIALS = new Set([0x2a, 0x2b, 0x2c, 0x2d, 0x2e]);

/** Whether a syllable's vowel is said: its own, a sign, or an "a" that was kept. */
const voiced = (s: Syllable | undefined) =>
  s !== undefined && s.vowel.kind !== 'none' && !(s.vowel.kind === 'inherent' && s.silent);

/**
 * Schwa deletion. The "a" of the last syllable goes, unless the word is one
 * syllable or ends in a cluster whose last consonant is y, r, l, v or a
 * nasal (or h then a nasal). Then, from the end towards the start, the "a"
 * of a one-consonant syllable goes when a said vowel comes before it and
 * the next syllable is one consonant with a said vowel ("kamala" → "kamla",
 * "bachapan" → "bachpan"). The first syllable keeps its "a", and so does a
 * syllable with an anusvara, chandrabindu or visarga.
 */
function dropSchwas(syllables: Syllable[]): void {
  const last = syllables.at(-1);
  if (last && syllables.length > 1 && last.vowel.kind === 'inherent' && last.marks.length === 0) {
    const ends = last.consonants.map((c) => c.at);
    const final = ends.at(-1) ?? 0;
    const keep = ends.length > 1 && (SONORANT_END.has(final) || (ends.at(-2) === 0x39 && NASALS.has(final)));
    if (!keep) last.silent = true;
  }
  for (let k = syllables.length - 2; k >= 1; k--) {
    const s = syllables[k];
    if (s?.vowel.kind !== 'inherent' || s.marks.length > 0 || s.consonants.length !== 1) continue;
    const next = syllables[k + 1];
    if (voiced(syllables[k - 1]) && next?.consonants.length === 1 && voiced(next)) s.silent = true;
  }
}

/** A consonant in letters, in this style and script. */
function consonantText(c: Consonant, style: TranslitStyle, script: IndicScript): string {
  const r = (c.nukta ? NUKTA[c.at] : undefined) ?? CONSONANTS[c.at];
  return r ? pick(r, style, script) : '';
}

/** A word in letters. Sanskrit says every "a" (dharmakṣetre, not dharmkṣetr): no schwa is dropped. */
function wordText(
  script: IndicScript,
  syllables: Syllable[],
  style: TranslitStyle,
  sanskrit: boolean,
): string {
  if (!sanskrit) dropSchwas(syllables);
  const plain = style === 'plain';
  let out = '';
  /** The last sound written was a consonant (and which), for the plain v → w. */
  let afterConsonant: number | null = null;
  syllables.forEach((s, n) => {
    const cs = s.consonants;
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      if (!c) break;
      const nextC = cs[k + 1];
      // ज्ञ / જ્ઞ: "jñ" with marks; said "gy" in Hindi and "gn" in Gujarati.
      if (c.at === 0x1c && !c.nukta && nextC?.at === 0x1e) {
        out += plain ? (script === 'gu' ? 'gn' : 'gy') : 'jñ';
        k++;
        afterConsonant = 0x1e;
        continue;
      }
      let t = consonantText(c, style, script);
      // Plain: v after another consonant (but r or l) is said, and usually written, w: "swami", "bhagwan".
      if (
        plain &&
        c.at === 0x35 &&
        !c.nukta &&
        afterConsonant !== null &&
        afterConsonant !== 0x30 &&
        afterConsonant !== 0x32
      )
        t = 'w';
      out += t;
      afterConsonant = c.at;
    }
    const v = s.vowel;
    if (v.kind === 'inherent') {
      if (!s.silent) {
        out += 'a';
        afterConsonant = null;
      }
    } else if (v.kind === 'sign') {
      const r = SIGNS[v.at];
      if (r) out += pick(r, style, script);
      afterConsonant = null;
    } else if (v.kind === 'own') {
      if (v.at === AVAGRAHA) out += plain ? '' : '’';
      else {
        const r = VOWELS[v.at];
        let t = r ? pick(r, style, script) : '';
        // With marks, a and i or u said apart are written aï, aü (not the diphthongs ai, au).
        if (!plain && out.endsWith('a') && (t === 'i' || t === 'u')) t = t === 'i' ? 'ï' : 'ü';
        out += t;
      }
      afterConsonant = null;
    }
    for (const m of s.marks) {
      if (m === VISARGA) {
        // Plain: h at the end of a word; before a consonant it is not said ("dukh").
        const next = syllables[n + 1];
        out += plain ? (next && next.consonants.length > 0 ? '' : 'h') : 'ḥ';
      } else if (m === ANUSVARA) {
        const next = syllables[n + 1]?.consonants[0];
        out += plain ? (next && LABIALS.has(next.at) ? 'm' : 'n') : 'ṁ';
      } else out += plain ? 'n' : 'm̐';
      afterConsonant = null;
    }
  });
  return out;
}

/** Numerals and punctuation of the two scripts. */
function otherText(text: string, style: TranslitStyle): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const place = placeOf(cp);
    if (!place) {
      out += ch;
      continue;
    }
    const at = place.at;
    if (at >= 0x66 && at <= 0x6f) out += String(at - 0x66);
    else if (at === 0x64) out += '|';
    else if (at === 0x65) out += '||';
    else if (at === 0x70) out += '.';
    else if (at === OM) out += style === 'iso' ? 'ōṁ' : 'om';
    else if (place.script === 'gu' && at === 0x71) out += '₹';
    // Anything else of these blocks Drashti does not know is left out.
  }
  return out;
}

/**
 * Gujarati and Devanagari in the text, in Roman letters; everything else as
 * it is. `sanskrit`: the text is Sanskrit, which keeps every "a".
 */
export function transliterate(
  text: string,
  style: TranslitStyle = 'plain',
  { sanskrit = false }: { sanskrit?: boolean } = {},
): string {
  return pieces(text)
    .map((p) =>
      p.kind === 'word' ? wordText(p.script, p.syllables, style, sanskrit) : otherText(p.text, style),
    )
    .join('');
}

/** A line with its first letter a capital, as a transliterated line starts. */
export function capitalize(line: string): string {
  const at = line.search(/\p{L}/u);
  if (at < 0) return line;
  return `${line.slice(0, at)}${(line[at] ?? '').toLocaleUpperCase('en')}${line.slice(at + 1)}`;
}

/** Whether the text has Gujarati or Devanagari letters to transliterate. */
export const hasIndic = (text: string): boolean => /[ऀ-ॿ઀-૿]/u.test(text);

/** A spelling's letters only, without accent marks or the usual variations ("w" and "v", "sh" and "s"...). */
function skeleton(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/gu, '')
    .replace(/w/gu, 'v')
    .replace(/ee/gu, 'i')
    .replace(/oo/gu, 'u')
    .replace(/aa/gu, 'a')
    .replace(/([ckstdpgjb])h/gu, '$1')
    .replace(/z/gu, 'j')
    .replace(/q/gu, 'k')
    .replace(/f/gu, 'p');
}

/** How many single-letter changes turn one into the other. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length] ?? 0;
}

/**
 * Whether a line in Latin letters reads like a Gujarati or Hindi line (its
 * transliteration, however it is spelt), rather than other words such as
 * its meaning: plain transliteration has no accent marks to tell it by.
 */
export function readsLike(latin: string, indic: string): boolean {
  const a = skeleton(latin);
  const b = skeleton(transliterate(indic, 'plain'));
  if (a.length < 2 || b.length < 2) return false;
  return 1 - distance(a, b) / Math.max(a.length, b.length) >= 0.6;
}
