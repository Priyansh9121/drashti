import type { CSSProperties } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { ClockStyle } from '../../../shared/format';
import type { StageBox } from '../../../shared/stage-layouts';
import { STAGE_HEIGHT } from '../../../shared/stage-layouts';
import { stageClockText, stageTimerText } from '../../../shared/stage-timer';

/*
 * A stage layout box's own look as it draws (Session 54, render/StageLayoutView.tsx): a fill behind the whole
 * box, as see-through as set, so a timer over the audience picture stays readable; its words bold, with a line
 * round the letters and Drashti's soft shadow; and how large its words grow when they fit. A box with none of
 * these, as every box saved before, draws exactly as it did.
 */

/** The largest a fitting box's words grow, as before Session 54: a box saved then keeps to it. */
export const FIT_MAX = 400;
/** A box that says so (fitWhole): as large as it holds, the tallest box a layout keeps (twice the stage). */
export const FIT_LARGEST = 2 * STAGE_HEIGHT;

/** The largest a box's words grow when they fit it. */
export const fitLargest = (box: Pick<StageBox, 'fitWhole'>): number =>
  box.fitWhole === true ? FIT_LARGEST : FIT_MAX;

/** Drashti's own soft shadow under words, as a slide's words have it (render/SlideView.tsx, TEXT_SHADOW). */
const SOFT_SHADOW = '0 0.06em 0.18em rgba(0, 0, 0, 0.85)';

/** A #rrggbb (or #rrggbbaa) colour at this opacity, its own times the one given. */
function rgba(hex: string, opacity: number): string {
  const byte = (at: number) => parseInt(hex.slice(at, at + 2), 16);
  const own = hex.length === 9 ? byte(7) / 255 : 1;
  const a = Math.round(opacity * own * 1000) / 1000;
  return `rgba(${String(byte(1))}, ${String(byte(3))}, ${String(byte(5))}, ${String(a)})`;
}

/** A box's fill: its colour as see-through as set, behind the whole box, rounded, with room round its words. */
export function boxFillStyle(box: Pick<StageBox, 'fill'>): CSSProperties {
  if (!box.fill) return {};
  return {
    background: rgba(box.fill.color, 1 - box.fill.seeThrough),
    borderRadius: 16,
    padding: '12px 24px',
    boxSizing: 'border-box',
  };
}

/** A box's words: bold, a line round the letters (drawn under them, as a slide's), and Drashti's soft shadow. */
export function boxWordsStyle(box: Pick<StageBox, 'bold' | 'outline' | 'shadow'>): CSSProperties {
  return {
    ...(box.bold === true ? { fontWeight: 700 } : {}),
    ...(box.outline
      ? {
          WebkitTextStroke: `${String(box.outline.width * 2)}px ${box.outline.color}`,
          paintOrder: 'stroke fill',
        }
      : {}),
    ...(box.shadow === true ? { textShadow: SOFT_SHADOW } : {}),
  };
}

/** A time's shape: where its figures are (every figure is as wide as the others, in tabular figures). */
const shape = (text: string) => text.replace(/\d/gu, '0');

/**
 * What a fitting box measures its words again for, beyond what it shows (render/StageLayoutView.tsx): its own
 * look and size, and the shape of its time (a timer's, in its format; a clock's), so a time that grows a figure
 * (9:59 to 10:00) still fits, and one that only counts (9:59 to 9:58) is never measured again.
 */
export function fitAgain(
  box: StageBox,
  state: EngineState,
  now: number,
  style: ClockStyle | null | undefined,
): string {
  let time = '';
  if (box.kind === 'timer') {
    const shown = box.timerId
      ? state.timers.filter((t) => t.id === box.timerId)
      : state.timers.filter((t) => t.kind !== 'clock' && (t.startedAt !== null || t.elapsedMs > 0));
    time = shown.map((t) => shape(stageTimerText(t, now, style, box.format))).join(' ');
  } else if (box.kind === 'clock') time = shape(stageClockText(now, style, box));
  return JSON.stringify([
    box.bold === true,
    box.fill !== undefined,
    box.fitWhole === true,
    box.frame.width,
    box.frame.height,
    time,
  ]);
}
