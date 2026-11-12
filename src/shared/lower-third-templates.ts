import { type AnimationSpeed, animationById, DEFAULT_ANIMATION } from './lower-third-animations';
import { DESIGN_MOTIONS } from './lower-third-design-motions';
import { LOWER_THIRD_DESIGNS } from './lower-third-designs';
import { isOffered, OFFERED_MOTIONS, OFFERED_STYLES } from './lower-third-studio';
import type { LowerThirdMotion, LowerThirdStyle } from './lower-third-styles';
import { DEFAULT_LOWER_THIRD_LOOK, type LowerThirdInput, type LowerThirdLook } from './lower-thirds';

/** The Studio's template gallery and the Performance scenario use this catalogue. */
const offeredOr = (id: string): string => (isOffered(id) ? id : DEFAULT_ANIMATION);
const styleOr = (style: LowerThirdStyle): LowerThirdStyle =>
  OFFERED_STYLES.includes(style) ? style : (OFFERED_STYLES[0] ?? 'box');
const motionOr = (motion: LowerThirdMotion): LowerThirdMotion =>
  OFFERED_MOTIONS.includes(motion) ? motion : 'none';

export interface LowerThirdTemplate {
  id: string;
  name: string;
  /** Left and right name the side it enters from. Up rises from below and down drops from above. */
  direction: 'left' | 'right' | 'up' | 'down' | 'centre';
  kind: 'slide' | 'wipe' | 'reveal' | 'pop' | 'letters';
  feel: 'quick' | 'elegant' | 'bold' | 'calm';
  speed: AnimationSpeed;
  input: LowerThirdInput;
}

interface TemplateMaking extends Omit<LowerThirdTemplate, 'input' | 'speed'> {
  lines: [string, string, string];
  look: Partial<LowerThirdLook> & Pick<LowerThirdLook, 'style'>;
  animation: string;
  outAnimation?: string;
}

const MAKINGS: readonly TemplateMaking[] = [
  {
    id: 'name-title',
    name: 'Name and title',
    direction: 'left',
    kind: 'slide',
    feel: 'calm',
    lines: ['Placeholder name', 'Placeholder title', ''],
    look: { style: 'box' },
    animation: 'slide-left-steady',
  },
  {
    id: 'news-band',
    name: 'News band',
    direction: 'left',
    kind: 'wipe',
    feel: 'bold',
    lines: ['Placeholder name', 'Placeholder title', ''],
    look: {
      style: 'band',
      band: '#0b1f3a',
      bandOpacity: 0.92,
      accent: '#e11d48',
      font: 'Oswald',
      motion: 'line',
    },
    animation: 'wipe-right-steady',
  },
  {
    id: 'pill',
    name: 'Soft pill',
    direction: 'centre',
    kind: 'pop',
    feel: 'quick',
    lines: ['Placeholder name', 'Placeholder title', ''],
    look: {
      style: 'pill',
      band: '#ffffff',
      bandOpacity: 0.95,
      text: '#1f2937',
      font: 'Baloo',
      align: 'centre',
    },
    animation: 'pop-steady',
    outAnimation: 'fade-quick',
  },
  {
    id: 'ribbon',
    name: 'Ribbon',
    direction: 'up',
    kind: 'reveal',
    feel: 'elegant',
    lines: ['Placeholder name', 'Placeholder title', ''],
    look: {
      style: 'ribbon',
      band: '#7c2d12',
      bandOpacity: 0.95,
      accent: '#fbbf24',
      text: '#fff7ed',
      font: 'Mukta',
      align: 'centre',
      motion: 'shine',
    },
    animation: 'reveal-up-steady',
  },
  {
    id: 'glass',
    name: 'Glass',
    direction: 'centre',
    kind: 'reveal',
    feel: 'calm',
    lines: ['Placeholder name', 'Placeholder title', ''],
    look: { style: 'glass', band: '#0f172a', bandOpacity: 0.6, font: 'Montserrat' },
    animation: 'fade-steady',
  },
  {
    id: 'two-colours',
    name: 'Two colours',
    direction: 'up',
    kind: 'reveal',
    feel: 'bold',
    lines: ['Placeholder name', 'Placeholder title', 'Placeholder place'],
    look: { style: 'split', band: '#1e3a8a', bandOpacity: 0.95, accent: '#b45309', font: 'Hind' },
    animation: 'line-reveal-band-fade-steady',
  },
  {
    id: 'outline',
    name: 'Outline',
    direction: 'centre',
    kind: 'letters',
    feel: 'calm',
    lines: ['Placeholder name', 'Placeholder title', ''],
    look: {
      style: 'outline',
      band: '#000000',
      bandOpacity: 0.35,
      accent: '#ffffff',
      font: 'Libre Baskerville',
      weight: 400,
      align: 'centre',
    },
    animation: 'letter-type-band-fade-steady',
  },
  {
    id: 'accent-bar',
    name: 'Accent bar',
    direction: 'left',
    kind: 'slide',
    feel: 'bold',
    lines: ['Placeholder name', 'Placeholder title', ''],
    look: { style: 'accent', band: '#111827', bandOpacity: 0.9, accent: '#f97316', font: 'Noto Serif' },
    animation: 'slide-left-steady',
  },
  {
    id: 'gujarati',
    name: 'Gujarati title',
    direction: 'up',
    kind: 'reveal',
    feel: 'elegant',
    lines: ['નમૂના નામ', 'Placeholder title', ''],
    look: {
      style: 'stacked',
      band: '#7f1d1d',
      bandOpacity: 0.9,
      font: 'Shrikhand',
      weight: 400,
      align: 'centre',
      motion: 'sparkles',
    },
    animation: 'word-rise-band-fade-steady',
  },
  {
    id: 'hindi',
    name: 'Hindi title',
    direction: 'up',
    kind: 'reveal',
    feel: 'elegant',
    lines: ['नमूना नाम', 'Placeholder title', ''],
    look: {
      style: 'underline',
      band: '#1f2937',
      bandOpacity: 0.85,
      accent: '#fbbf24',
      font: 'Yatra One',
      weight: 400,
    },
    animation: 'line-rise-band-fade-steady',
  },
];

/**
 * Templates to start from, with placeholder words only, each from what is offered (a choice left out of OFFERED
 * falls back: the default animation, a box, no moving background).
 */
const STUDIO_TEMPLATES: readonly LowerThirdTemplate[] = MAKINGS.map((m) => {
  const look: LowerThirdLook = {
    ...DEFAULT_LOWER_THIRD_LOOK,
    ...m.look,
    style: styleOr(m.look.style ?? 'box'),
    ...(m.look.motion ? { motion: motionOr(m.look.motion) } : {}),
  };
  const out = m.outAnimation && isOffered(m.outAnimation) ? { outAnimation: m.outAnimation } : {};
  const animation = offeredOr(m.animation);
  return {
    id: m.id,
    name: m.name,
    direction: animation === m.animation ? m.direction : 'left',
    kind: animation === m.animation ? m.kind : 'slide',
    feel: m.feel,
    speed: animationById(animation).speed,
    input: { lines: [...m.lines], look, where: 'both', animation, ...out },
  };
});

export const LOWER_THIRD_TEMPLATES: readonly LowerThirdTemplate[] = [
  ...STUDIO_TEMPLATES,
  ...LOWER_THIRD_DESIGNS.map(({ id, name, feel, animation, look }): LowerThirdTemplate => {
    const { direction, kind, speed } = DESIGN_MOTIONS[animation];
    return {
      id,
      name,
      direction,
      kind,
      feel,
      speed,
      input: {
        lines: ['Placeholder name', 'Placeholder role', ''],
        look: { ...DEFAULT_LOWER_THIRD_LOOK, ...look, style: styleOr(look.style) },
        where: 'both',
        animation,
      },
    };
  }),
];

const BEST_IDS = [
  'name-title',
  'news-band',
  'gold-underline',
  'midnight-bulletin',
  'white-nameplate',
  'blue-speaker-strip',
  'teal-band',
  'copper-ribbon',
  'emerald-labels',
  'slate-labels',
  'soft-blue-pill',
  'ivory-caption',
  'gujarati',
  'hindi',
  'outline',
  'cream-ribbon',
  'indigo-slant',
  'mint-name-and-role',
  'copper-and-charcoal',
  'charcoal-glass',
];

/** A mix of directions, speeds and looks. Fill any gaps if a design is taken out after Performance. */
export const BEST_LOWER_THIRD_TEMPLATES: readonly LowerThirdTemplate[] = [
  ...BEST_IDS.flatMap((id) => LOWER_THIRD_TEMPLATES.filter((template) => template.id === id)),
  ...LOWER_THIRD_TEMPLATES.filter((template) => !BEST_IDS.includes(template.id)),
].slice(0, 20);
