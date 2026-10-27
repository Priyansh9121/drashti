import type { Rect } from './model';
import type { StageBox, StageBoxKind } from './stage-layouts';
import { newStageBox, STAGE_HEIGHT, STAGE_WIDTH } from './stage-layouts';
import { TIMER_WORDS } from './timer-slides';
import type { TimerDefinition, TimerFields, TimerKind } from './timers';

/*
 * Ready-made stage layouts (Session 54): the stage layout editor's New from a Template… offers five, each one
 * click, each with the timer it needs: made new with the time or the length the dialog asks for, or one the
 * operator chooses. The layout is made, then chosen for the stage screens in the live Look at once
 * (stage/StageTemplateDialog.tsx). Placeholder names and words only.
 */

export type StageTemplate = 'timer' | 'countdownTo' | 'countdown' | 'countUp' | 'overAudience';
export const STAGE_TEMPLATES = [
  'timer',
  'countdownTo',
  'countdown',
  'countUp',
  'overAudience',
] as const satisfies readonly StageTemplate[];

export const STAGE_TEMPLATE_NAMES: Record<StageTemplate, string> = {
  timer: 'Timer only',
  countdownTo: 'Countdown to a time',
  countdown: 'Countdown',
  countUp: 'Count up from 0:00',
  overAudience: 'Timer and clock over the audience',
};

/** What each shows, in a few words under its name. */
export const STAGE_TEMPLATE_NOTES: Record<StageTemplate, string> = {
  timer: 'One timer filling the screen.',
  countdownTo: 'To a time of day, large, with words above it.',
  countdown: 'From a length down to 0:00, then on past it in another colour.',
  countUp: 'From 0:00 up, filling the screen.',
  overAudience: 'The audience picture, live, with a timer at the top left and the clock at the top right.',
};

/** The kinds of timer a template counts with: any but a clock. */
export type TemplateTimerKind = Exclude<TimerKind, 'clock'>;

/** The kind of timer a template counts with; null where the operator chooses it. */
const TEMPLATE_TIMER_KIND: Record<StageTemplate, TemplateTimerKind | null> = {
  timer: null,
  countdownTo: 'countdown_to_time',
  countdown: 'countdown',
  countUp: 'countup',
  overAudience: null,
};

/** The kinds a template's timer may be, the first the one it makes unless another is chosen. */
export function templateTimerKinds(template: StageTemplate): TemplateTimerKind[] {
  const own = TEMPLATE_TIMER_KIND[template];
  return own ? [own] : ['countdown', 'countup', 'countdown_to_time'];
}

/** A new timer's placeholder name, by its kind. */
export const TEMPLATE_TIMER_NAMES: Record<TemplateTimerKind, string> = {
  countdown: 'Stage countdown',
  countdown_to_time: 'Stage countdown to a time',
  countup: 'Stage count up',
};

/** What the dialog asks before anything is typed: a length of 5:00, and 7:30 pm. */
export const TEMPLATE_LENGTH_MS = 5 * 60_000;
export const TEMPLATE_TIME = '19:30';

/**
 * The timer a template makes: of this kind, with the length (a countdown) or the time of day (a countdown to a
 * time) asked. The Countdown template's runs on past 0:00, in the overtime colour; the others hold at 0:00.
 */
export function templateTimer(
  template: StageTemplate,
  kind: TemplateTimerKind,
  asked: { name: string; durationMs: number; targetTime: string },
): TimerFields {
  return {
    name: asked.name,
    kind,
    durationMs: kind === 'countdown' ? asked.durationMs : 0,
    targetTime: kind === 'countdown_to_time' ? asked.targetTime : null,
    allowsOverrun: template === 'countdown',
  };
}

/**
 * Whether a timer chosen in Timers stops short of what a template shows (Part A's review): the Countdown goes on past
 * 0:00 in the overtime colour, which a countdown that holds at 0:00 never reaches. The dialog says so, and offers
 * to let it run on.
 */
export const stopsAtZeroFor = (
  template: StageTemplate,
  timer: Pick<TimerDefinition, 'kind' | 'allowsOverrun'>,
): boolean => template === 'countdown' && timer.kind === 'countdown' && !timer.allowsOverrun;

/** A name no other has: the name itself, else with the first number after it that is free ("Countdown 2"). */
export function freshName(taken: Iterable<string>, base: string): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${String(n)}`)) return `${base} ${String(n)}`;
}

/** How far in from the stage's edges a template's boxes keep (canvas pixels). */
const EDGE = 48;
/** Nearly the whole stage. */
const WHOLE: Rect = { x: EDGE, y: EDGE, width: STAGE_WIDTH - 2 * EDGE, height: STAGE_HEIGHT - 2 * EDGE };
/** A corner box's width and height, over the audience picture. */
const CORNER = { width: 760, height: 220 };
/** Behind a box over the audience picture (Session 54, A2): black, 40% see-through, so it stays readable. */
const OVER_PICTURE = { fill: { color: '#000000', seeThrough: 0.4 } };
/** The Countdown's warning from 1:00 left (the amber a slide's Timer turns in its last minute) and its overtime red. */
const COUNTDOWN_COLOURS = { warn: { color: '#f5a524', fromMs: 60_000 }, overColor: '#ef4444' };

/**
 * A template's boxes on the 1920 x 1080 stage (bottom to top), around this timer: the timer bold, in white, in the
 * middle, as large as its box holds; above a countdown to a time, `words` ("Starting in" when left empty); over
 * the audience picture, the timer and the clock on a see-through black.
 */
export function templateBoxes(
  template: StageTemplate,
  timerId: string,
  newId: () => string,
  words: string = TIMER_WORDS,
): StageBox[] {
  const box = (kind: StageBoxKind, frame: Rect, extra: Partial<StageBox> = {}): StageBox => ({
    ...newStageBox(kind, newId()),
    frame,
    label: '',
    ...extra,
  });
  const timer = (frame: Rect, extra: Partial<StageBox> = {}) =>
    box('timer', frame, {
      timerId,
      size: 'fit',
      color: '#ffffff',
      align: 'center',
      valign: 'middle',
      bold: true,
      ...extra,
    });
  switch (template) {
    case 'timer':
    case 'countUp':
      return [timer(WHOLE)];
    case 'countdown':
      return [timer(WHOLE, COUNTDOWN_COLOURS)];
    case 'countdownTo':
      return [
        box(
          'text',
          { x: EDGE, y: 96, width: WHOLE.width, height: 200 },
          {
            text: words.trim() === '' ? TIMER_WORDS : words.trim(),
            size: 'fit',
            color: '#ffffff',
            align: 'center',
            valign: 'bottom',
          },
        ),
        timer({ x: EDGE, y: 312, width: WHOLE.width, height: STAGE_HEIGHT - 312 - EDGE }),
      ];
    case 'overAudience':
      return [
        box('audience', { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT }),
        timer({ x: EDGE, y: EDGE, ...CORNER }, { align: 'left', ...OVER_PICTURE }),
        box(
          'clock',
          { x: STAGE_WIDTH - EDGE - CORNER.width, y: EDGE, ...CORNER },
          { size: 'fit', color: '#ffffff', align: 'right', valign: 'middle', bold: true, ...OVER_PICTURE },
        ),
      ];
  }
}
