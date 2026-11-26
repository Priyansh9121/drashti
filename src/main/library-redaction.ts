import type { Db } from './db/database';

const HIDDEN = '[library name]';

/** Names the library holds, to blank out wherever they appear. */
export function libraryNames(db: Db): string[] {
  const rows = db
    .prepare(
      `SELECT name AS n FROM presentations UNION SELECT name FROM playlists UNION SELECT name FROM media
       UNION SELECT name FROM props UNION SELECT name FROM messages UNION SELECT template FROM messages
       UNION SELECT name FROM timers UNION SELECT name FROM slide_groups UNION SELECT label FROM playlist_items`,
    )
    .pluck()
    .all() as (string | null)[];
  // Short names ("A", "Hi") would blank out ordinary words; they are left.
  return [...new Set(rows.filter((n): n is string => typeof n === 'string').map((n) => n.trim()))].filter(
    (n) => n.length >= 3,
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/*
 * A name of five letters or more is blanked wherever it is, inside other words too, as before alpha.24 (the owner's
 * QA24-DIAG-2: "Hide long names inside words (Recommended)"), and so is any name with a letter of Gujarati, Devanagari,
 * another Indic script or Hangul, however few its letters: those write compounds and endings joined (the review's G1). Letters are counted as a reader counts them (\p{L}): a
 * vowel sign or a virama is part of its letter, not one more ("નમસ્તે" has four), and the count is the same on every
 * computer (a grapheme count would follow the version of ICU, whose Indic conjunct rules changed in Unicode 15.1).
 *
 * A shorter name is blanked only where it is the name (QA24-DIAG-1: a library name "new" blanked the "new" of "newest"
 * in the crash files' heading, and inside the words of a Quit line), but wherever a word could start or end in a name
 * glued to other text (the review's F1, F2, R1 and lead 2's D1 A: privacy first).
 * - A word is made of letters, marks (the vowel signs and viramas of Gujarati and Devanagari) and digits, with the
 *   zero-width joiners inside it; anything else (a space, punctuation, a path's separator, an underscore) ends it.
 * - It also ends between a letter and a digit ("Sabha2026"), at a small letter before a capital ("EveningSabha") and
 *   where the script changes ("Sabhaસભા"); a name's last digit ends it before more digits ("Sabha 2026" in
 *   "Sabha 20261"). One case and one script of letters, as in "newest", is one word.
 * - A run of capitals before a capitalised word splits there ("ABCNew" is "ABC" and "New"; "ANEW" is one), at a
 *   name's start (R1) and at its end (R1b).
 * - A separator written as an escape starts a word: a URL's %20 or %2F, JSON's \n, \t or \r.
 * - Gujarati, Devanagari and the other Indic scripts, and Korean, write a word's endings joined to it ("સભા" + "માં"):
 *   there only a name's start is looked at, whatever follows it.
 * - Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Burmese) have no word ends to
 *   see: there a name is blanked wherever it is.
 * A name that starts or ends with a character that is not of a word is blanked there whatever is beside it.
 */
const UNSPACED =
  /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]$/u;
const JOINED_ENDINGS =
  /^[\p{sc=Devanagari}\p{sc=Bengali}\p{sc=Gurmukhi}\p{sc=Gujarati}\p{sc=Oriya}\p{sc=Tamil}\p{sc=Telugu}\p{sc=Kannada}\p{sc=Malayalam}\p{sc=Sinhala}\p{sc=Tibetan}\p{sc=Hangul}]$/u;
const WORD_CHAR = /^[\p{L}\p{M}\p{N}\u200C\u200D]$/u;
const DIGIT = /^\p{N}$/u;
// Case is told by the text's own characters, never by a case-insensitive pattern (there \p{Lu} matches small letters).
const SMALL = /^\p{Ll}$/u;
const CAPITAL = /^\p{Lu}$/u;
const SCRIPTS = [
  'Latin',
  'Greek',
  'Cyrillic',
  'Armenian',
  'Hebrew',
  'Arabic',
  'Syriac',
  'Thaana',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Oriya',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Tibetan',
  'Georgian',
  'Hangul',
  'Ethiopic',
  'Cherokee',
  'Mongolian',
].map((name) => ({ name, test: new RegExp(`^\\p{sc=${name}}$`, 'u') }));
const scriptOfChar = new Map<string, string | null>();
/** A character's script, or null for one that goes with any (digits 0-9, joiners, combining accents) or is not listed. */
function scriptOf(c: string): string | null {
  let script = scriptOfChar.get(c);
  if (script === undefined) {
    script = SCRIPTS.find((s) => s.test.test(c))?.name ?? null;
    scriptOfChar.set(c, script);
  }
  return script;
}

/** An ASCII character's kind: 0 not of a word, 1 a small letter, 2 a capital, 3 a digit. */
const asciiKind = (code: number): number =>
  code >= 0x61 && code <= 0x7a ? 1 : code >= 0x41 && code <= 0x5a ? 2 : code >= 0x30 && code <= 0x39 ? 3 : 0;

/** Whether `a` then `b`, side by side, are inside one word. */
function joins(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const x = a.charCodeAt(0);
  const y = b.charCodeAt(0);
  if (x < 0x80 && y < 0x80) {
    const ka = asciiKind(x);
    const kb = asciiKind(y);
    return ka !== 0 && kb !== 0 && (ka === 3) === (kb === 3) && !(ka === 1 && kb === 2);
  }
  if (!WORD_CHAR.test(a) || !WORD_CHAR.test(b) || UNSPACED.test(a) || UNSPACED.test(b)) return false;
  if (DIGIT.test(a) !== DIGIT.test(b) || (SMALL.test(a) && CAPITAL.test(b))) return false;
  const sa = scriptOf(a);
  const sb = scriptOf(b);
  return sa === null || sb === null || sa === sb;
}

/** A separator written as an escape just before a place: %XX (a URL's), or \n, \t, \r (JSON's). */
const ESCAPED = /(?:%[0-9A-Fa-f]{2}|\\[ntr])$/u;

/** Whether a word can start at `at`. */
function startsWord(s: string, at: number): boolean {
  const before = charBefore(s, at);
  const first = charAt(s, at);
  if (!joins(before, first)) return true;
  // A run of capitals before a capitalised name (R1): the capital before the name's small letter starts its word.
  if (before !== undefined && first !== undefined && CAPITAL.test(before) && CAPITAL.test(first)) {
    const second = charAt(s, at + first.length);
    if (second !== undefined && SMALL.test(second)) return true;
  }
  return ESCAPED.test(s.slice(Math.max(0, at - 3), at));
}

/**
 * Whether a name ending at `end` ends its word there: in a script with joined endings wherever it ends, and a name's
 * last digit before more digits too (lead 2: "Sabha 2026" is never left readable inside "Sabha 20261").
 */
function endsWord(s: string, end: number): boolean {
  const last = charBefore(s, end);
  const next = charAt(s, end);
  if (
    last !== undefined &&
    (JOINED_ENDINGS.test(last) || (DIGIT.test(last) && next !== undefined && DIGIT.test(next)))
  )
    return true;
  // A capital before a capitalised word (R1b): "ABCSaba" with the name "ABC".
  if (last !== undefined && next !== undefined && CAPITAL.test(last) && CAPITAL.test(next)) {
    const after = charAt(s, end + next.length);
    if (after !== undefined && SMALL.test(after)) return true;
  }
  return !joins(last, next);
}

/** The character that ends just before `i`, and the one that starts at `i` (whole, past a surrogate pair). */
function charBefore(s: string, i: number): string | undefined {
  if (i <= 0) return undefined;
  const low = s.charCodeAt(i - 1);
  return low >= 0xdc00 && low <= 0xdfff && i >= 2 ? s.slice(i - 2, i) : s.charAt(i - 1);
}
function charAt(s: string, i: number): string | undefined {
  const c = s.codePointAt(i);
  return c === undefined ? undefined : String.fromCodePoint(c);
}

/** How many names one pattern holds. */
const NAMES_AT_ONCE = 400;

/** A name with this many letters or more is blanked inside other words too (QA24-DIAG-2). */
const LONG_NAME_LETTERS = 5;
const letterCount = (name: string): number => name.match(/\p{L}/gu)?.length ?? 0;
/** A letter of a script whose words take joined endings and compounds (the review's G1: "સભા" inside "મહાસભા"). */
const JOINED_LETTER =
  /[\p{sc=Devanagari}\p{sc=Bengali}\p{sc=Gurmukhi}\p{sc=Gujarati}\p{sc=Oriya}\p{sc=Tamil}\p{sc=Telugu}\p{sc=Kannada}\p{sc=Malayalam}\p{sc=Sinhala}\p{sc=Tibetan}\p{sc=Hangul}]/u;
/** Blanked inside other words too: five letters or more, or any letter of such a script, however few. */
const isLong = (name: string): boolean => letterCount(name) >= LONG_NAME_LETTERS || JOINED_LETTER.test(name);

/**
 * The text with every one of these names blanked out: a long name wherever it is, a short one where it is the name;
 * longest first. The long ones go first: a shorter name can never hold a long one (it has fewer letters).
 */
export function redactNames(text: string, names: readonly string[]): string {
  const sorted = [...new Set(names)].filter((n) => n !== '').sort((a, b) => b.length - a.length);
  const long = sorted.filter(isLong);
  const short = sorted.filter((n) => !isLong(n));
  let out = text;
  // What an earlier pattern blanked stays as it is (a name "library" never blanks the words of a blank).
  const eachPart = (blank: (part: string) => string) => {
    out = out.split(HIDDEN).map(blank).join(HIDDEN);
  };
  for (let i = 0; i < long.length; i += NAMES_AT_ONCE) {
    const anywhere = new RegExp(
      long
        .slice(i, i + NAMES_AT_ONCE)
        .map(escape)
        .join('|'),
      'giu',
    );
    eachPart((part) => part.replace(anywhere, HIDDEN));
  }
  for (let i = 0; i < short.length; i += NAMES_AT_ONCE) {
    const some = short.slice(i, i + NAMES_AT_ONCE).map(escape);
    // Each place any of them is (quick), and the longest of them at one place (sticky).
    const find = new RegExp(some.join('|'), 'giu');
    const at = new RegExp(some.join('|'), 'iuy');
    eachPart((part) => blankWhole(part, find, at));
  }
  return out;
}

function blankWhole(s: string, find: RegExp, longestAt: RegExp): string {
  let out = '';
  let from = 0;
  find.lastIndex = 0;
  for (let m = find.exec(s); m; m = find.exec(s)) {
    const at = m.index;
    let length = 0;
    // Every name found here starts with this character (as letters go, case aside), so if it carries on a word that
    // started before it, none of them is the name here.
    if (startsWord(s, at)) {
      // The longest name here that ends its word: the one found, else each shorter one, found by reading less text.
      for (let len = m[0].length; len > 0;) {
        if (endsWord(s, at + len)) {
          length = len;
          break;
        }
        longestAt.lastIndex = at;
        len = longestAt.exec(s.slice(0, at + len - 1))?.[0].length ?? 0;
      }
    }
    if (length > 0) {
      out += `${s.slice(from, at)}${HIDDEN}`;
      from = at + length;
      find.lastIndex = from;
    } else find.lastIndex = at + (charAt(s, at)?.length ?? 1);
  }
  return out + s.slice(from);
}
