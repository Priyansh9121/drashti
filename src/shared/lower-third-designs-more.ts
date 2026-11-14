import type { LowerThirdTemplate } from './lower-third-templates';
import type { LowerThirdLook } from './lower-thirds';

/** A template made since alpha.17 (Session 58), in lower-third-designs.ts's style. */
export interface MoreDesign {
  id: string;
  name: string;
  feel: LowerThirdTemplate['feel'];
  /** Its lines, placeholder words only; left out: a name and a role. */
  lines?: readonly [string, string, string];
  /** A design's move (lower-third-design-motions.ts), or an animation the studio offers (lower-third-studio.ts). */
  animation: string;
  /** How it goes out, when not as it came in: an animation the studio offers, played backwards. */
  outAnimation?: string;
  /** For an animation the studio offers (a design's move says its own): the side it comes from, and its kind. */
  direction?: LowerThirdTemplate['direction'];
  kind?: LowerThirdTemplate['kind'];
  look: Partial<LowerThirdLook> & Required<Pick<LowerThirdLook, 'style' | 'band' | 'accent'>>;
}

/**
 * The templates made since alpha.17 (Session 58), after lower-third-designs.ts's: original designs, placeholder words
 * only. Each is offered only while it stays smooth on a two-core computer without a graphics chip while streaming: the
 * Performance check's lower-thirds-more scenario plays each one's in and out on every screen
 * (main/lower-thirds/perf-lower-thirds.ts), and one that is not smooth there is left out by deleting it here (its
 * animation, background and style stay, so a lower third saved from it still draws as it was saved).
 */
export const MORE_LOWER_THIRD_DESIGNS: readonly MoreDesign[] = [
  // ---- Part A (Session 58): with alpha.17's moving backgrounds, and plain ones ----
  {
    id: 'saffron-glow',
    name: 'Saffron glow',
    feel: 'calm',
    animation: 'design-reveal-up',
    look: {
      style: 'box',
      band: '#5c2205',
      accent: '#c2410c',
      text: '#fff7ea',
      bandOpacity: 0.92,
      font: 'Mukta',
      motion: 'glow',
    },
  },
  {
    id: 'marigold-sweep',
    name: 'Marigold sweep',
    feel: 'quick',
    animation: 'design-centre-pop',
    look: {
      style: 'pill',
      band: '#7c2d12',
      accent: '#b45309',
      text: '#fffaf0',
      bandOpacity: 0.95,
      align: 'centre',
      font: 'Baloo',
      motion: 'sweep',
    },
  },
  {
    id: 'sandalwood-shine',
    name: 'Sandalwood shine',
    feel: 'elegant',
    animation: 'design-centre-wipe',
    look: {
      style: 'ribbon',
      band: '#f3e3c3',
      accent: '#8b5a2b',
      text: '#3b2611',
      bandOpacity: 1,
      align: 'centre',
      font: 'Noto Serif',
      weight: 400,
      motion: 'shine',
    },
  },
  {
    // In Peacock shapes' place (glass, a quick slide: it dipped twice while streaming): solid, slow.
    id: 'peacock-nameplate',
    name: 'Peacock nameplate',
    feel: 'calm',
    animation: 'design-reveal-up',
    look: {
      style: 'box',
      band: '#0b3d4a',
      accent: '#2bb3a3',
      text: '#f2fffd',
      bandOpacity: 0.92,
      font: 'Montserrat',
      size: 5,
      motion: 'shapes',
    },
  },
  {
    // In Vermilion stripes' place (a slant, a quick slide: it dipped twice while streaming): an accent bar, steady.
    id: 'vermilion-bar',
    name: 'Vermilion bar',
    feel: 'bold',
    animation: 'design-lower',
    look: {
      style: 'accent',
      band: '#8f1d14',
      accent: '#ffb4a2',
      text: '#fff5f2',
      bandOpacity: 0.95,
      font: 'Oswald',
      size: 5.5,
      motion: 'stripes',
    },
  },
  {
    id: 'lotus-sparkles',
    name: 'Lotus sparkles',
    feel: 'elegant',
    animation: 'design-lift',
    look: {
      style: 'stacked',
      band: '#6d1b45',
      accent: '#f7b6d2',
      text: '#fff0f7',
      bandOpacity: 0.92,
      font: 'Hind',
      motion: 'sparkles',
    },
  },
  {
    id: 'evening-gold-line',
    name: 'Evening gold line',
    feel: 'calm',
    animation: 'design-draw-rise',
    look: {
      style: 'band',
      band: '#141c33',
      accent: '#f4c95d',
      text: '#f8f5ec',
      bandOpacity: 0.9,
      font: 'Noto Sans',
      weight: 500,
      bottom: 6,
      motion: 'line',
    },
  },
  {
    id: 'gujarati-glow',
    name: 'Gujarati glow',
    feel: 'elegant',
    lines: ['નમૂના નામ', 'Placeholder role', ''],
    animation: 'line-rise-band-fade-steady',
    direction: 'up',
    kind: 'reveal',
    look: {
      style: 'underline',
      band: '#2a1505',
      accent: '#b45309',
      text: '#fff8ec',
      bandOpacity: 0.9,
      align: 'centre',
      font: 'Mukta',
      motion: 'glow',
    },
  },
  {
    id: 'navy-and-gold-nameplate',
    name: 'Navy and gold nameplate',
    feel: 'elegant',
    animation: 'design-draw-drop',
    look: {
      style: 'accent',
      band: '#0f1f3d',
      accent: '#d4a73c',
      bandOpacity: 0.94,
      font: 'Libre Baskerville',
      weight: 400,
      size: 5.5,
    },
  },
  {
    id: 'maroon-three-lines',
    name: 'Maroon three lines',
    feel: 'bold',
    lines: ['Placeholder name', 'Placeholder title', 'Placeholder place'],
    animation: 'line-slide-left-band-fade-steady',
    direction: 'left',
    kind: 'slide',
    look: { style: 'split', band: '#5c1220', accent: '#2f2a28', bandOpacity: 1, font: 'Hind', size: 5.5 },
  },
  {
    id: 'ivory-three-lines',
    name: 'Ivory three lines',
    feel: 'calm',
    lines: ['Placeholder name', 'Placeholder title', 'Placeholder place'],
    animation: 'line-fade-band-fade-slow',
    direction: 'centre',
    kind: 'reveal',
    look: {
      style: 'box',
      band: '#fbf6ea',
      accent: '#9a7b4f',
      text: '#2b2418',
      bandOpacity: 0.96,
      font: 'Noto Serif',
      size: 4.5,
      bottom: 10,
    },
  },
  {
    id: 'single-title-band',
    name: 'Single title band',
    feel: 'quick',
    lines: ['Placeholder title', '', ''],
    animation: 'wipe-right-steady',
    direction: 'left',
    kind: 'wipe',
    look: { style: 'band', band: '#101828', accent: '#f59e0b', font: 'Montserrat', size: 4.5, bottom: 5 },
  },
  {
    id: 'announcement',
    name: 'Announcement',
    feel: 'calm',
    lines: ['Placeholder announcement', '', ''],
    animation: 'word-fade-band-fade-steady',
    direction: 'centre',
    kind: 'reveal',
    look: {
      style: 'words',
      band: '#000000',
      accent: '#ffffff',
      align: 'centre',
      font: 'Noto Sans',
      size: 5.5,
      bottom: 12,
    },
  },
  {
    id: 'hindi-nameplate',
    name: 'Hindi nameplate',
    feel: 'elegant',
    lines: ['नमूना नाम', 'Placeholder role', ''],
    animation: 'design-reveal-down',
    look: {
      style: 'box',
      band: '#3b0d0d',
      accent: '#e8b04b',
      text: '#fff4e0',
      bandOpacity: 0.92,
      align: 'right',
      font: 'Yatra One',
      weight: 400,
    },
  },
  {
    id: 'gujarati-labels',
    name: 'Gujarati labels',
    feel: 'calm',
    lines: ['નમૂના નામ', 'Placeholder title', ''],
    animation: 'design-lower',
    look: {
      style: 'stacked',
      band: '#0e3b2e',
      accent: '#9fe0c0',
      text: '#f2fff8',
      bandOpacity: 0.92,
      font: 'Noto Sans Gujarati',
      size: 5.5,
    },
  },
  {
    id: 'charcoal-and-saffron-bar',
    name: 'Charcoal and saffron bar',
    feel: 'bold',
    animation: 'design-draw-rise',
    look: {
      style: 'accent',
      band: '#1f1f1f',
      accent: '#f28c28',
      bandOpacity: 0.94,
      align: 'right',
      font: 'Oswald',
      size: 6,
    },
  },
  {
    id: 'deep-green-ribbon',
    name: 'Deep green ribbon',
    feel: 'calm',
    animation: 'reveal-up-steady',
    direction: 'up',
    kind: 'reveal',
    look: {
      style: 'ribbon',
      band: '#0f3d2a',
      accent: '#cfe8b8',
      text: '#f4fbef',
      bandOpacity: 0.95,
      align: 'centre',
      font: 'Hind',
      weight: 400,
    },
  },
  {
    // In White and maroon pill's place (a quick pop: it dipped twice while streaming): an underline, drawn steadily.
    id: 'white-and-maroon-underline',
    name: 'White and maroon underline',
    feel: 'calm',
    animation: 'design-draw-rise',
    look: {
      style: 'underline',
      band: '#ffffff',
      accent: '#7a1f2b',
      text: '#5a1220',
      bandOpacity: 0.97,
      font: 'Montserrat',
      size: 5,
    },
  },
];
