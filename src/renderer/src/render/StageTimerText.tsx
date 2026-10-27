import { useContext } from 'react';
import type { StageBox } from '../../../shared/stage-layouts';
import { FLASH_DIM, flashDimmed, stageTimerColor, stageTimerText } from '../../../shared/stage-timer';
import type { TimerState } from '../../../shared/timers';
import { ClockStyleContext } from './clock-style';
import { useNow } from './useNow';

/**
 * A timer as a stage layout's timer box shows it (Session 54): in the box's format, in its warning colour from its
 * time left and its colour when over at 0:00 and past it, its words dimmed in turn as it flashes at 0:00, all
 * from the engine's time (shared/stage-timer.ts), so every stage page draws it alike. Redrawn ten times a second,
 * as TimerText is, so every window turns over within a tenth of a second of the others; a box with none of these
 * settings draws exactly as TimerText does. A timer no longer in Timers shows --:--.
 */
export function StageTimerText({
  box,
  timer,
}: {
  box: Pick<StageBox, 'format' | 'warn' | 'overColor' | 'flash'>;
  timer: TimerState | undefined;
}) {
  const now = useNow(100);
  // A clock in Main's way of writing the time (Sessions 31–36, I18N-8).
  const style = useContext(ClockStyleContext);
  const color = stageTimerColor(box, timer, now);
  const dim = box.flash === true && flashDimmed(timer, now);
  return (
    <span
      data-timer={timer?.id ?? ''}
      data-timer-color={color ?? undefined}
      data-flash={dim ? 'dim' : undefined}
      style={{
        fontVariantNumeric: 'tabular-nums',
        ...(color === null ? {} : { color }),
        ...(dim ? { opacity: FLASH_DIM } : {}),
      }}
    >
      {timer ? stageTimerText(timer, now, style, box.format) : '--:--'}
    </span>
  );
}
