import type { AnimationSpeed } from './lower-third-animations';
import type { LowerThirdTemplate } from './lower-third-templates';

type Direction = LowerThirdTemplate['direction'];
type From = Exclude<Direction, 'centre'>;

interface DesignMotion {
  name: string;
  direction: Direction;
  kind: Exclude<LowerThirdTemplate['kind'], 'letters'>;
  speed: AnimationSpeed;
  nameFrom: From;
  roleFrom: From;
}

/**
 * The designs' moves: the band and accent move first, followed by the name and role in their own directions.
 *
 * The library of every lower third made from a design: a lower third keeps its move's id (never its design's), so
 * each move here is kept with the lower thirds saved with it. Never delete one: a lower third saved with it could
 * no longer go up, nor be saved again. A design that is not smooth (the Performance check) is left out by deleting
 * it from lower-third-designs.ts: its move stays here, and one saved from it still draws as it was saved (Part 16's
 * rule, lower-third-studio.ts).
 */
export const DESIGN_MOTIONS = {
  'design-draw-rise': {
    name: 'Draw the line, then rise and slide',
    direction: 'left',
    kind: 'reveal',
    speed: 'steady',
    nameFrom: 'up',
    roleFrom: 'right',
  },
  'design-draw-drop': {
    name: 'Draw the line from right, then lower the name',
    direction: 'right',
    kind: 'wipe',
    speed: 'slow',
    nameFrom: 'down',
    roleFrom: 'left',
  },
  'design-lift': {
    name: 'Slide the panel up, then bring in the words',
    direction: 'up',
    kind: 'slide',
    speed: 'quick',
    nameFrom: 'up',
    roleFrom: 'left',
  },
  'design-lower': {
    name: 'Slide the panel down, then bring in the words',
    direction: 'down',
    kind: 'slide',
    speed: 'steady',
    nameFrom: 'right',
    roleFrom: 'left',
  },
  'design-centre-wipe': {
    name: 'Open from the centre, then slide the words from opposite sides',
    direction: 'centre',
    kind: 'wipe',
    speed: 'steady',
    nameFrom: 'left',
    roleFrom: 'right',
  },
  'design-centre-pop': {
    name: 'Pop the panel, then raise the name and role',
    direction: 'centre',
    kind: 'pop',
    speed: 'quick',
    nameFrom: 'up',
    roleFrom: 'up',
  },
  'design-slide-left': {
    name: 'Slide the panel from left, then raise the name',
    direction: 'left',
    kind: 'slide',
    speed: 'steady',
    nameFrom: 'up',
    roleFrom: 'right',
  },
  'design-slide-right': {
    name: 'Slide the panel from right, then raise the name',
    direction: 'right',
    kind: 'slide',
    speed: 'quick',
    nameFrom: 'up',
    roleFrom: 'left',
  },
  'design-reveal-up': {
    name: 'Reveal the panel upwards, then lift the words in turn',
    direction: 'up',
    kind: 'reveal',
    speed: 'slow',
    nameFrom: 'up',
    roleFrom: 'up',
  },
  'design-reveal-down': {
    name: 'Reveal the panel downwards, then slide the words in turn',
    direction: 'down',
    kind: 'reveal',
    speed: 'slow',
    nameFrom: 'down',
    roleFrom: 'right',
  },
} as const satisfies Record<string, DesignMotion>;

export type DesignMotionId = keyof typeof DESIGN_MOTIONS;

export const isDesignMotion = (id: string): id is DesignMotionId => Object.hasOwn(DESIGN_MOTIONS, id);
