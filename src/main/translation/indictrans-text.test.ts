import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeTokens,
  holdsSpecialToken,
  postprocess,
  preprocess,
  restoreSourceClockSpacing,
  routeFor,
  type Iso,
  type PlaceholderOrder,
} from './indictrans-text';

// What x74's Python pipeline gives (IndicTransToolkit 1.1.1 with the original indic-nlp-library 0.92, the models'
// tokenizer decode, clock_spacing.py), recorded from generated placeholder words and character fuzz.
interface Fixture {
  pre: { src: string; tgt: string; text: string; pre: string; order: string[][] }[];
  post: { src: string; tgt: string; source: string; cand: string; post: string; order: string[][] }[];
  decode: { tokens: string[]; decoded: string }[];
  clock: { source: string; translated: string; out: string }[];
}
const fixture = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'translation', 'indictrans-python.json'),
    'utf8',
  ),
) as Fixture;
const ISO: Record<string, Iso> = { eng_Latn: 'en', guj_Gujr: 'gu', hin_Deva: 'hi' };
const iso = (tag: string): Iso => ISO[tag] ?? 'en';
// Python numbers a pattern's matches in its set's order; the fixture holds the order that process used. The port's
// own patterns must have found the very same matches (a22-review-mt A5): only their order is taken from Python.
const pythonOrder =
  (order: string[][]): PlaceholderOrder =>
  (index, matches) => {
    const python = order[index] ?? [];
    expect(new Set(matches), `placeholder pattern ${String(index)}`).toEqual(new Set(python));
    return python;
  };

describe('IndicTrans2 text pipeline, against x74’s Python', () => {
  it('prepares each source exactly as IndicProcessor.preprocess_batch did', () => {
    expect(fixture.pre.length).toBeGreaterThanOrEqual(600);
    const wrong = fixture.pre
      .map((r) => ({
        r,
        got: `${r.src} ${r.tgt} ${preprocess(r.text, iso(r.src), pythonOrder(r.order)).text}`,
      }))
      .filter(({ r, got }) => got !== r.pre)
      .map(({ r, got }) => ({ text: r.text, got, want: r.pre }));
    expect(wrong).toEqual([]);
  });

  it('restores each result exactly as IndicProcessor.postprocess_batch did, with its source’s placeholders', () => {
    expect(fixture.post.length).toBeGreaterThanOrEqual(450);
    const wrong = fixture.post
      .map((r) => {
        const { placeholders } = preprocess(r.source, iso(r.src), pythonOrder(r.order));
        return { r, got: postprocess(r.cand, iso(r.tgt), placeholders) };
      })
      .filter(({ r, got }) => got !== r.post)
      .map(({ r, got }) => ({ cand: r.cand, got, want: r.post }));
    expect(wrong).toEqual([]);
  });

  it('decodes output tokens exactly as the models’ tokenizer did (special tokens dropped, clean-up applied)', () => {
    const wrong = fixture.decode.filter((r) => decodeTokens(r.tokens) !== r.decoded);
    expect(wrong).toEqual([]);
  });

  it('repairs clock spacing only for the source’s own valid times, as clock_spacing.py did', () => {
    const wrong = fixture.clock.filter((r) => restoreSourceClockSpacing(r.source, r.translated) !== r.out);
    expect(wrong).toEqual([]);
  });

  it('numbers placeholders in the order they first appear, and restores every one', () => {
    const prepared = preprocess('Call 1234 5678 or mail a.b@example.com at 10:30, 11:45.', 'en');
    expect(prepared.text).toBe('Call 1234 5678 or mail < ID1 > at < ID2 > , < ID3 > .');
    expect(postprocess('< ID2 > < ID3 > < ID1 >', 'en', prepared.placeholders)).toBe(
      '10:30 11:45 a.b@example.com',
    );
  });

  it('numbers a longer match before one it holds, so no placeholder cuts another (a22-review-mt A4)', () => {
    // Python iterates a set here, so some of its runs corrupt these; Drashti never does: longest first.
    const echo = (source: string, lang: Iso) => {
      const prepared = preprocess(source, lang);
      return { text: prepared.text, back: postprocess(prepared.text, lang, prepared.placeholders) };
    };
    const web = echo('Visit example.org or example.org/give today.', 'en');
    expect(web.text).not.toContain('give');
    expect(web.back).toBe('Visit example.org or example.org/give today.');
    expect(echo('1/12/2026 to 11/12/2026', 'en').back).toBe('1/12/2026 to 11/12/2026');
    expect(echo('2026-11-2 and 2026-11-24', 'en').back).toBe('2026-11-2 and 2026-11-24');
    const gujarati = echo(
      '\u0aa4\u0abe\u0ab0\u0ac0\u0a96 \u0ae7/\u0ae7\u0ae8/\u0ae8\u0ae6\u0ae8\u0aec \u0aa5\u0ac0 \u0ae7\u0ae7/\u0ae7\u0ae8/\u0ae8\u0ae6\u0ae8\u0aec',
      'gu',
    );
    expect(gujarati.back.split(' ')).toEqual([
      '\u0aa4\u0abe\u0ab0\u0ac0\u0a96',
      '1/12/2026',
      '\u0aa5\u0ac0',
      '11/12/2026',
    ]);
  });

  it('picks the model for each direction', () => {
    expect(routeFor('en', 'gu')).toBe('en-indic');
    expect(routeFor('hi', 'en')).toBe('indic-en');
    expect(routeFor('gu', 'hi')).toBe('indic-indic');
  });

  it('knows a source holding one of the model’s own tokens', () => {
    expect(holdsSpecialToken('a </s> b')).toBe(true);
    expect(holdsSpecialToken('a <ID1> b')).toBe(false);
  });
});
