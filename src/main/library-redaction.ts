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
 * A name is blanked only where it is the name (QA24-DIAG-1: a library name "new" blanked the "new" of "newest" in the
 * crash files' heading, and inside the words of a Quit line). A word is made of letters, marks (the vowel signs and
 * viramas of Gujarati and Devanagari) and digits, in any script, with the zero-width joiners inside it; anything else
 * (a space, punctuation, a path's separator, an underscore) ends it. A name that starts or ends with such a character
 * is blanked there whatever is beside it. Scripts written without spaces between words (Chinese, Japanese, Thai, Lao,
 * Khmer, Burmese) have no such ends to see, so there a name is blanked wherever it is.
 */
const UNSPACED =
  '\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Khmer}\\p{scx=Myanmar}';
/** One character of a word written with spaces between words. */
const IN_WORD = `(?:(?![${UNSPACED}])[\\p{L}\\p{M}\\p{N}\\u200C\\u200D])`;
const IN_WORD_ONE = new RegExp(`^${IN_WORD}$`, 'u');

const inWord = (c: string | undefined) => c !== undefined && IN_WORD_ONE.test(c);
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
const lastChar = (s: string) => charBefore(s, s.length);

/** How many names one pattern holds. */
const NAMES_AT_ONCE = 400;

/** The text with every one of these names blanked out where it is the name, longest first. */
export function redactNames(text: string, names: readonly string[]): string {
  const sorted = [...new Set(names)].filter((n) => n !== '').sort((a, b) => b.length - a.length);
  let out = text;
  for (let i = 0; i < sorted.length; i += NAMES_AT_ONCE) {
    const some = sorted.slice(i, i + NAMES_AT_ONCE);
    // Each place any of them is (quick), then, where the longest there ends inside a word, the longest that does not.
    const find = new RegExp(some.map(escape).join('|'), 'giu');
    const ending = new RegExp(
      some.map((n) => `${escape(n)}${inWord(lastChar(n)) ? `(?!${IN_WORD})` : ''}`).join('|'),
      'iuy',
    );
    // What an earlier pattern blanked stays as it is (a name "library" never blanks the words of a blank).
    out = out
      .split(HIDDEN)
      .map((part) => blankWhole(part, find, ending))
      .join(HIDDEN);
  }
  return out;
}

function blankWhole(s: string, find: RegExp, ending: RegExp): string {
  let out = '';
  let from = 0;
  find.lastIndex = 0;
  for (let m = find.exec(s); m; m = find.exec(s)) {
    const at = m.index;
    let length = -1;
    // Every name found here starts with this character (as letters go, case aside), so if it carries on a word that
    // started before it, none of them is the name here.
    if (!(inWord(charBefore(s, at)) && inWord(charAt(s, at)))) {
      if (!(inWord(lastChar(m[0])) && inWord(charAt(s, at + m[0].length)))) length = m[0].length;
      else {
        ending.lastIndex = at;
        length = ending.exec(s)?.[0].length ?? -1;
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
