import { z } from 'zod';
import { animationById, isAnimation } from './lower-third-animations';
import { LOWER_THIRD_FONTS, type LowerThirdFont } from './lower-thirds';
import { MESSAGE_TEXT } from './safe-areas';

/*
 * A hall message's look (Session 55, Part 15), kept with each message in the library: where it sits (top, middle or
 * bottom, and left, centre or right, or dragged to a place), how it comes and goes (the animations the Lower Thirds
 * studio uses, shared/lower-third-animations.ts, one set for both), its font, its size (the standard size, with
 * steps bigger and smaller), its colour and weight, and a band across the picture or a box round the words behind
 * it, with that colour and how see-through it is. A message with the standard look keeps no look at all: it shows
 * exactly as every message did before (one band along the bottom, several joined with a dot), so an older library
 * and an older engine state read whole. How long a message stays up is the message's, not its look's.
 */

export type MessageRow = 'top' | 'middle' | 'bottom';
export type MessageColumn = 'left' | 'centre' | 'right';
export const MESSAGE_ROWS = ['top', 'middle', 'bottom'] as const satisfies readonly MessageRow[];
export const MESSAGE_COLUMNS = ['left', 'centre', 'right'] as const satisfies readonly MessageColumn[];
export const ROW_NAMES: Record<MessageRow, string> = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };
export const COLUMN_NAMES: Record<MessageColumn, string> = { left: 'Left', centre: 'Centre', right: 'Right' };

/**
 * Where a message sits: in one of nine places (a row and a column), or where it was dragged to, its middle at x and
 * y (fractions of the picture's width and height, 0 to 1).
 */
export type MessagePlace = { row: MessageRow; column: MessageColumn } | { x: number; y: number };

export const isDragged = (place: MessagePlace): place is { x: number; y: number } => 'x' in place;

/** What is behind the words: a band across the picture, a box round the words, or nothing. */
export type MessageBehind = 'band' | 'box' | 'none';
export const MESSAGE_BEHIND = ['band', 'box', 'none'] as const satisfies readonly MessageBehind[];
export const BEHIND_NAMES: Record<MessageBehind, string> = {
  band: 'A band across',
  box: 'A box round the words',
  none: 'Nothing',
};

export const MESSAGE_WEIGHTS = [400, 500, 700] as const;
export type MessageWeight = (typeof MESSAGE_WEIGHTS)[number];
export const WEIGHT_NAMES: Record<MessageWeight, string> = { 400: 'Regular', 500: 'Medium', 700: 'Bold' };

/** Steps from the standard size: each bigger step is a fifth larger (four smaller, eight bigger). */
export const MESSAGE_SIZE = { min: -4, max: 8 } as const;
const SIZE_STEP = 1.2;

export interface MessageLook {
  place: MessagePlace;
  /** How it comes in and goes out: an animation id from shared/lower-third-animations.ts. */
  animation: string;
  font: LowerThirdFont;
  /** Steps from the standard size (0), MESSAGE_SIZE.min to MESSAGE_SIZE.max. */
  size: number;
  /** The words' colour, "#rrggbb". */
  color: string;
  weight: MessageWeight;
  behind: MessageBehind;
  /** The band's or box's colour, "#rrggbb", and how solid it is (0, see-through, to 1). */
  behindColor: string;
  behindOpacity: number;
}

/** How every message looked before Session 55: one band along the bottom, white words, black 72% behind. */
export const DEFAULT_MESSAGE_LOOK: MessageLook = {
  place: { row: 'bottom', column: 'centre' },
  animation: 'fade-steady',
  font: 'Noto Sans',
  size: 0,
  color: '#ffffff',
  weight: 500,
  behind: 'band',
  behindColor: '#000000',
  behindOpacity: 0.72,
};

/** The longest a message stays up by itself (an hour), in seconds; and the shortest. */
export const MESSAGE_SECONDS = { min: 3, max: 3600 } as const;

/** The words' size on a picture this many pixels high: the standard size (Scene.tsx's banner), stepped. */
export const messageTextPx = (look: Pick<MessageLook, 'size'>, height: number): number =>
  Math.round(height * MESSAGE_TEXT * SIZE_STEP ** clampSize(look.size));

export function clampSize(size: number): number {
  return Math.min(MESSAGE_SIZE.max, Math.max(MESSAGE_SIZE.min, Math.round(size)));
}

/** "Standard", "1 step bigger", "2 steps smaller". */
export function sizeWords(size: number): string {
  const s = clampSize(size);
  if (s === 0) return 'Standard';
  const n = Math.abs(s);
  return `${String(n)} ${n === 1 ? 'step' : 'steps'} ${s > 0 ? 'bigger' : 'smaller'}`;
}

/** A place in words: "Bottom centre", "Top left", "Where it was dragged". */
export function placeWords(place: MessagePlace): string {
  if (isDragged(place)) return 'Where it was dragged';
  return `${ROW_NAMES[place.row]} ${COLUMN_NAMES[place.column].toLowerCase()}`;
}

const samePlace = (a: MessagePlace, b: MessagePlace): boolean =>
  isDragged(a)
    ? isDragged(b) && a.x === b.x && a.y === b.y
    : !isDragged(b) && a.row === b.row && a.column === b.column;

/** Whether a look is the standard one, which a message keeps as no look at all. */
export function isDefaultLook(look: MessageLook): boolean {
  const d = DEFAULT_MESSAGE_LOOK;
  return (
    samePlace(look.place, d.place) &&
    look.animation === d.animation &&
    look.font === d.font &&
    clampSize(look.size) === d.size &&
    look.color.toLowerCase() === d.color &&
    look.weight === d.weight &&
    look.behind === d.behind &&
    look.behindColor.toLowerCase() === d.behindColor &&
    Math.abs(look.behindOpacity - d.behindOpacity) < 0.005
  );
}

/** A look as kept: the standard one is none (undefined), so the message shows as every message did before. */
export function keptLook(look: MessageLook | null | undefined): MessageLook | undefined {
  return look && !isDefaultLook(look) ? look : undefined;
}

/** A dragged place kept on the picture: its middle at least 2% in from every edge. */
export function draggedTo(x: number, y: number): { x: number; y: number } {
  const keep = (v: number) => Math.round(Math.min(0.98, Math.max(0.02, v)) * 1000) / 1000;
  return { x: keep(x), y: keep(y) };
}

/**
 * Where a message's box goes on a picture (canvas pixels), for the screens and the editor's small picture alike:
 * a band runs across the whole width at its row (its words left, centred or right inside it); a box and words with
 * nothing behind sit at their place, 5% in from the sides (the title-safe edge) and from the top and bottom, or with
 * their middle where they were dragged. `lift`: pixels kept clear at the bottom (the ticker's band).
 */
export function messageBoxStyle(
  look: Pick<MessageLook, 'place' | 'behind'>,
  canvas: { width: number; height: number },
  lift = 0,
): Record<string, string | number> {
  const inset = { x: canvas.width * 0.05, y: canvas.height * 0.05 };
  const band = look.behind === 'band';
  const place = look.place;
  if (isDragged(place)) {
    return {
      position: 'absolute',
      left: canvas.width * place.x,
      top: canvas.height * place.y,
      transform: 'translate(-50%, -50%)',
      maxWidth: band ? canvas.width : canvas.width * 0.9,
      ...(band ? { width: canvas.width } : {}),
    };
  }
  const vertical: Record<string, string | number> =
    place.row === 'top'
      ? { top: band ? 0 : inset.y }
      : place.row === 'bottom'
        ? { bottom: (band ? 0 : inset.y) + lift }
        : { top: '50%' };
  if (band)
    return {
      position: 'absolute',
      left: 0,
      right: 0,
      ...vertical,
      ...(place.row === 'middle' ? { transform: 'translateY(-50%)' } : {}),
    };
  const horizontal: Record<string, string | number> =
    place.column === 'left'
      ? { left: inset.x }
      : place.column === 'right'
        ? { right: inset.x }
        : { left: '50%' };
  const shift = [place.column === 'centre' ? '-50%' : '0', place.row === 'middle' ? '-50%' : '0'];
  return {
    position: 'absolute',
    ...vertical,
    ...horizontal,
    maxWidth: canvas.width * 0.9,
    ...(shift[0] !== '0' || shift[1] !== '0'
      ? { transform: `translate(${shift[0] ?? '0'}, ${shift[1] ?? '0'})` }
      : {}),
  };
}

/** The words' alignment inside a band or box: as the place's column (dragged: centred). */
export const messageTextAlign = (place: MessagePlace): 'left' | 'center' | 'right' =>
  isDragged(place)
    ? 'center'
    : place.column === 'left'
      ? 'left'
      : place.column === 'right'
        ? 'right'
        : 'center';

/** A colour with its opacity, "#rrggbbaa". */
export const withOpacity = (hex: string, opacity: number): string =>
  `${hex}${Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** A message's animation, the default for one this Drashti does not know (the library's own fallback otherwise). */
export const messageAnimation = (look: Pick<MessageLook, 'animation'> | undefined) =>
  animationById(look && isAnimation(look.animation) ? look.animation : DEFAULT_MESSAGE_LOOK.animation);

// The animations a message offers first (Session 55): a fade, and a slide in from each edge of the picture, across
// to its place. The others are the studio's (Part 16), found by searching.
export const MESSAGE_FIRST_ANIMATIONS = [
  'fade-steady',
  'across-left-steady',
  'across-right-steady',
  'across-up-steady',
  'across-down-steady',
] as const;

// ---- checks for requests arriving over IPC ----------------------------------------

const hex = z.string().regex(/^#[0-9a-f]{6}$/iu, 'a colour as #rrggbb');
const fraction = z.number().min(0).max(1);

export const messagePlaceSchema: z.ZodType<MessagePlace> = z.union([
  z.object({ row: z.enum(MESSAGE_ROWS), column: z.enum(MESSAGE_COLUMNS) }).strict(),
  z.object({ x: fraction, y: fraction }).strict(),
]);

export const messageLookSchema: z.ZodType<MessageLook> = z
  .object({
    place: messagePlaceSchema,
    animation: z.string().max(80).refine(isAnimation, 'an animation from the library'),
    font: z.enum(LOWER_THIRD_FONTS),
    size: z.number().int().min(MESSAGE_SIZE.min).max(MESSAGE_SIZE.max),
    color: hex,
    weight: z.union([z.literal(400), z.literal(500), z.literal(700)]),
    behind: z.enum(MESSAGE_BEHIND),
    behindColor: hex,
    behindOpacity: fraction,
  })
  .strict();

/** A look read from the library or a saved state: whole and valid, or none (the standard look). */
export function readLook(value: unknown): MessageLook | undefined {
  const parsed = messageLookSchema.safeParse(value);
  return parsed.success ? keptLook(parsed.data) : undefined;
}

/** How long a message stays up, read the same way: whole seconds within the limits, or none (until taken off). */
export function readSeconds(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MESSAGE_SECONDS.min &&
    value <= MESSAGE_SECONDS.max
    ? value
    : undefined;
}
