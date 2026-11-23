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
// Python numbers a pattern's matches in its set's order; the fixture holds the order that process used.
const pythonOrder =
  (order: string[][]): PlaceholderOrder =>
  (index) =>
    order[index] ?? [];

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
