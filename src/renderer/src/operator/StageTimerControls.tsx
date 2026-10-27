import { useContext } from 'react';
import { countsToWords, layoutTimerIds } from '../../../shared/stage-timer';
import { isRunning, type TimerState } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { ClockStyleContext } from '../render/clock-style';
import { TimerText } from '../render/TimerText';
import { useFirstGroupLook } from '../screens/screens-store';
import { Button } from '../ui/Button';
import { Pause, Play, RotateCcw, Square } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { dispatch } from './actions';

/*
 * The stage screens' timers in the Stage screen panel (Session 54, Part A3): each timer the layout the stage
 * screens show (the live Look's first stage group's) shows by name, with its time, what it counts to, and Start,
 * Pause and Reset, as Timers has them, so nobody hunts for it in Timers. Nothing for the Standard stage screen,
 * or a layout with no timer chosen in it.
 */

const NO_TIMERS: TimerState[] = [];

function StageTimerRow({ timer }: { timer: TimerState }) {
  const running = isRunning(timer);
  // A countdown and a count-up pause and reset; a countdown to a time and a clock count by the clock, and stop.
  const counts = timer.kind === 'countdown' || timer.kind === 'countup';
  const style = useContext(ClockStyleContext);
  const words = countsToWords(timer, style);
  return (
    <li
      data-testid="stage-timer-row"
      data-timer-id={timer.id}
      data-running={running ? 'true' : undefined}
      className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5"
    >
      <div className="flex items-center gap-2">
        <Truncate text={timer.name} className="min-w-0 flex-1 text-sm font-medium" />
        <span className="font-bold tabular-nums" data-testid="stage-timer-value">
          <TimerText timer={timer} />
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1">
        {/* Wrapped, never cut, in the narrowest right column (300 px). */}
        <span className="min-w-0 flex-1 text-xs text-muted" data-testid="stage-timer-counts">
          {words}
        </span>
        {running ? (
          <Button
            size="sm"
            icon={counts ? Pause : Square}
            onClick={() => void dispatch({ type: counts ? 'pauseTimer' : 'resetTimer', timerId: timer.id })}
          >
            {counts ? 'Pause' : 'Stop'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={Play}
            onClick={() => void dispatch({ type: 'startTimer', timerId: timer.id })}
          >
            Start
          </Button>
        )}
        {counts && (
          <Button
            size="sm"
            icon={RotateCcw}
            onClick={() => void dispatch({ type: 'resetTimer', timerId: timer.id })}
          >
            Reset
          </Button>
        )}
      </div>
    </li>
  );
}

export function StageTimerControls() {
  const first = useFirstGroupLook('stage');
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const ids = layoutTimerIds(first?.look.stageLayout);
  if (ids.length === 0) return null;
  return (
    <ul className="space-y-1" aria-label="The stage screens’ timers" data-testid="stage-timers">
      {ids.map((id) => {
        const timer = timers.find((t) => t.id === id);
        return timer ? (
          <StageTimerRow key={id} timer={timer} />
        ) : (
          <li key={id} className="text-xs text-muted" data-testid="stage-timer-gone">
            A timer in the stage layout is no longer in Timers: the stage shows --:-- for it.
          </li>
        );
      })}
    </ul>
  );
}
