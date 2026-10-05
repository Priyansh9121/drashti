import { z } from 'zod';
import { LAYER_NAMES } from './engine/state';
import { hexColorSchema, idSchema } from './model-schema';
import { dateSchema, daysSchema, hhmmSchema } from './schedule';
import type { ScheduleWhen } from './schedule';

/*
 * Macros (Session 11): a name, a colour, and actions run in order as one
 * change of the show (one engine change: the screens move once). Triggers:
 * the Macros panel, a slide's cue ("run this macro when the slide goes
 * up"), the remote and the API (Remote devices), and MIDI.
 *
 * A macro only ever runs the show. It never starts or ends the stream or a
 * recording, and never changes the library or any setting: such actions do
 * not exist here, a macro naming one is refused when it is saved, and again
 * when it runs (a macro is checked against this list every time).
 *
 * Undo: running a macro is one change. Back after it is Previous (the macro
 * is "something else" that changed the screens). A macro with Clear all in it
 * can be put back: Put it back brings back what was up before the macro. A
 * slide's cue runs in the same change as the Next that put the slide up, so
 * Back undoes that Next exactly, the layers the macro changed included; what
 * is not a layer (the Look, black-out, the logo, the stage message, timers)
 * stays as the macro left it, as it does for Back and Put it back anyway.
 *
 * Simple Mode runs no macros, from any trigger, slide cues included: a slide
 * with a macro cue goes up as it is. MIDI mapped to Simple Mode's own
 * actions (Next, Back, Clear all, Black-out, Logo) works there.
 *
 * Scheduled macros (Session 14): a macro can run by itself at set times,
 * on the arti's schedules (days of the week and a time, or one date). At the
 * time the operator window counts down ten seconds, with Cancel, then runs
 * it. A time that passed while Drashti was closed (or the computer slept
 * through it by more than a minute) is never run late. This is the one
 * exception to Simple Mode running no macros: an admin chose the time on
 * purpose (starting the idle rotation before the sabha, say), and the
 * countdown, with Cancel, is shown in Simple Mode too, where a volunteer
 * can stop it but change nothing.
 */

export type MacroAction =
  | { kind: 'look'; lookId: string }
  | { kind: 'clearLayer'; layer: (typeof LAYER_NAMES)[number] }
  | { kind: 'clearAll' }
  | { kind: 'showProp'; propId: string }
  | { kind: 'hideProp'; propId: string }
  | { kind: 'showMessage'; templateId: string; values: Record<string, string> }
  | { kind: 'hideMessage'; templateId: string }
  | { kind: 'timer'; timerId: string; how: 'start' | 'pause' | 'reset' }
  | { kind: 'playSound'; mediaId: string; volume: number; loop: boolean }
  | { kind: 'background'; mediaId: string; fit: 'fit' | 'fill' | 'stretch'; loop: boolean }
  | { kind: 'backgroundColor'; color: string }
  | { kind: 'blackout'; to: 'on' | 'off' | 'toggle' }
  | { kind: 'logo'; to: 'on' | 'off' | 'toggle' }
  | { kind: 'stageMessage'; text: string | null }
  | { kind: 'playItem'; playlistId: string; itemId: string }
  | { kind: 'idle'; to: 'start' | 'stop' };

export type MacroActionKind = MacroAction['kind'];

export const MACRO_ACTION_NAMES: Record<MacroActionKind, string> = {
  look: 'Switch the Look',
  clearLayer: 'Clear a layer',
  clearAll: 'Clear all',
  showProp: 'Show a prop',
  hideProp: 'Hide a prop',
  showMessage: 'Show a message',
  hideMessage: 'Hide a message',
  timer: 'Start, pause or reset a timer',
  playSound: 'Play a sound',
  background: 'Set a background (picture or video)',
  backgroundColor: 'Set a background colour',
  blackout: 'Black-out',
  logo: 'Logo',
  stageMessage: 'The stage message',
  playItem: 'Go to a playlist item',
  idle: 'Start or stop the idle rotation',
};

export const MACRO_ACTION_KINDS = Object.keys(MACRO_ACTION_NAMES) as MacroActionKind[];

/** A time a macro runs by itself (Session 14). */
export interface MacroSchedule extends ScheduleWhen {
  id: string;
  /** Off: kept, but it does not run. */
  enabled: boolean;
}

export interface Macro {
  id: string;
  name: string;
  /** "#rrggbb": the button's colour. */
  color: string;
  actions: MacroAction[];
  /** Times it runs by itself (none for most). */
  schedules: MacroSchedule[];
}

/** A macro as saved: its schedules stay as they are when left out. */
export interface MacroInput {
  name: string;
  color: string;
  actions: unknown[];
  schedules?: MacroSchedule[];
}

export const MACRO_SCHEDULES_MAX = 10;
/** Running by itself: the countdown the operator can cancel. */
export const MACRO_COUNTDOWN_MS = 10_000;
/** A time is run only within this of it (a computer that slept through it does not run it late). */
export const MACRO_RUN_WITHIN_MS = 60_000;

export const macroScheduleSchema = z
  .object({
    id: z.string().min(1).max(64),
    days: daysSchema,
    date: dateSchema.nullable(),
    time: hhmmSchema,
    enabled: z.boolean(),
  })
  .strict()
  .refine((s) => (s.date === null) !== (s.days.length === 0), {
    message: 'Choose the days of the week, or one date.',
  });

/** A macro about to run by itself, counting down (the operator window, both modes). */
export interface MacroCountdown {
  /** This time of this schedule: what Cancel is for. */
  key: string;
  macroId: string;
  name: string;
  /** When it runs (engine clock): the windows count down to it. */
  runAt: number;
}

export interface MacroCountdownView {
  countdowns: MacroCountdown[];
}

export type MacroResult = { ok: true; macros: Macro[]; id: string } | { ok: false; message: string };
export type MacroRunResult = { ok: true; rev: number; changed: boolean } | { ok: false; message: string };

export const MAX_MACRO_ACTIONS = 30;

const on = z.enum(['on', 'off', 'toggle']);

export const macroActionSchema: z.ZodType<MacroAction> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('look'), lookId: idSchema }).strict(),
  z.object({ kind: z.literal('clearLayer'), layer: z.enum(LAYER_NAMES) }).strict(),
  z.object({ kind: z.literal('clearAll') }).strict(),
  z.object({ kind: z.literal('showProp'), propId: idSchema }).strict(),
  z.object({ kind: z.literal('hideProp'), propId: idSchema }).strict(),
  z
    .object({
      kind: z.literal('showMessage'),
      templateId: idSchema,
      values: z.record(z.string().max(60), z.string().max(200)),
    })
    .strict(),
  z.object({ kind: z.literal('hideMessage'), templateId: idSchema }).strict(),
  z
    .object({ kind: z.literal('timer'), timerId: idSchema, how: z.enum(['start', 'pause', 'reset']) })
    .strict(),
  z
    .object({
      kind: z.literal('playSound'),
      mediaId: idSchema,
      volume: z.number().min(0).max(1),
      loop: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('background'),
      mediaId: idSchema,
      fit: z.enum(['fit', 'fill', 'stretch']),
      loop: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('backgroundColor'), color: hexColorSchema }).strict(),
  z.object({ kind: z.literal('blackout'), to: on }).strict(),
  z.object({ kind: z.literal('logo'), to: on }).strict(),
  z.object({ kind: z.literal('stageMessage'), text: z.string().trim().min(1).max(300).nullable() }).strict(),
  z.object({ kind: z.literal('playItem'), playlistId: idSchema, itemId: idSchema }).strict(),
  z.object({ kind: z.literal('idle'), to: z.enum(['start', 'stop']) }).strict(),
]);

export const macroNameSchema = z.string().trim().min(1).max(60);

/** A macro as saved (its id is a column of its own). */
export const macroInputSchema = z.object({
  name: macroNameSchema,
  color: hexColorSchema,
  actions: z.array(z.unknown()).max(MAX_MACRO_ACTIONS),
  schedules: z.array(macroScheduleSchema).max(MACRO_SCHEDULES_MAX).optional(),
});

/**
 * Check a macro's actions: each must be one a macro may do. Anything else
 * (starting the stream, changing the library or a setting, or something no
 * Drashti knows) is refused, saying which.
 */
export function checkActions(
  raw: readonly unknown[],
): { ok: true; actions: MacroAction[] } | { ok: false; message: string } {
  const actions: MacroAction[] = [];
  for (const [i, a] of raw.entries()) {
    const parsed = macroActionSchema.safeParse(a);
    if (!parsed.success) {
      const kind =
        typeof a === 'object' && a !== null && typeof (a as { kind?: unknown }).kind === 'string'
          ? (a as { kind: string }).kind
          : 'something';
      const known = (MACRO_ACTION_KINDS as readonly string[]).includes(kind);
      return {
        ok: false,
        message: known
          ? `Action ${i + 1} (${MACRO_ACTION_NAMES[kind as MacroActionKind]}) is not filled in right.`
          : `Action ${i + 1} (“${kind}”) is not something a macro may do: a macro only runs the show, never the stream, the library or settings.`,
      };
    }
    actions.push(parsed.data);
  }
  return { ok: true, actions };
}

/** The colours offered for a macro's button (any #rrggbb is allowed). */
export const MACRO_COLORS = [
  '#3e63dd',
  '#2f9e44',
  '#e8590c',
  '#c2255c',
  '#7048e8',
  '#0c8599',
  '#868e96',
] as const;
