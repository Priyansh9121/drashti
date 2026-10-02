import { describe, expect, it } from 'vitest';
import { slideElementSchema, textRunSchema } from './model-schema';
import { detectLang, mainLang, mergeRuns, runsText, withDetectedLangs } from './text-runs';

describe('detectLang', () => {
  it('tells the scripts apart', () => {
    expect(detectLang('નમૂનો')).toBe('gu');
    expect(detectLang('नमूना')).toBe('hi');
    expect(detectLang('Placeholder line')).toBe('en');
    expect(detectLang('Namūnānī pahelī paṅkti')).toBe('translit');
  });

  it('returns null for text without letters', () => {
    expect(detectLang('')).toBeNull();
    expect(detectLang('  12, 34 - ! ')).toBeNull();
    expect(detectLang('\n')).toBeNull();
  });

  it('goes by the majority in mixed text', () => {
    expect(detectLang('નમૂનાની પંક્તિ (line)')).toBe('gu');
    expect(detectLang('A long English line with one શબ્દ')).toBe('en');
    expect(detectLang('॥ ૧ ॥')).toBe('hi'); // danda is Devanagari punctuation shared by both
  });

  it('recognises decomposed diacritics too', () => {
    expect(detectLang('Namu\u0304na\u0304')).toBe('translit');
  });

  it('treats plain-ASCII transliteration as English (it cannot be told apart)', () => {
    expect(detectLang('Namuno pahelo')).toBe('en');
  });
});

describe('runs', () => {
  it('joins text and merges look-alike neighbours', () => {
    const runs = [
      { text: 'નમૂ', lang: 'gu' as const, size: 90 },
      { text: 'નો', lang: 'gu' as const, size: 90 },
      { text: '' },
      { text: '\n' },
      { text: 'Namūno', lang: 'translit' as const, size: 60, italic: true },
    ];
    expect(runsText(runs)).toBe('નમૂનો\nNamūno');
    expect(mergeRuns(runs)).toEqual([
      { text: 'નમૂનો', lang: 'gu', size: 90 },
      { text: '\n' },
      { text: 'Namūno', lang: 'translit', size: 60, italic: true },
    ]);
  });

  it('detects missing languages but keeps given ones and legacy runs', () => {
    const runs = withDetectedLangs([
      { text: 'નમૂનો' },
      { text: '\n' },
      { text: 'nmUnO', font: 'Gopika', legacy: true },
      { text: 'Namuno', lang: 'translit' },
    ]);
    expect(runs.map((r) => r.lang)).toEqual(['gu', undefined, undefined, 'translit']);
  });

  it('finds the main language: the native script when there is one, else by letters', () => {
    expect(
      mainLang([{ text: 'નમૂનાની પહેલી પંક્તિ' }, { text: '\n' }, { text: 'Namūnā', lang: 'translit' }]),
    ).toBe('gu');
    // A full transliteration has more letters than the Gujarati line; Gujarati is still the main language.
    expect(
      mainLang([{ text: 'નમૂનાની પહેલી પંક્તિ\n' }, { text: 'Namūnānī pahelī paṅkti with more words' }]),
    ).toBe('gu');
    expect(mainLang([{ text: 'नमूने की पहली पंक्ति' }, { text: 'નમૂનો' }])).toBe('hi');
    expect(mainLang([{ text: 'Placeholder English line' }, { text: 'Namūnā', lang: 'translit' }])).toBe('en');
    expect(mainLang([{ text: 'nmUnO', legacy: true }, { text: 'Placeholder' }])).toBe('en');
    expect(mainLang([{ text: '12' }])).toBeNull();
  });
});

describe('run schema', () => {
  const base = {
    id: 't',
    kind: 'text',
    frame: { x: 0, y: 0, width: 100, height: 50 },
    text: 'a',
    lang: null,
    style: {
      fontFamily: null,
      fontSize: 40,
      fontWeight: 400,
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      shadow: false,
    },
  };

  it('accepts elements with and without runs', () => {
    expect(slideElementSchema.safeParse(base).success).toBe(true);
    const withRuns = {
      ...base,
      runs: [
        { text: 'a', font: 'Shruti', size: 40, color: '#ff0000', weight: 700, italic: true, lang: 'gu' },
      ],
    };
    expect(slideElementSchema.safeParse(withRuns).success).toBe(true);
  });

  it('rejects bad run styles', () => {
    expect(textRunSchema.safeParse({ text: 'a', color: 'red' }).success).toBe(false);
    expect(textRunSchema.safeParse({ text: 'a', size: -3 }).success).toBe(false);
    expect(textRunSchema.safeParse({ text: 'a', weight: 950 }).success).toBe(false);
    expect(textRunSchema.safeParse({ text: 'a', lang: 'fr' }).success).toBe(false);
  });
});

describe('plain transliteration beside its words', () => {
  /* Common words only. */
  it('is told from English by reading like a Gujarati or Hindi line in the same box', () => {
    const runs = withDetectedLangs([{ text: 'ઘર અને મંદિર\nGhar ne mandir\nHome and temple' }]);
    expect(runs.map((r) => [r.lang, r.text.trim()])).toEqual([
      ['gu', 'ઘર અને મંદિર'],
      ['translit', 'Ghar ne mandir'],
      ['en', 'Home and temple'],
    ]);
    expect(withDetectedLangs([{ text: 'भजन और आरती\nBhajan aur aarti' }]).map((r) => r.lang)).toEqual([
      'hi',
      'translit',
    ]);
  });
});
