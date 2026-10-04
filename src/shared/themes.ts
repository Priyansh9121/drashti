import { z } from 'zod';
import type { MediaFit } from './engine/state';
import type { Lang, TextAlign, VerticalAlign } from './model';
import { LANGS } from './model';

/*
 * Themes (PLAN.md 4.3): how a presentation's words look, per language, where
 * its text box sits, and what is behind it. Applying a theme changes styles,
 * never words. Sizes are in slide pixels for a 1080-high slide (scaled for
 * other sizes); the box is in fractions of the slide, so a theme fits any
 * presentation.
 */

export interface ThemeLangStyle {
  /** Font family; null uses the bundled font for the language. */
  font: string | null;
  /** Size in slide pixels on a 1080-high slide. */
  size: number;
  weight: number;
  /** "#rrggbb". */
  color: string;
  shadow: boolean;
}

export interface ThemeBox {
  /** Where the first text box of each slide goes, as fractions of the slide (0 to 1). */
  x: number;
  y: number;
  width: number;
  height: number;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
}

/** A Shastra passage's reference line ("Satsang Diksha 14"): its look, and above or below the words. */
export interface ThemeReference extends ThemeLangStyle {
  place: 'top' | 'bottom';
}

export type ThemeBackground =
  /** The theme leaves backgrounds as they are. */
  | { kind: 'none' }
  | { kind: 'color'; color: string }
  /** A picture or video, as a background cue on every slide (the same file carries on). */
  | { kind: 'media'; mediaId: string; media: 'image' | 'video'; fit: MediaFit; loop: boolean };

export interface Theme {
  id: string;
  name: string;
  langs: Record<Lang, ThemeLangStyle>;
  /** How a Shastra passage's reference line looks (presentations have none). */
  reference: ThemeReference;
  box: ThemeBox;
  background: ThemeBackground;
}

export type ThemeFields = Omit<Theme, 'id'>;

export type ThemeResult = { ok: true; id: string } | { ok: false; message: string };

export type ApplyThemeResult =
  { ok: true; revisionId: string; count: number } | { ok: false; message: string };

export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  gu: 'Gujarati',
  hi: 'Hindi',
  translit: 'Transliteration',
  sa: 'Sanskrit (Devanagari)',
  'sa-gu': 'Sanskrit (Gujarati script)',
};

/** Short names, for badges in lists. */
export const LANG_SHORT: Record<Lang, string> = {
  en: 'EN',
  gu: 'GU',
  hi: 'HI',
  translit: 'TR',
  sa: 'SA',
  'sa-gu': 'SA·GU',
};

/** The reference line as themes start with it: smaller than the words, above them. */
export const DEFAULT_REFERENCE: ThemeReference = {
  font: null,
  size: 44,
  weight: 500,
  color: '#e5e7eb',
  shadow: true,
  place: 'top',
};

/** The look presentations made in Drashti start with: white text, a bigger Gujarati and Hindi line, a smaller transliteration. */
export const DEFAULT_THEME: ThemeFields = {
  name: 'Drashti default',
  langs: {
    en: { font: null, size: 80, weight: 500, color: '#ffffff', shadow: true },
    gu: { font: null, size: 88, weight: 500, color: '#ffffff', shadow: true },
    hi: { font: null, size: 84, weight: 500, color: '#ffffff', shadow: true },
    translit: { font: null, size: 60, weight: 400, color: '#e5e7eb', shadow: true },
    sa: { font: null, size: 84, weight: 500, color: '#ffffff', shadow: true },
    'sa-gu': { font: null, size: 88, weight: 500, color: '#ffffff', shadow: true },
  },
  reference: DEFAULT_REFERENCE,
  box: {
    x: 0.05,
    y: 0.0889,
    width: 0.9,
    height: 0.8222,
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.25,
  },
  background: { kind: 'none' },
};

// ---- checks for requests arriving over IPC ----------------------------------------

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const langStyle = z
  .object({
    font: z.string().trim().min(1).max(200).nullable(),
    size: z.number().min(8).max(600),
    weight: z.number().int().min(100).max(900),
    color,
    shadow: z.boolean(),
  })
  .strict();
const fraction = z.number().min(0).max(1);

/**
 * A theme as kept before Session 12 has no Sanskrit styles and no reference
 * line: Sanskrit starts with the style of the language sharing its script
 * (Hindi for Devanagari, Gujarati for Gujarati script), the reference line
 * with Drashti's.
 */
function withSessionTwelve(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const theme = raw as { langs?: unknown; reference?: unknown };
  const langs =
    typeof theme.langs === 'object' && theme.langs !== null
      ? (theme.langs as Partial<Record<Lang, unknown>>)
      : null;
  return {
    ...theme,
    ...(langs ? { langs: { ...langs, sa: langs.sa ?? langs.hi, 'sa-gu': langs['sa-gu'] ?? langs.gu } } : {}),
    reference: theme.reference ?? DEFAULT_REFERENCE,
  };
}

export const themeFieldsSchema: z.ZodType<ThemeFields> = z.preprocess(
  withSessionTwelve,
  z
    .object({
      name: z.string().trim().min(1).max(80),
      langs: z
        .object(Object.fromEntries(LANGS.map((l) => [l, langStyle])) as Record<Lang, typeof langStyle>)
        .strict(),
      reference: langStyle.extend({ place: z.enum(['top', 'bottom']) }).strict(),
      box: z
        .object({
          x: fraction,
          y: fraction,
          width: fraction.min(0.05),
          height: fraction.min(0.05),
          align: z.enum(['left', 'center', 'right']),
          verticalAlign: z.enum(['top', 'middle', 'bottom']),
          lineHeight: z.number().min(0.6).max(3),
        })
        .strict(),
      background: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }).strict(),
        z.object({ kind: z.literal('color'), color }).strict(),
        z
          .object({
            kind: z.literal('media'),
            mediaId: z.string().min(1).max(128),
            media: z.enum(['image', 'video']),
            fit: z.enum(['fit', 'fill', 'stretch']),
            loop: z.boolean(),
          })
          .strict(),
      ]),
    })
    .strict(),
);
