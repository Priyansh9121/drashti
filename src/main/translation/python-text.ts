// Python's text behaviour where the translation pipeline depends on it (whitespace, digits, word characters as
// Python's re and regex modules define them), so the port reproduces x74's Python pipeline exactly.
import { PY_CLASSES } from './python-classes';

type ClassName = keyof typeof PY_CLASSES;
const built = new Map<ClassName, string>();

/** A regular expression character class body (no brackets) for one of Python's classes; use with the u flag. */
export function cls(name: ClassName): string {
  let body = built.get(name);
  if (body === undefined) {
    body = PY_CLASSES[name]
      .split(',')
      .map((range) => {
        const [first, last] = range.split('-');
        return last ? `\\u{${first}}-\\u{${last}}` : `\\u{${first}}`;
      })
      .join('');
    built.set(name, body);
  }
  return body;
}

/** Whether one code point is in one of Python's classes. */
export function inClass(name: ClassName, char: string): boolean {
  return new RegExp(`^[${cls(name)}]$`, 'u').test(char);
}

let stripPattern: RegExp | null = null;
let splitPattern: RegExp | null = null;

/** Python's str.strip() with no arguments. */
export function pyStrip(text: string): string {
  stripPattern ??= new RegExp(`^[${cls('re_s')}]+|[${cls('re_s')}]+$`, 'gu');
  return text.replace(stripPattern, '');
}

/** Python's str.split() with no arguments. */
export function pySplit(text: string): string[] {
  splitPattern ??= new RegExp(`[${cls('re_s')}]+`, 'u');
  return pyStrip(text)
    .split(splitPattern)
    .filter((part) => part !== '');
}

/** Python's len(): code points, not UTF-16 units. */
export const pyLen = (text: string): number => Array.from(text).length;
