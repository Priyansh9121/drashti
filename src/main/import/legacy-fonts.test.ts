import { afterEach, describe, expect, it } from 'vitest';
import type { TextRun } from '../../shared/model';
import { converterFor, legacyFontOf, LegacyFontUse, registerConverter } from './legacy-fonts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const undo of cleanups.splice(0)) undo();
});

describe('legacy fonts', () => {
  it('knows the legacy Gujarati and Hindi fonts the audit looks for', () => {
    expect(legacyFontOf('Gopika')).toEqual({ name: 'Gopika', script: 'gu' });
    expect(legacyFontOf('TERAFONT-VARUN')).toEqual({ name: 'TERAFONT-VARUN', script: 'gu' });
    expect(legacyFontOf('LMG-Arun')?.script).toBe('gu');
    expect(legacyFontOf('Shree-Guj-0768')?.script).toBe('gu');
    expect(legacyFontOf('Kruti Dev 010')?.script).toBe('hi');
    expect(legacyFontOf('KrutiDev010')?.script).toBe('hi');
    expect(legacyFontOf('DevLys 010')?.script).toBe('hi');
    expect(legacyFontOf('Shree Lipi')?.script).toBeNull();
    for (const unicode of ['Noto Sans Gujarati', 'Shruti', 'Helvetica', 'Mangal', '', null])
      expect(legacyFontOf(unicode)).toBeNull();
  });

  it('keeps legacy runs as typed, in their font, never guessed to be English, and reports each font once', () => {
    const use = new LegacyFontUse();
    const box = (): TextRun[] => [
      { text: 'nmUnO ', font: 'Gopika', size: 80 },
      { text: 'Placeholder', font: 'Helvetica', lang: 'en' },
    ];
    const marked = use.apply(box());
    use.apply(box());
    expect(marked).toEqual([
      { text: 'nmUnO ', font: 'Gopika', size: 80, legacy: true, lang: null },
      { text: 'Placeholder', font: 'Helvetica', lang: 'en' },
    ]);
    expect(use.issues()).toEqual([
      {
        severity: 'warning',
        code: 'legacy-font',
        message:
          'Text in the legacy Gujarati font “Gopika” (2 text boxes) is kept as typed: it shows correctly only where that font is installed, and cannot be searched or transliterated until it is converted.',
        fix: { kind: 'convert-font', font: 'Gopika' },
      },
    ]);
  });

  it('converts runs when a converter for their font is registered (none ship yet)', () => {
    expect(converterFor('Gopika')).toBeNull();
    // A made-up font and table, for this test only.
    cleanups.push(
      registerConverter({
        matches: (name) => name === 'Test Legacy Gopika',
        script: 'gu',
        convert: (codes) => codes.replace(/k/gu, 'ક').replace(/m/gu, 'મ'),
      }),
    );
    const use = new LegacyFontUse();
    expect(use.apply([{ text: 'km', font: 'Test Legacy Gopika', size: 60 }])).toEqual([
      { text: 'કમ', size: 60, lang: 'gu' },
    ]);
    expect(use.issues()).toEqual([
      {
        severity: 'info',
        code: 'legacy-font-converted',
        message:
          'Text in the legacy Gujarati font “Test Legacy Gopika” (one text box) was converted to Unicode.',
        fix: null,
      },
    ]);
  });
});
