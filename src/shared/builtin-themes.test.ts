import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES } from './builtin-themes';
import { contrastRatio } from './contrast';
import { LANGS } from './model';
import { DEFAULT_THEME, themeFieldsSchema } from './themes';

/* Session 26 step 14: the built-in themes, and their words' contrast. */

const NAMES = [
  'Midnight',
  'Plum and Flame',
  'Saffron',
  'Maroon and Gold',
  'Forest',
  'Ocean',
  'Ivory',
  'Charcoal',
  'High Contrast White on Black',
  'High Contrast Black on White',
];

describe('the built-in themes', () => {
  it('are ten, with plain names and keys of their own, beside Drashti default', () => {
    expect(BUILTIN_THEMES.map((t) => t.fields.name)).toEqual(NAMES);
    expect(new Set(BUILTIN_THEMES.map((t) => t.key)).size).toBe(NAMES.length);
    expect(NAMES).not.toContain(DEFAULT_THEME.name);
  });

  it('hold colours only (no pictures) and the fonts Drashti bundles, and are themes as the library keeps them', () => {
    for (const { fields } of BUILTIN_THEMES) {
      expect(themeFieldsSchema.safeParse(fields).success, fields.name).toBe(true);
      expect(fields.background.kind, fields.name).toBe('color');
      for (const lang of LANGS) expect(fields.langs[lang].font, `${fields.name}: ${lang}`).toBeNull();
      expect(fields.reference.font, fields.name).toBeNull();
    }
  });

  it('put a shadow behind light words only: none on a light background', () => {
    for (const { fields } of BUILTIN_THEMES) {
      const bg = fields.background.kind === 'color' ? fields.background.color : '#000000';
      const light = contrastRatio(bg, '#000000') > contrastRatio(bg, '#ffffff');
      for (const lang of LANGS)
        if (light) expect(fields.langs[lang].shadow, `${fields.name}: ${lang}`).toBe(false);
    }
  });

  // Dim halls and washed-out projectors: 7:1 (WCAG's AAA), measured as it is, never rounded up.
  for (const { fields } of [...BUILTIN_THEMES, { fields: DEFAULT_THEME }]) {
    it(`${fields.name}: each language’s words and the reference line at least 7:1 against its background`, () => {
      // Drashti default leaves backgrounds as they are: measured on black, as its preview shows it.
      const bg = fields.background.kind === 'color' ? fields.background.color : '#000000';
      for (const lang of LANGS)
        expect(
          contrastRatio(fields.langs[lang].color, bg),
          `${lang}: ${fields.langs[lang].color} on ${bg}`,
        ).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(fields.reference.color, bg), 'the reference line').toBeGreaterThanOrEqual(7);
    });
  }
});
