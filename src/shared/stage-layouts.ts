import { z } from 'zod';
import { CALENDAR_LANGS, type CalendarLang } from './calendar';
import type { Rect } from './model';
import { hexColorSchema, idSchema } from './model-schema';

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
  text: '',
};

export type StageAlign = 'left' | 'center' | 'right';

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
  const width = wide ? 1100 : 600;
  const height =
    kind === 'current' ? 600 : kind === 'clock' || kind === 'mediaLeft' || kind === 'samvat' ? 160 : 300;
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
