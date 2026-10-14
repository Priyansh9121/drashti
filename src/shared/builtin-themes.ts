import { luminance } from './contrast';
import type { Lang } from './model';
import type { ThemeFields, ThemeLangStyle } from './themes';
import { DEFAULT_THEME } from './themes';

/*
 * Drashti's built-in themes (Session 26), beside Drashti default: a colour
 * behind the words (never a picture), the fonts Drashti bundles for each
 * language, and a shadow behind light words on a dark background. Every
 * language's words, and a Shastra passage's reference line, are 7:1 or more
 * against the background, for dim halls and washed-out projectors
 * (builtin-themes.test.ts). Each library is given them once (db/seed.ts): a
 * deleted one stays deleted, and changing one makes a copy.
 */

export interface BuiltinTheme {
  /** Its own name in the library, kept whatever it is called. */
  key: string;
  fields: ThemeFields;
}

interface Palette {
  key: string;
  name: string;
  background: string;
  /** Gujarati, Hindi and Sanskrit: the main lines. */
  words: string;
  english: string;
  /** Transliteration and the reference line: softer, still 7:1. */
  soft: string;
  /** The high-contrast ones: bold, and nothing but the two colours. */
  plain?: boolean;
}

function theme(p: Palette): ThemeFields {
  // A shadow helps light words on a dark background; behind dark words on a light one it looks muddy.
  const shadow = !p.plain && luminance(p.words) > luminance(p.background);
  const style = (lang: Lang, color: string): ThemeLangStyle => ({
    ...DEFAULT_THEME.langs[lang],
    color,
    shadow,
    ...(p.plain ? { weight: 700 } : {}),
  });
  return {
    ...DEFAULT_THEME,
    name: p.name,
    langs: {
      en: style('en', p.english),
      gu: style('gu', p.words),
      hi: style('hi', p.words),
      translit: style('translit', p.soft),
      sa: style('sa', p.words),
      'sa-gu': style('sa-gu', p.words),
    },
    reference: { ...DEFAULT_THEME.reference, color: p.soft, shadow },
    background: { kind: 'color', color: p.background },
  };
}

const PALETTES: Palette[] = [
  {
    key: 'midnight',
    name: 'Midnight',
    background: '#0b1026',
    words: '#ffffff',
    english: '#ffffff',
    soft: '#c7d2fe',
  },
  {
    key: 'plum-and-flame',
    name: 'Plum and Flame',
    background: '#2e0b3a',
    words: '#ffb347',
    english: '#fde7c8',
    soft: '#ffd59e',
  },
  {
    key: 'saffron',
    name: 'Saffron',
    background: '#f6a623',
    words: '#2b1200',
    english: '#2b1200',
    soft: '#3d1d00',
  },
  {
    key: 'maroon-and-gold',
    name: 'Maroon and Gold',
    background: '#4a0d1a',
    words: '#ffd166',
    english: '#fff3d6',
    soft: '#f5deb3',
  },
  {
    key: 'forest',
    name: 'Forest',
    background: '#0f2d1c',
    words: '#f1f8e9',
    english: '#f1f8e9',
    soft: '#c5e1a5',
  },
  {
    key: 'ocean',
    name: 'Ocean',
    background: '#062a3f',
    words: '#e0f7fa',
    english: '#e0f7fa',
    soft: '#80deea',
  },
  {
    key: 'ivory',
    name: 'Ivory',
    background: '#fbf6e9',
    words: '#2b2118',
    english: '#2b2118',
    soft: '#4a3b2c',
  },
  {
    key: 'charcoal',
    name: 'Charcoal',
    background: '#222222',
    words: '#f5f5f5',
    english: '#f5f5f5',
    soft: '#d4d4d4',
  },
  {
    key: 'high-contrast-white-on-black',
    name: 'High Contrast White on Black',
    background: '#000000',
    words: '#ffffff',
    english: '#ffffff',
    soft: '#ffffff',
    plain: true,
  },
  {
    key: 'high-contrast-black-on-white',
    name: 'High Contrast Black on White',
    background: '#ffffff',
    words: '#000000',
    english: '#000000',
    soft: '#000000',
    plain: true,
  },
];

export const BUILTIN_THEMES: readonly BuiltinTheme[] = PALETTES.map((p) => ({
  key: p.key,
  fields: theme(p),
}));
