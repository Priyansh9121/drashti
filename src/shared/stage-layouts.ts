import { z } from 'zod';
import { CALENDAR_LANGS, type CalendarLang } from './calendar';
import type { Rect } from './model';
import { hexColorSchema, idSchema } from './model-schema';
import type { ScalingMode, ScreenRole } from './screens';
import { SCALING_MODES } from './screens';

/*
 * Stage layouts (Session 11): what a stage screen shows, as boxes placed on
 * a 1920 x 1080 canvas (screens of another size scale it, as they do
 * slides). Each stage group gets its layout through the live Look; a group
 * with none shows the Standard stage screen, drawn exactly as it was before
 * layouts (render/StageView.tsx). Standard is built in and cannot be
 * changed; Duplicate makes boxes from it to change.
 */

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export type StageBoxKind =
  /** The slide on the screens: its words in the group's languages. */
  | 'current'
  /** What Next will show: the next slide's words, or the next item's name. */
  | 'next'
  /** The live slide's notes. */
  | 'notes'
  /** The time of day, written as Drashti's computer writes it (and, if chosen, today's Samvat date under it). */
  | 'clock'
  /** Today's Samvat date, tithi and festivals, from the loaded calendars (Session 12). */
  | 'samvat'
  /** The quote of the day (one per date), from the idle rotation's quotes (Session 12). */
  | 'quote'
  /** One chosen timer, or every running timer. */
  | 'timer'
  /** The operator's message for the stage. */
  | 'stageMessage'
  /** The playlist's next items, by name. */
  | 'upcoming'
  /** The time left on the video or sound playing. */
  | 'mediaLeft'
  /** Whether the audience screens are black, show the logo, or show the picture. */
  | 'screensState'
  /**
   * What the hall's screens show at that moment (Session 50): the first audience group's picture, black-out
   * and the logo too, scaled into the box at 16:9 with black around it; with no audience group at all, black
   * and a line saying so (Session 52).
   */
  | 'audience'
  /** Words that stay the same. */
  | 'text';

export const STAGE_BOX_KINDS = [
  'current',
  'next',
  'notes',
  'clock',
  'samvat',
  'quote',
  'timer',
  'stageMessage',
  'upcoming',
  'mediaLeft',
  'screensState',
  'audience',
  'text',
] as const satisfies readonly StageBoxKind[];

export const STAGE_BOX_NAMES: Record<StageBoxKind, string> = {
  current: 'Current slide',
  next: 'Next slide',
  notes: 'Notes',
  clock: 'Clock',
  samvat: 'Samvat date and tithi',
  quote: 'Quote of the day',
  timer: 'Timer',
  stageMessage: 'Stage message',
  upcoming: 'Next items in the playlist',
  mediaLeft: 'Time left on the video or sound',
  screensState: 'The audience screens (black-out, logo)',
  audience: 'The audience picture, live',
  text: 'Fixed text',
};

/** A box's label over it as made: the kind in capitals (an empty label shows none). */
export const STAGE_BOX_LABELS: Record<StageBoxKind, string> = {
  current: 'NOW',
  next: 'NEXT',
  notes: 'NOTES',
  clock: '',
  samvat: '',
  quote: '',
  timer: '',
  stageMessage: '',
  upcoming: 'COMING UP',
  mediaLeft: 'TIME LEFT',
  screensState: '',
  audience: '',
  text: '',
};

export type StageAlign = 'left' | 'center' | 'right';

/** Where a box's contents sit up and down (Session 54). */
export type StageVAlign = 'top' | 'middle' | 'bottom';
export const STAGE_VALIGNS = ['top', 'middle', 'bottom'] as const satisfies readonly StageVAlign[];

/**
 * How a timer box writes the time (Session 54): as needed (5:00, then 1:05:00 from an hour), always minutes and
 * seconds (65:00), or always hours too (0:05:00).
 */
export type StageTimerFormat = 'auto' | 'mss' | 'hmmss';
export const STAGE_TIMER_FORMATS = ['auto', 'mss', 'hmmss'] as const satisfies readonly StageTimerFormat[];

export interface StageBox {
  id: string;
  kind: StageBoxKind;
  /** On the 1920 x 1080 canvas. */
  frame: Rect;
  /** Font size in canvas pixels, or 'fit': as large as fits the box. */
  size: number | 'fit';
  color: string;
  align: StageAlign;
  /** A small label above its contents (empty for none). */
  label: string;
  /** A timer box: the timer, or null for every running timer. */
  timerId?: string | null;
  /** A fixed text box: its words. */
  text?: string;
  /** The playlist's next items: how many (1 to 8). */
  count?: number;
  /** A clock box: today's Samvat date and tithi under the time. */
  calendar?: boolean;
  /** A Samvat box, or a clock box with the date: in Gujarati or English. */
  lang?: CalendarLang;
  // ---- Session 54 (Part A2): each left out of a box saved before, which draws as it did ----
  /** Up and down in the box: at the top (as before, left out), in the middle or at the bottom. */
  valign?: StageVAlign;
  /**
   * Its words as large as the box holds, when they fit it (`size` 'fit'). Left out (a box made before): no larger
   * than 400 px, as before, so a layout saved before draws as it did.
   */
  fitWhole?: boolean;
  /** Bold words; left out, as its kind draws them. */
  bold?: boolean;
  /**
   * A fill behind the whole box, rounded: its colour, and how see-through it is (0 solid to 1 clear), so a timer
   * over the audience picture stays readable. Left out: none.
   */
  fill?: { color: string; seeThrough: number };
  /** A line round the letters: its colour, and its width in canvas pixels. Left out: none. */
  outline?: { color: string; width: number };
  /** Drashti's soft shadow under the words. Left out: none. */
  shadow?: boolean;
  /** A timer box: how it writes the time. Left out: as needed. */
  format?: StageTimerFormat;
  /** A timer box counting down: another colour from this much left (ms), until 0:00. Left out: none. */
  warn?: { color: string; fromMs: number };
  /** A timer box counting down: its colour at 0:00 and past it. Left out: its own. */
  overColor?: string;
  /** A timer box counting down: it flashes at 0:00, slowly (shared/stage-timer.ts). Left out: no. */
  flash?: boolean;
  /** A clock box: 12 or 24 hours. Left out: as Drashti's computer writes the time. */
  hours?: 12 | 24;
  /** A clock box: the seconds too. Left out: no. */
  seconds?: boolean;
}

export interface StageLayout {
  id: string;
  name: string;
  /** Behind the boxes. */
  background: string;
  /** Bottom to top. */
  boxes: StageBox[];
}

export type StageLayoutResult =
  { ok: true; layouts: StageLayout[]; id: string } | { ok: false; message: string };

export const MAX_STAGE_BOXES = 40;

/** The widest line round a box's letters (canvas pixels, Session 54). */
export const MAX_OUTLINE = 40;

export const stageBoxSchema: z.ZodType<StageBox> = z.object({
  id: idSchema,
  kind: z.enum(STAGE_BOX_KINDS),
  frame: z.object({
    x: z
      .number()
      .min(-STAGE_WIDTH)
      .max(2 * STAGE_WIDTH),
    y: z
      .number()
      .min(-STAGE_HEIGHT)
      .max(2 * STAGE_HEIGHT),
    width: z
      .number()
      .min(8)
      .max(2 * STAGE_WIDTH),
    height: z
      .number()
      .min(8)
      .max(2 * STAGE_HEIGHT),
  }),
  size: z.union([z.literal('fit'), z.number().min(8).max(600)]),
  color: hexColorSchema,
  align: z.enum(['left', 'center', 'right']),
  label: z.string().max(40),
  timerId: idSchema.nullable().optional(),
  text: z.string().max(500).optional(),
  count: z.number().int().min(1).max(8).optional(),
  calendar: z.boolean().optional(),
  lang: z.enum(CALENDAR_LANGS).optional(),
  valign: z.enum(STAGE_VALIGNS).optional(),
  fitWhole: z.boolean().optional(),
  bold: z.boolean().optional(),
  fill: z.object({ color: hexColorSchema, seeThrough: z.number().min(0).max(1) }).optional(),
  outline: z.object({ color: hexColorSchema, width: z.number().min(0.5).max(MAX_OUTLINE) }).optional(),
  shadow: z.boolean().optional(),
  format: z.enum(STAGE_TIMER_FORMATS).optional(),
  warn: z
    .object({
      color: hexColorSchema,
      fromMs: z
        .number()
        .int()
        .min(1000)
        .max(24 * 3600 * 1000),
    })
    .optional(),
  overColor: hexColorSchema.optional(),
  flash: z.boolean().optional(),
  hours: z.union([z.literal(12), z.literal(24)]).optional(),
  seconds: z.boolean().optional(),
});

/** What a layout keeps in the library (its id and name are columns of their own). */
export const stageLayoutDefinitionSchema = z.object({
  background: hexColorSchema,
  boxes: z.array(stageBoxSchema).max(MAX_STAGE_BOXES),
});
export type StageLayoutDefinition = z.infer<typeof stageLayoutDefinitionSchema>;

export const stageLayoutNameSchema = z.string().trim().min(1).max(60);

/** A new box of a kind, in the middle of the canvas, in the usual look. */
export function newStageBox(kind: StageBoxKind, id: string): StageBox {
  const wide =
    kind === 'current' ||
    kind === 'next' ||
    kind === 'notes' ||
    kind === 'text' ||
    kind === 'upcoming' ||
    kind === 'samvat' ||
    kind === 'quote';
  // The audience picture (Session 50): 16:9, half the canvas each way.
  const picture = kind === 'audience';
  const width = picture ? STAGE_WIDTH / 2 : wide ? 1100 : 600;
  const height = picture
    ? STAGE_HEIGHT / 2
    : kind === 'current'
      ? 600
      : kind === 'clock' || kind === 'mediaLeft' || kind === 'samvat'
        ? 160
        : 300;
  return {
    id,
    kind,
    frame: { x: (STAGE_WIDTH - width) / 2, y: (STAGE_HEIGHT - height) / 2, width, height },
    size: kind === 'clock' || kind === 'mediaLeft' ? 'fit' : kind === 'current' ? 'fit' : 56,
    color:
      kind === 'notes' || kind === 'timer'
        ? '#fde68a'
        : kind === 'next'
          ? '#c9ced8'
          : kind === 'stageMessage'
            ? '#000000'
            : '#ffffff',
    align: kind === 'clock' ? 'right' : 'left',
    label: STAGE_BOX_LABELS[kind],
    ...(kind === 'timer' ? { timerId: null } : {}),
    ...(kind === 'text' ? { text: 'Placeholder words' } : {}),
    ...(kind === 'upcoming' ? { count: 4 } : {}),
    ...(kind === 'samvat' ? { lang: 'gu' as const } : {}),
    // Its words as large as the box holds, when they fit it (Session 54); the audience picture has none.
    ...(picture ? {} : { fitWhole: true }),
  };
}

/**
 * The Standard stage screen as boxes, where its parts sit with a stage
 * message and notes showing (Duplicate of Standard starts from this).
 */
export function standardAsBoxes(newId: () => string): StageLayout['boxes'] {
  const box = (kind: StageBoxKind, frame: Rect, extra: Partial<StageBox> = {}): StageBox => ({
    ...newStageBox(kind, newId()),
    frame,
    ...extra,
  });
  return [
    box(
      'stageMessage',
      { x: 48, y: 48, width: 1824, height: 110 },
      { size: 64, color: '#000000', align: 'left' },
    ),
    box('current', { x: 48, y: 186, width: 1066, height: 560 }, { size: 'fit', label: 'NOW' }),
    box('screensState', { x: 48, y: 746, width: 1066, height: 50 }, { size: 30, color: '#8b93a3' }),
    box('notes', { x: 48, y: 800, width: 1066, height: 232 }, { size: 40, color: '#fde68a', label: '' }),
    box('clock', { x: 1162, y: 186, width: 710, height: 130 }, { size: 120, align: 'right' }),
    box(
      'timer',
      { x: 1162, y: 330, width: 710, height: 200 },
      { size: 96, align: 'right', color: '#fde68a' },
    ),
    box('next', { x: 1162, y: 560, width: 710, height: 472 }, { size: 56, color: '#c9ced8', label: 'NEXT' }),
  ];
}

/**
 * A layout's boxes with one more (bottom to top). The audience picture (Session 50) goes under the boxes
 * already there, so the stage message, the clock and the timers draw over it; any other box goes on top.
 */
export function withBoxAdded(boxes: readonly StageBox[], box: StageBox): StageBox[] {
  return box.kind === 'audience' ? [box, ...boxes] : [...boxes, box];
}

/** Which way a box goes among the others (Session 54): in front of them all, behind them all, or one step. */
export type BoxOrder = 'front' | 'forward' | 'backward' | 'back';

/**
 * A layout's boxes (bottom to top) with one brought to the front or one step forward, or sent to the back or
 * one step backward (Session 54), as the slide editor's Arrange does; as they were when it is there already.
 */
export function arrangeBoxes(boxes: readonly StageBox[], id: string, how: BoxOrder): StageBox[] {
  const at = boxes.findIndex((b) => b.id === id);
  const box = boxes[at];
  if (!box) return [...boxes];
  const rest = boxes.filter((b) => b.id !== id);
  const to =
    how === 'front'
      ? rest.length
      : how === 'back'
        ? 0
        : Math.max(0, Math.min(rest.length, at + (how === 'forward' ? 1 : -1)));
  return [...rest.slice(0, to), box, ...rest.slice(to)];
}

/** The smallest the layout editor makes a box each way (canvas pixels): as small as a layout keeps one. */
const BOX_MIN = 8;

/**
 * The smallest the layout editor makes the audience picture box (Session 53): a sixth of the stage each way, where
 * its line, "No audience screens" in the box or "Audience off" on its picture, keeps to the stage's smallest words
 * (30 px, render/audience-picture.ts). Until then it went down to 8 x 8, as any box does. A layout saved smaller
 * before is read, drawn and saved as it was: only a size changed in the editor stops here.
 */
export const AUDIENCE_BOX_MIN = { width: STAGE_WIDTH / 6, height: STAGE_HEIGHT / 6 } as const;

/** The smallest the layout editor makes a box of this kind, by its handles and its fields. */
export function smallestBox(kind: StageBoxKind): { width: number; height: number } {
  return kind === 'audience' ? AUDIENCE_BOX_MIN : { width: BOX_MIN, height: BOX_MIN };
}

/**
 * A box's frame with one of its numbers as typed in the layout editor, in whole pixels: its width and height no
 * smaller than its kind's smallest (smallestBox), its place as typed, to a canvas's width before the canvas.
 */
export function typedFrame(box: StageBox, key: keyof Rect, value: number): Rect {
  const min = key === 'width' || key === 'height' ? smallestBox(box.kind)[key] : -STAGE_WIDTH;
  return { ...box.frame, [key]: Math.max(min, Math.round(value)) };
}

/**
 * Whether a layout draws the hall's picture (Session 50): its screen then loads what comes next, as the
 * hall's screens do.
 */
export function showsHall(layout: StageLayout | null | undefined): boolean {
  return layout?.boxes.some((b) => b.kind === 'audience') ?? false;
}

/**
 * The hall's picture, as a stage layout's audience picture box draws it (Session 50): the first audience
 * group, whose settings in the live Look it shows, at the canvas size and scaling of that group's first
 * screen. The main process gives it to each stage screen (OutputContext), to its nodes' stage screens and to a
 * tablet's stage display (Session 51); a node with an audience screen of its own gives its own.
 */
export interface HallPicture {
  groupId: string;
  canvasWidth: number;
  canvasHeight: number;
  scaling: ScalingMode;
  /**
   * Audience is off (Session 51): the computer showing the hall has closed its screens, so they show its desktop.
   * The box keeps the picture and says "Audience off" in a corner, so the performers are not misled. Left out
   * while they are on.
   */
  off?: boolean;
}

/** A hall's picture as another computer or a page is told it: read whole and in bounds, never trusted. */
export const hallPictureSchema: z.ZodType<HallPicture> = z.object({
  groupId: z.string().min(1).max(128),
  canvasWidth: z.number().int().min(16).max(16384),
  canvasHeight: z.number().int().min(16).max(16384),
  scaling: z.enum(SCALING_MODES),
  off: z.boolean().optional(),
});

/** A screen group as hallPicture reads it: its role, and its screens' canvases in order. */
export interface HallGroup {
  id: string;
  role: ScreenRole;
  screens: readonly {
    canvasWidth: number;
    canvasHeight: number;
    scaling: ScalingMode;
    /** A node's screen (another computer's), or null for this computer's; left out where unknown. */
    nodeId?: string | null;
    /** Turned off in Screens; left out where unknown. */
    enabled?: boolean;
  }[];
}

/**
 * The hall's picture among these groups, in their order in Screens: the first audience group with a screen of
 * this computer's that is on (Session 50: what this computer's audience screens show, not a group Set Up
 * Screens… left empty, nor one whose screens are a node's or off), else the first audience group (as the remote's
 * picture follows it); 1920 x 1080 fitted while it has no screen; null with no audience group. With this
 * computer's Audience off (`audience` false), a hall shown here is said off (Session 51): the switch closed its
 * screens. One shown only on a node, or not at all, is not: the switch closes none of its screens.
 */
export function hallPicture(groups: readonly HallGroup[], audience = true): HallPicture | null {
  const here = (s: HallGroup['screens'][number]) => (s.nodeId ?? null) === null && s.enabled !== false;
  const all = groups.filter((g) => g.role === 'audience');
  const shownHere = all.find((g) => g.screens.some(here));
  const hall = shownHere ?? all[0];
  if (!hall) return null;
  const off = !audience && shownHere !== undefined ? { off: true } : {};
  const screen = hall.screens.find(here) ?? hall.screens[0];
  if (!screen || screen.canvasWidth <= 0 || screen.canvasHeight <= 0)
    return { groupId: hall.id, canvasWidth: STAGE_WIDTH, canvasHeight: STAGE_HEIGHT, scaling: 'fit', ...off };
  return {
    groupId: hall.id,
    canvasWidth: screen.canvasWidth,
    canvasHeight: screen.canvasHeight,
    scaling: screen.scaling,
    ...off,
  };
}

/** One screen as hallPictureOfScreens reads it: its group, the group's role, and its canvas. */
export type HallScreen = { groupId: string; role: ScreenRole } & HallGroup['screens'][number];

/**
 * The hall's picture among one computer's screens, in Screens' order: the first audience screen's. A node
 * knows only its own screens, so a node's stage screens show that node's own audience picture (Main's Audience
 * switch never closes them). With no audience screen of its own that is on (one turned off in Screens shows
 * nothing), Main's hall as Main tells it (Session 51: the live Look's first audience group, as Main's own stage
 * screens draw it, said off with Main's Audience off), never every layer and language; its own turned-off one only
 * while Main's is not known.
 */
export function hallPictureOfScreens(
  screens: readonly HallScreen[],
  main: HallPicture | null = null,
): HallPicture | null {
  const own = (list: readonly HallScreen[]) =>
    hallPicture(list.map((s) => ({ id: s.groupId, role: s.role, screens: [s] })));
  return own(screens.filter((s) => s.enabled !== false)) ?? main ?? own(screens);
}
