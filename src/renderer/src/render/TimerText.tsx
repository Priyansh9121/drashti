import { useContext } from 'react';
import type { TimerState } from '../../../shared/timers';
import { formatTimer } from '../../../shared/timers';
import { useNow } from './useNow';
import { ClockStyleContext } from './clock-style';

/**
 * A timer's time, worked out in this window from the shared clock (the
 * engine only sends start, pause and reset). Redrawn ten times a second, so
 * every window turns over within a tenth of a second of the others.
 */
export function TimerText({ timer }: { timer: TimerState | undefined }) {
  const now = useNow(100);
  // A clock in Main's way of writing the time (Sessions 31–36, I18N-8).
  const style = useContext(ClockStyleContext);
  return (
    <span data-timer={timer?.id ?? ''} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {timer ? formatTimer(timer, now, style) : '--:--'}
    </span>
  );
}
