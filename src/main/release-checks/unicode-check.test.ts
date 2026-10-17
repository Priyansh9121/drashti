import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTree, hiddenIn, selfCheck } from '../../../scripts/unicode-check.mjs';

/*
 * Hidden characters (Sessions 31–36, I18N-3): direction overrides and isolates, zero-width characters and
 * fillers are reported wherever they are in the repository's files; ZWJ and ZWNJ only between Indian letters
 * (a half-form). The joiners code had as literals are escapes now; CI's checks job runs the check.
 */

const APP = join(__dirname, '..', '..', '..');

describe('the hidden-character check', () => {
  it('finds a planted U+202E, and a ZWJ between Latin letters, with where they are', () => {
    expect(
      hiddenIn('const access = "user";\nif (access !== "user\u202e \u2066// admin\u2069") {}', 'planted.ts'),
    ).toEqual([
      'planted.ts:2:21 U+202E RIGHT-TO-LEFT OVERRIDE',
      'planted.ts:2:23 U+2066 LEFT-TO-RIGHT ISOLATE',
      'planted.ts:2:32 U+2069 POP DIRECTIONAL ISOLATE',
    ]);
    expect(hiddenIn('admin\u200duser', 'planted.ts')).toEqual(['planted.ts:1:6 U+200D ZERO WIDTH JOINER']);
    expect(hiddenIn('\u200dक्ष', 'planted.ts')).toHaveLength(1);
    expect(hiddenIn('\ufeffexport {};', 'planted.ts')).toHaveLength(1);
  });

  it('passes a Devanagari or Gujarati half-form, written with ZWJ or ZWNJ between the letters', () => {
    expect(hiddenIn('क्\u200dष क्\u200cष ક્\u200dષ', 'half-forms.md')).toEqual([]);
    // The fixture holds them as characters, as content does.
    const fixture = readFileSync(join(APP, 'tests', 'fixtures', 'half-forms.txt'), 'utf8');
    expect(fixture).toContain('\u200d');
    expect(hiddenIn(fixture, 'tests/fixtures/half-forms.txt')).toEqual([]);
  });

  it('found the literals code had before they were escaped', () => {
    expect(hiddenIn('const JOINERS = /[\u200c\u200d]/g;', 'src/shared/search.ts')).toHaveLength(2);
    expect(hiddenIn("  ltrmark: '\u200e',", 'src/main/import/rtf/rtf.ts')).toHaveLength(1);
  });

  it('checks itself, finds nothing in this repository, and runs in CI’s checks job', () => {
    expect(selfCheck()).toEqual([]);
    expect(checkTree(APP)).toEqual([]);
    const ci = readFileSync(join(APP, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('node scripts/unicode-check.mjs --self-check');
    expect(ci).toMatch(/run: node scripts\/unicode-check\.mjs\n/u);
  });
});
