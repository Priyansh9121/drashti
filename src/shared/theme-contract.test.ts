import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES } from './builtin-themes';
import { themeContract } from './theme-contract';
import { DEFAULT_THEME, type ThemeFields } from './themes';

/* The theme contract (Sessions 31–36, SLD-4): Drashti's own themes keep it; a theme that misses it is told what. */

const withGujarati = (patch: Partial<ThemeFields['langs']['gu']>): ThemeFields => ({
  ...DEFAULT_THEME,
  langs: { ...DEFAULT_THEME.langs, gu: { ...DEFAULT_THEME.langs.gu, ...patch } },
});

describe('the theme contract', () => {
  it('Drashti default and every built-in theme keep it', () => {
    for (const fields of [DEFAULT_THEME, ...BUILTIN_THEMES.map((t) => t.fields)])
      expect(themeContract(fields), fields.name).toEqual([]);
  });

  it('a 20 px Gujarati misses it, and is told why', () => {
    expect(themeContract(withGujarati({ size: 20 }))).toEqual([
      'Gujarati is set at 20 px: below 36 px the back of the hall cannot read it.',
    ]);
  });

  it('so do faint words, thin ones, lines too close, and a box outside title-safe', () => {
    expect(themeContract(withGujarati({ color: '#555555' }))[0]).toMatch(
      /^Gujarati’s colour is 2\.\d:1 against the background: below 4\.5:1/u,
    );
    expect(themeContract(withGujarati({ weight: 300 }))).toEqual([
      'Gujarati is set at weight 300: thinner than 400 is hard to read from far.',
    ]);
    expect(themeContract({ ...DEFAULT_THEME, box: { ...DEFAULT_THEME.box, lineHeight: 1 } })).toEqual([
      'Lines are 1 apart: below 1.15 Gujarati and Hindi marks touch the line above.',
    ]);
    expect(themeContract({ ...DEFAULT_THEME, box: { ...DEFAULT_THEME.box, x: 0, width: 1 } })).toEqual([
      'The words’ box reaches outside title-safe (90% of the slide): some screens cut its edges.',
    ]);
    // Measured on its own background: dark words on white keep it, white words on white do not.
    const white: ThemeFields = { ...DEFAULT_THEME, background: { kind: 'color', color: '#ffffff' } };
    expect(themeContract(white).length).toBeGreaterThan(0);
  });
});
