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

/** The scripts Drashti tells apart: Gujarati, Devanagari (Hindi) and Latin. */
export type Script = 'gu' | 'hi' | 'latin';

/** The script most of the text's letters are in; null when it has none. */
export function scriptOf(text: string): Script | null {
  const gu = count(text, GUJARATI);
  const hi = count(text, DEVANAGARI);
  const latin = count(text, LATIN);
  const most = Math.max(gu, hi, latin);
  if (most === 0) return null;
  if (gu === most) return 'gu';
  return hi === most ? 'hi' : 'latin';
}

/**
 * The language of a line of words. Its script decides Gujarati or Hindi
 * whatever it was marked as; Latin letters keep what they were marked as
 * (English or transliteration), since plain transliteration looks like
 * English, and otherwise accent marks decide. Null for a line without letters.
 */
export function langOfLine(marked: Lang | null | undefined, text: string): Lang | null {
  const script = scriptOf(text);
  if (script === null) return null;
  if (script !== 'latin') return script;
  if (marked === 'en' || marked === 'translit') return marked;
  return detectLang(text) === 'translit' ? 'translit' : 'en';
}

/** All the runs' text, joined. */
export function runsText(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

/** Equal as data (shadows and outlines can be objects). */
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const sameStyle = (a: TextRun, b: TextRun) =>
  a.font === b.font &&
  a.size === b.size &&
  a.color === b.color &&
  a.weight === b.weight &&
  a.italic === b.italic &&
  a.letterSpacing === b.letterSpacing &&
  same(a.shadow, b.shadow) &&
  same(a.outline, b.outline) &&
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

/** Runs cut at line ends (each piece keeps its line break), so each line can have its own language. */
export function cutAtLines(runs: readonly TextRun[]): TextRun[] {
  return runs.flatMap((run) => {
    if (!run.text.includes('\n')) return [run];
    const parts = run.text.split('\n');
    return parts
      .map((part, i) => ({ ...run, text: i < parts.length - 1 ? `${part}\n` : part }))
      .filter((r) => r.text !== '');
  });
}

/**
 * Fill in each run's language from its script where the source gave none,
 * line by line: a run that goes on over a line break into another script
 * (a Gujarati line, then its transliteration) is cut there, so each line is
 * in its own language. Line breaks and punctuation-only runs keep no
 * language (they inherit the element's). Legacy-font runs are left alone:
 * their Latin codes are not English.
 */
export function withDetectedLangs(runs: readonly TextRun[]): TextRun[] {
  if (!runs.some((r) => r.lang === undefined && !r.legacy)) return [...runs];
  return mergeRuns(
    runs.flatMap((run) => {
      if (run.lang !== undefined || run.legacy) return [run];
      const pieces = cutAtLines([run]);
      const langs = pieces.map((p) => detectLang(p.text));
      return pieces.map((piece, i) => {
        // A piece without letters (a blank line) goes with its neighbour in the same run.
        const lang =
          langs[i] ?? langs.slice(0, i).findLast((l) => l !== null) ?? langs.find((l) => l !== null);
        return lang ? { ...piece, lang } : piece;
      });
    }),
  );
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
