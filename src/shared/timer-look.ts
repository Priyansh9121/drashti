import { z } from 'zod';
import { LOWER_THIRD_FONTS, type LowerThirdFont } from './lower-thirds';
import { STAGE_TIMER_FORMATS, type StageTimerFormat } from './stage-layouts';

/*
 * A timer's look for the audience (Session 55, Part 15), kept with the timer in the library: where it goes (full
 * screen or a corner), over the wallpaper or over what is up, its size, font and colours, a label above it, a ring or
 * a bar of the time left, a warning colour and a flash near the end, what it does at zero, and whether the stage
 * screens show it too. How it draws is shared/audience-timer.ts's.
 */

export type AudienceTimerPlace = 'full' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const AUDIENCE_TIMER_PLACES = [
  'full',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const satisfies readonly AudienceTimerPlace[];
export const PLACE_NAMES: Record<AudienceTimerPlace, string> = {
  full: 'Full screen',
  'top-left': 'Top left corner',
  'top-right': 'Top right corner',
  'bottom-left': 'Bottom left corner',
  'bottom-right': 'Bottom right corner',
};

/** What is behind it: the chosen wallpaper (black until one is chosen), or whatever is up. */
export type AudienceTimerOver = 'wallpaper' | 'content';
export const AUDIENCE_TIMER_OVER = ['wallpaper', 'content'] as const satisfies readonly AudienceTimerOver[];
export const OVER_NAMES: Record<AudienceTimerOver, string> = {
  wallpaper: 'Over the wallpaper',
  content: 'Over what is up',
};

/** The time left drawn as a ring round the time, a bar under it, or neither. */
export type TimeLeftShape = 'ring' | 'bar' | 'none';
export const TIME_LEFT_SHAPES = ['ring', 'bar', 'none'] as const satisfies readonly TimeLeftShape[];
export const SHAPE_NAMES: Record<TimeLeftShape, string> = { ring: 'A ring', bar: 'A bar', none: 'Neither' };

/**
 * At zero (a countdown's): it stays (at 0:00, or counting on below zero when its timer does), shows a message in its
 * place, shows the wallpaper (the whole screen, until it is hidden), or goes by itself (what is up shows again).
 */
export type AudienceTimerAtZero = 'stay' | 'message' | 'wallpaper' | 'gone';
export const AUDIENCE_TIMER_AT_ZERO = [
  'stay',
  'message',
  'wallpaper',
  'gone',
] as const satisfies readonly AudienceTimerAtZero[];
export const AT_ZERO_NAMES: Record<AudienceTimerAtZero, string> = {
  stay: 'It stays',
  message: 'It shows a message',
  wallpaper: 'It shows the wallpaper',
  gone: 'It goes by itself',
};

export interface AudienceTimerLook {
  place: AudienceTimerPlace;
  over: AudienceTimerOver;
  /** Steps from its standard size (0): each a fifth bigger or smaller, -3 to 4. */
  size: number;
  font: LowerThirdFont;
  /** The time's colour, "#rrggbb", and the label's. */
  color: string;
  labelColor: string;
  /** The words above the time ("Activity ends in"); empty for none. */
  label: string;
  format: StageTimerFormat;
  timeLeft: TimeLeftShape;
  /** The ring's or the bar's colour. */
  timeLeftColor: string;
  /** From this much left (ms), the time and its ring or bar turn this colour; null for never. */
  warn: { fromMs: number; color: string } | null;
  /** Near the end (from its warning, else the last 10 seconds) and at zero, it flashes, slowly. */
  flash: boolean;
  atZero: AudienceTimerAtZero;
  /** The message at zero ("Time is up", placeholder words), when it shows one. */
  zeroText: string;
  /** On the stage screens too, as on the audience's. */
  stage: boolean;
}

export const AUDIENCE_TIMER_SIZE = { min: -3, max: 4 } as const;
export const LABEL_MAX = 80;
export const ZERO_TEXT_MAX = 120;

/** A timer's look until it is given one: full screen over what is up, as Show on the screens put a timer up. */
export const DEFAULT_TIMER_LOOK: AudienceTimerLook = {
  place: 'full',
  over: 'content',
  size: 0,
  font: 'Noto Sans',
  color: '#ffffff',
  labelColor: '#d6dae3',
  label: '',
  format: 'auto',
  timeLeft: 'none',
  timeLeftColor: '#f5a524',
  warn: { fromMs: 60_000, color: '#f5a524' },
  flash: false,
  atZero: 'stay',
  zeroText: 'Time is up',
  stage: false,
};

/** Countdown to the start (Q): over the wallpaper on the audience and the stage, gone by itself at zero. */
export const START_COUNTDOWN_NAME = 'Countdown to the start';
export const START_COUNTDOWN_LOOK: AudienceTimerLook = {
  ...DEFAULT_TIMER_LOOK,
  over: 'wallpaper',
  label: 'The sabha starts in',
  timeLeft: 'ring',
  atZero: 'gone',
  stage: true,
};

// ---- checks for requests arriving over IPC ----------------------------------------

const hex = z.string().regex(/^#[0-9a-f]{6}$/iu, 'a colour as #rrggbb');

export const audienceTimerLookSchema: z.ZodType<AudienceTimerLook> = z
  .object({
    place: z.enum(AUDIENCE_TIMER_PLACES),
    over: z.enum(AUDIENCE_TIMER_OVER),
    size: z.number().int().min(AUDIENCE_TIMER_SIZE.min).max(AUDIENCE_TIMER_SIZE.max),
    font: z.enum(LOWER_THIRD_FONTS),
    color: hex,
    labelColor: hex,
    label: z.string().max(LABEL_MAX),
    format: z.enum(STAGE_TIMER_FORMATS),
    timeLeft: z.enum(TIME_LEFT_SHAPES),
    timeLeftColor: hex,
    warn: z
      .object({
        fromMs: z
          .number()
          .int()
          .min(1000)
          .max(3600 * 1000),
        color: hex,
      })
      .strict()
      .nullable(),
    flash: z.boolean(),
    atZero: z.enum(AUDIENCE_TIMER_AT_ZERO),
    zeroText: z.string().max(ZERO_TEXT_MAX),
    stage: z.boolean(),
  })
  .strict();

/** A look read from the library: whole and valid, else none (the default). */
export function readTimerLook(value: unknown): AudienceTimerLook | undefined {
  const parsed = audienceTimerLookSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** A time of day as Countdown to the start takes it: "19:30". */
export const startTimeSchema = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/u);
