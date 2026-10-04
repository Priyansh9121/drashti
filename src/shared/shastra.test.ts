import { describe, expect, it } from 'vitest';
import type { RefText, ShastraFile } from './shastra';
import { parsePassageId, passageId, readShastraFile, refKey, resolveReference } from './shastra';

/* Shastra texts: reading the file format, and references (placeholder texts only). */

const flat: ShastraFile = {
  format: 'drashti-shastra',
  version: 1,
  name: 'Placeholder Granth',
  abbreviation: 'PG',
  items: [1, 2, 3, 14, 15, 16].map((n) => ({
    number: n,
    text: { sa: `नमूना श्लोकः ${n}`, en: `Placeholder verse ${n}.` },
  })),
};

const nested: ShastraFile = {
  format: 'drashti-shastra',
  version: 1,
  name: 'Placeholder Vachan',
  abbreviation: 'Vach',
  sections: [
    {
      label: 'Placeholder Pratham',
      abbreviation: 'P.Pr.',
      items: [1, 2, 3].map((n) => ({ number: n, text: { gu: `નમૂના વચન ${n}` } })),
    },
    {
      label: 'Placeholder Madhya',
      abbreviation: 'P.M.',
      items: [1, 2].map((n) => ({ number: n, text: { gu: `નમૂના વચન ${n}` } })),
    },
  ],
};

describe('reading a Shastra file', () => {
  it('reads a text with its own items, filing Sanskrit under the script it is written in', () => {
    const read = readShastraFile({
      ...flat,
      items: [{ number: 1, text: { sa: 'નમૂના શ્લોકઃ', en: 'Placeholder' } }],
    });
    if (!read.ok) throw new Error(read.message);
    expect(read.text.items[0]?.texts).toEqual({ 'sa-gu': 'નમૂના શ્લોકઃ', en: 'Placeholder' });
    expect(read.text.languages).toEqual({ 'sa-gu': 1, en: 1 });
  });

  it('reads nested sections, each keyed by its abbreviation', () => {
    const read = readShastraFile(nested);
    if (!read.ok) throw new Error(read.message);
    expect(read.text.sections.map((s) => [s.label, s.key, s.items.length])).toEqual([
      ['Placeholder Pratham', 'ppr', 3],
      ['Placeholder Madhya', 'pm', 2],
    ]);
    expect(read.text.itemCount).toBe(5);
  });

  it('tidies the words and notes what it left out', () => {
    const read = readShastraFile({
      ...flat,
      items: [
        { number: 1, text: { en: '  Placeholder line one \r\n  Placeholder line two  \n\n' } },
        { number: 1, text: { en: 'Again' } },
        { number: 2, text: { en: '   ' } },
      ],
    });
    if (!read.ok) throw new Error(read.message);
    expect(read.text.items.map((i) => i.texts.en)).toEqual(['Placeholder line one\nPlaceholder line two']);
    expect(read.notes.map((n) => n.message)).toEqual([
      'Placeholder Granth has item 1 more than once: the first is kept.',
      'Placeholder Granth 2 has no words: it was left out.',
    ]);
  });

  it('refuses a file that is not a Shastra text, saying where', () => {
    const wrong = readShastraFile({ ...flat, format: 'something-else' });
    expect(wrong.ok ? '' : wrong.message).toContain('not a Shastra text');
    const bad = readShastraFile({ ...flat, items: [{ number: 'one', text: {} }] });
    expect(bad.ok ? '' : bad.message).toContain('items › 0 › number');
    const empty = readShastraFile({ ...flat, items: [{ number: 1, text: { en: ' ' } }] });
    expect(empty.ok ? '' : empty.message).toBe('Placeholder Granth has no items with words in them.');
  });
});

/** The texts as references see them. */
const texts: RefText[] = [
  { id: 't1', name: 'Placeholder Granth', abbreviation: 'PG', sections: [], numbers: [1, 2, 3, 14, 15, 16] },
  {
    id: 't2',
    name: 'Placeholder Vachan',
    abbreviation: 'Vach',
    numbers: [],
    sections: [
      { id: 's1', label: 'Placeholder Pratham', abbreviation: 'P.Pr.', sections: [], numbers: [1, 2, 3] },
      { id: 's2', label: 'Placeholder Madhya', abbreviation: 'P.M.', sections: [], numbers: [1, 2] },
    ],
  },
];

describe('references', () => {
  it('finds one item, or a range, by the text’s own abbreviation or its name', () => {
    expect(resolveReference('PG 14', texts)).toEqual({
      ok: true,
      key: { text: 'pg', sections: [], from: 14, to: 14 },
      display: 'Placeholder Granth 14',
    });
    expect(resolveReference('pg 14-16', texts)).toMatchObject({
      key: { from: 14, to: 16 },
      display: 'Placeholder Granth 14–16',
    });
    expect(resolveReference('PG14–16', texts)).toMatchObject({ key: { from: 14, to: 16 } });
    expect(resolveReference('Placeholder Granth 2', texts)).toMatchObject({ key: { text: 'pg', from: 2 } });
  });

  it('finds an item in a section, however the section’s abbreviation is typed', () => {
    for (const typed of [
      'Vach P.Pr. 1',
      'vach ppr 1',
      'Vach P. Pr 1',
      'vach ppr1',
      'Vach Placeholder Pratham 1',
    ])
      expect(resolveReference(typed, texts), typed).toEqual({
        ok: true,
        key: { text: 'vach', sections: ['ppr'], from: 1, to: 1 },
        display: 'Placeholder Vachan Placeholder Pratham 1',
      });
    expect(resolveReference('Vach P.M. 1-2', texts)).toMatchObject({
      key: { sections: ['pm'], from: 1, to: 2 },
    });
  });

  it('refuses nonsense with a clear message', () => {
    const say = (typed: string) => {
      const r = resolveReference(typed, texts);
      return r.ok ? 'ok' : r.message;
    };
    expect(say('')).toBe('Type a reference, for example “SD 14”.');
    expect(say('XY 4')).toBe('No loaded text is called “XY”. The texts are: PG, Vach.');
    expect(say('PG')).toBe('Say which one of Placeholder Granth: for example “PG 1”.');
    expect(say('PG 4')).toBe('Placeholder Granth has no 4: it goes from 1 to 16.');
    expect(say('PG 16-14')).toBe('A range goes up: “PG 14-16”.');
    expect(say('PG fourteen')).toBe('“fourteen” is not a number in Placeholder Granth.');
    expect(say('Vach 1')).toBe('Placeholder Vachan has no section “1”. Its sections are: P.Pr., P.M..');
    expect(say('Vach')).toBe('Say which section of Placeholder Vachan: P.Pr., P.M..');
    expect(say('Vach P.M. 3')).toBe('Placeholder Vachan Placeholder Madhya has no 3: it goes from 1 to 2.');
    expect(resolveReference('PG 1', [])).toEqual({ ok: false, message: 'No Shastra texts are loaded yet.' });
  });
});

describe('passage ids', () => {
  it('name a passage by keys, so they last when a text is loaded again', () => {
    const one = { text: 'pg', sections: [], from: 14, to: 14 };
    const range = { text: 'vach', sections: ['ppr'], from: 1, to: 3 };
    expect(passageId(one)).toBe('shastra:pg#14');
    expect(passageId(range)).toBe('shastra:vach/ppr#1-3');
    expect(parsePassageId(passageId(one))).toEqual(one);
    expect(parsePassageId(passageId(range))).toEqual(range);
    for (const bad of ['pg#14', 'shastra:pg', 'shastra:#1', 'shastra:pg#3-1', 'shastra:pg#x'])
      expect(parsePassageId(bad), bad).toBeNull();
  });

  it('refKey keeps letters and digits in any script', () => {
    expect(refKey('G.Pr.')).toBe('gpr');
    expect(refKey('Śloka 1')).toBe('sloka1');
    expect(refKey('ગ.પ્ર.')).toBe('ગપ્ર');
  });
});
