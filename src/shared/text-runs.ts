import type { Lang, TextRun } from './model';

/*
 * Helpers for styled text runs: joining, tidying, and telling a run's
 * language from its script when the source does not say.
 */

const GUJARATI = /[\u0A80-\u0AFF]/gu;
// Two classes: Devanagari Extended starts with a combining mark, which cannot follow another class member.
const DEVANAGARI = /[\u0900-\u097F]|[\uA8E0-\uA8FF]/gu;
const LATIN = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/gu;
/** Letters with the diacritics of IAST-style transliteration (ā, ī, ṣ, ṇ, ṁ, ...). */
const IAST =
  /[\u0101\u012B\u016B\u1E5B\u1E5D\u1E37\u1E39\u0113\u014D\u1E45\u00F1\u1E6D\u1E0D\u1E47\u015B\u1E63\u1E25\u1E41\u1E43\u0100\u012A\u016A\u1E5A\u1E5C\u1E36\u1E38\u0112\u014C\u1E44\u00D1\u1E6C\u1E0C\u1E46\u015A\u1E62\u1E24\u1E40\u1E42]/u;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/**
 * The language a piece of text is written in, from its script: Gujarati,
 * Devanagari (Hindi), Latin with transliteration diacritics, or other Latin
 * (English). Null when it has no letters. Mixed text goes by the majority.
 */
export function detectLang(text: string): Lang | null {
  const gu = count(text, GUJARATI);
  const hi = count(text, DEVANAGARI);
  const latin = count(text, LATIN);
  const most = Math.max(gu, hi, latin);
  if (most === 0) return null;
  if (gu === most) return 'gu';
  if (hi === most) return 'hi';
  return IAST.test(text.normalize('NFC')) ? 'translit' : 'en';
}

/** All the runs' text, joined. */
export function runsText(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

const sameStyle = (a: TextRun, b: TextRun) =>
  a.font === b.font &&
  a.size === b.size &&
  a.color === b.color &&
  a.weight === b.weight &&
  a.italic === b.italic &&
  a.letterSpacing === b.letterSpacing &&
  a.lang === b.lang &&
  a.legacy === b.legacy;

/** Drop empty runs and merge neighbours that look the same. */
export function mergeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const last = out.at(-1);
    if (last && sameStyle(last, run)) out[out.length - 1] = { ...last, text: last.text + run.text };
    else out.push({ ...run });
  }
  return out;
}

/**
 * Fill in each run's language from its script where the source gave none.
 * Line breaks and punctuation-only runs keep no language (they inherit the
 * element's). Legacy-font runs are left alone: their Latin codes are not English.
 */
export function withDetectedLangs(runs: readonly TextRun[]): TextRun[] {
  return runs.map((run) => {
    if (run.lang !== undefined || run.legacy) return run;
    const lang = detectLang(run.text);
    return lang ? { ...run, lang } : run;
  });
}

/**
 * The element's main language. Gujarati or Hindi whenever the box has any:
 * Latin text beside them is nearly always their transliteration or
 * translation. Otherwise the language with the most letters.
 */
export function mainLang(runs: readonly TextRun[]): Lang | null {
  const letters = new Map<Lang, number>();
  for (const run of runs) {
    const lang = run.lang ?? (run.legacy ? null : detectLang(run.text));
    if (!lang) continue;
    // Base letters only: vowel signs and viramas are combining marks.
    letters.set(lang, (letters.get(lang) ?? 0) + run.text.replace(/[\s\p{M}]/gu, '').length);
  }
  const most = (langs: Lang[]): Lang | null => {
    let best: Lang | null = null;
    let count = 0;
    for (const lang of langs) {
      const n = letters.get(lang) ?? 0;
      if (n > count) [best, count] = [lang, n];
    }
    return best;
  };
  return most(['gu', 'hi']) ?? most(['translit', 'en']);
}
