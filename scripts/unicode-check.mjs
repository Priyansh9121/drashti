// Hidden characters in the repository's files (Sessions 31–36, I18N-3), checked in CI's checks job: a
// direction override or isolate (a line that reads one way and runs another), a zero-width character, a
// filler that draws nothing. Each one is reported with where it is and what it is; the files are only read.
// ZWJ and ZWNJ are allowed between Indian letters, as a half-form is written (tests/fixtures/half-forms.txt),
// nowhere else: code writes them as \u200d and \u200c.
//
//   node scripts/unicode-check.mjs               every file git tracks here; exit 1 with what was found
//   node scripts/unicode-check.mjs --self-check  plants a U+202E and a ZWJ between Latin letters, and a
//                                                Devanagari half-form, and checks what is found
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The characters found, by code point. */
export const HIDDEN = new Map([
  [0x00ad, 'SOFT HYPHEN'],
  [0x034f, 'COMBINING GRAPHEME JOINER'],
  [0x061c, 'ARABIC LETTER MARK'],
  [0x115f, 'HANGUL CHOSEONG FILLER'],
  [0x1160, 'HANGUL JUNGSEONG FILLER'],
  [0x180e, 'MONGOLIAN VOWEL SEPARATOR'],
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2060, 'WORD JOINER'],
  [0x2061, 'FUNCTION APPLICATION'],
  [0x2062, 'INVISIBLE TIMES'],
  [0x2063, 'INVISIBLE SEPARATOR'],
  [0x2064, 'INVISIBLE PLUS'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  [0x3164, 'HANGUL FILLER'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE'],
  [0xffa0, 'HALFWIDTH HANGUL FILLER'],
]);

const JOINERS = new Set([0x200c, 0x200d]);
/** Indian scripts' letters and marks: Devanagari to Sinhala, Devanagari Extended, Vedic Extensions. */
const indian = (ch) => {
  const code = ch?.codePointAt(0) ?? 0;
  return (
    (code >= 0x0900 && code <= 0x0dff) ||
    (code >= 0xa8e0 && code <= 0xa8ff) ||
    (code >= 0x1cd0 && code <= 0x1cff)
  );
};

/** What is hidden in one file's text (empty when nothing): "name:line:column U+XXXX NAME". */
export function hiddenIn(text, name) {
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const chars = Array.from(line);
    let column = 1;
    chars.forEach((ch, j) => {
      const code = ch.codePointAt(0) ?? 0;
      const what = HIDDEN.get(code);
      const between = JOINERS.has(code) && indian(chars[j - 1]) && indian(chars[j + 1]);
      if (what && !between)
        found.push(
          `${name}:${String(i + 1)}:${String(column)} U+${code.toString(16).toUpperCase().padStart(4, '0')} ${what}`,
        );
      column += ch.length;
    });
  });
  return found;
}

/** Whether a file's bytes are text: no NUL, and UTF-8 throughout. */
function asText(bytes) {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Every file git tracks under `root` (the app's folder), checked. */
export function checkTree(root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f !== '');
  return files.flatMap((f) => {
    const text = asText(readFileSync(join(root, f)));
    return text === null ? [] : hiddenIn(text, f);
  });
}

/** Planted characters are found, and a half-form is not. */
export function selfCheck() {
  const problems = [];
  if (hiddenIn('const ok = true; // \u202e} ;', 'planted').length !== 1)
    problems.push('a planted U+202E was not found');
  if (hiddenIn('admin\u200duser', 'planted').length !== 1)
    problems.push('a ZWJ between Latin letters was not found');
  if (hiddenIn('क्\u200dष क्\u200cष ક્\u200dષ', 'half-forms').length !== 0)
    problems.push('a Devanagari or Gujarati half-form was reported');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const self = process.argv.includes('--self-check');
  const found = self ? selfCheck() : checkTree(join(dirname(fileURLToPath(import.meta.url)), '..'));
  if (found.length > 0) {
    process.stderr.write(
      self
        ? `The hidden-character check does not work (scripts/unicode-check.mjs):\n${found.join('\n')}\n`
        : `Hidden characters (scripts/unicode-check.mjs): write each as an escape, or take it out.\n${found.join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    self ? 'The hidden-character check finds what it should.\n' : 'No hidden characters.\n',
  );
}
