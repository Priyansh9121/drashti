/*
 * The fonts a lower third can be in (Session 55, Part 16: the Lower Thirds studio). Drashti's own three Noto fonts,
 * as before, and the studio's: free fonts with an open licence (SIL OFL 1.1), Gujarati and Devanagari among them,
 * bundled with Drashti (render/studio-fonts.css, their files in render/studio-fonts/) and never downloaded while it
 * runs. Each is listed with its source and sha256 in LICENSES/fonts/README.md, beside its licence text.
 *
 * A choice can be a family of fonts made to go together: Mukta draws English and Hindi, and its sister Mukta Vaani
 * Gujarati, so a lower third in Mukta looks the same in all three. Letters a choice has no font for are drawn by
 * Drashti's own Noto fonts (render/fonts.ts), as every word on the screens is.
 */

export type FontScript = 'latin' | 'gujarati' | 'devanagari';

export interface LowerThirdFontChoice {
  /** The name a lower third keeps (its look's `font`) and the studio shows. */
  name: string;
  /** Its CSS families, first to last: each draws the letters the ones before it lack. */
  families: readonly string[];
  /** The weights it has (a lower third's other weights are drawn in the nearest). */
  weights: readonly (400 | 500 | 700)[];
  /** The scripts it draws itself. */
  scripts: readonly FontScript[];
  kind: 'sans' | 'serif' | 'display';
  /** Drashti's own from the start (render/fonts.css), or the studio's (render/studio-fonts.css). */
  bundled: 'noto' | 'studio';
}

/** Every choice, in the order the studio lists them; the first three are the ones before the studio. */
export const LOWER_THIRD_FONTS = [
  'Noto Sans',
  'Noto Sans Gujarati',
  'Noto Sans Devanagari',
  'Mukta',
  'Hind',
  'Baloo',
  'Noto Serif',
  'Montserrat',
  'Libre Baskerville',
  'Oswald',
  'Shrikhand',
  'Yatra One',
] as const;
export type LowerThirdFont = (typeof LOWER_THIRD_FONTS)[number];

const ALL: readonly FontScript[] = ['latin', 'gujarati', 'devanagari'];

/** Drashti's own Noto Sans: the first choice, and the one drawn for a name this Drashti does not know. */
const NOTO_SANS: LowerThirdFontChoice = {
  name: 'Noto Sans',
  families: ['Noto Sans'],
  weights: [400, 500, 700],
  scripts: ALL,
  kind: 'sans',
  bundled: 'noto',
};

export const LOWER_THIRD_FONT_CHOICES: readonly LowerThirdFontChoice[] = [
  NOTO_SANS,
  {
    name: 'Noto Sans Gujarati',
    families: ['Noto Sans Gujarati'],
    weights: [400, 500, 700],
    scripts: ['gujarati', 'latin'],
    kind: 'sans',
    bundled: 'noto',
  },
  {
    name: 'Noto Sans Devanagari',
    families: ['Noto Sans Devanagari'],
    weights: [400, 500, 700],
    scripts: ['devanagari', 'latin'],
    kind: 'sans',
    bundled: 'noto',
  },
  // Ek Type's Mukta (English and Hindi) with Mukta Vaani (Gujarati).
  {
    name: 'Mukta',
    families: ['Mukta', 'Mukta Vaani'],
    weights: [400, 700],
    scripts: ALL,
    kind: 'sans',
    bundled: 'studio',
  },
  // The Indian Type Foundry's Hind (English and Hindi) with Hind Vadodara (Gujarati).
  {
    name: 'Hind',
    families: ['Hind', 'Hind Vadodara'],
    weights: [400, 700],
    scripts: ALL,
    kind: 'sans',
    bundled: 'studio',
  },
  // Ek Type's rounded Baloo 2 (English and Hindi) with Baloo Bhai 2 (Gujarati).
  {
    name: 'Baloo',
    families: ['Baloo 2', 'Baloo Bhai 2'],
    weights: [400, 700],
    scripts: ALL,
    kind: 'display',
    bundled: 'studio',
  },
  {
    name: 'Noto Serif',
    families: ['Noto Serif', 'Noto Serif Gujarati', 'Noto Serif Devanagari'],
    weights: [400, 700],
    scripts: ALL,
    kind: 'serif',
    bundled: 'studio',
  },
  {
    name: 'Montserrat',
    families: ['Montserrat'],
    weights: [400, 700],
    scripts: ['latin'],
    kind: 'sans',
    bundled: 'studio',
  },
  {
    name: 'Libre Baskerville',
    families: ['Libre Baskerville'],
    weights: [400, 700],
    scripts: ['latin'],
    kind: 'serif',
    bundled: 'studio',
  },
  {
    name: 'Oswald',
    families: ['Oswald'],
    weights: [400, 700],
    scripts: ['latin'],
    kind: 'sans',
    bundled: 'studio',
  },
  // Gujarati titles (and English).
  {
    name: 'Shrikhand',
    families: ['Shrikhand'],
    weights: [400],
    scripts: ['gujarati', 'latin'],
    kind: 'display',
    bundled: 'studio',
  },
  // Hindi titles (and English).
  {
    name: 'Yatra One',
    families: ['Yatra One'],
    weights: [400],
    scripts: ['devanagari', 'latin'],
    kind: 'display',
    bundled: 'studio',
  },
];

const BY_NAME = new Map(LOWER_THIRD_FONT_CHOICES.map((f) => [f.name, f]));

/** A choice by its name (Drashti's own Noto Sans for one this Drashti does not know). */
export function fontChoice(name: string): LowerThirdFontChoice {
  return BY_NAME.get(name) ?? NOTO_SANS;
}

/** The weight a choice draws for the one asked: the nearest it has (the lighter of two as near). */
export function nearestWeight(choice: LowerThirdFontChoice, weight: number): 400 | 500 | 700 {
  let best = choice.weights[0] ?? 400;
  for (const w of choice.weights)
    if (
      Math.abs(w - weight) < Math.abs(best - weight) ||
      (Math.abs(w - weight) === Math.abs(best - weight) && w < best)
    )
      best = w;
  return best;
}

/** Where every file of the studio's fonts came from (fontsource's files of Google Fonts' fonts, 5.3.0). */
const FROM = 'https://cdn.jsdelivr.net/npm/@fontsource';

/** One of the studio's font files: its family, weight, the letters it draws, its file, source and licence. */
export interface StudioFontFile {
  family: string;
  weight: 400 | 700;
  subset: 'latin' | 'latin-ext' | 'gujarati' | 'devanagari';
  file: string;
  source: string;
  /** Its licence text, in LICENSES/fonts. */
  licence: string;
}

function files(
  pkg: string,
  family: string,
  licence: string,
  subsets: readonly StudioFontFile['subset'][],
  weights: readonly (400 | 700)[],
): StudioFontFile[] {
  return subsets.flatMap((subset) =>
    weights.map((weight) => {
      const file = `${pkg}-${subset}-${String(weight)}-normal.woff2`;
      return { family, weight, subset, file, source: `${FROM}/${pkg}@5.3.0/files/${file}`, licence };
    }),
  );
}

const LATIN = ['latin', 'latin-ext'] as const;
const BOTH = [400, 700] as const;

/** Every file of the studio's fonts (render/studio-fonts/), as render/studio-fonts.css names them. */
export const STUDIO_FONT_FILES: readonly StudioFontFile[] = [
  ...files('mukta', 'Mukta', 'OFL-1.1-Mukta.txt', [...LATIN, 'devanagari'], BOTH),
  ...files('mukta-vaani', 'Mukta Vaani', 'OFL-1.1-Mukta-Vaani.txt', ['gujarati'], BOTH),
  ...files('hind', 'Hind', 'OFL-1.1-Hind.txt', [...LATIN, 'devanagari'], BOTH),
  ...files('hind-vadodara', 'Hind Vadodara', 'OFL-1.1-Hind-Vadodara.txt', ['gujarati'], BOTH),
  ...files('baloo-2', 'Baloo 2', 'OFL-1.1-Baloo-2.txt', [...LATIN, 'devanagari'], BOTH),
  ...files('baloo-bhai-2', 'Baloo Bhai 2', 'OFL-1.1-Baloo-Bhai-2.txt', ['gujarati'], BOTH),
  ...files('noto-serif', 'Noto Serif', 'OFL-1.1-Noto-Serif.txt', LATIN, BOTH),
  ...files(
    'noto-serif-gujarati',
    'Noto Serif Gujarati',
    'OFL-1.1-Noto-Serif-Gujarati.txt',
    ['gujarati'],
    BOTH,
  ),
  ...files(
    'noto-serif-devanagari',
    'Noto Serif Devanagari',
    'OFL-1.1-Noto-Serif-Devanagari.txt',
    ['devanagari'],
    BOTH,
  ),
  ...files('montserrat', 'Montserrat', 'OFL-1.1-Montserrat.txt', LATIN, BOTH),
  ...files('libre-baskerville', 'Libre Baskerville', 'OFL-1.1-Libre-Baskerville.txt', LATIN, BOTH),
  ...files('oswald', 'Oswald', 'OFL-1.1-Oswald.txt', LATIN, BOTH),
  ...files('shrikhand', 'Shrikhand', 'OFL-1.1-Shrikhand.txt', [...LATIN, 'gujarati'], [400]),
  ...files('yatra-one', 'Yatra One', 'OFL-1.1-Yatra-One.txt', [...LATIN, 'devanagari'], [400]),
];

/** A line of words for loading a choice's every file: Latin with marks, Gujarati and Devanagari. */
export const FONT_SAMPLE = 'Aa āīūṣṇḍṁṭṅ ક્ષ સ્વ क्ष स्व';
