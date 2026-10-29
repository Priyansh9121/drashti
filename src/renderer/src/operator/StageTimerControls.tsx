import { useContext, useId, useState } from 'react';
import {
  countsToWords,
  layoutTimerIds,
  stageTimerChange,
  stageTimerTarget,
} from '../../../shared/stage-timer';
import { isRunning, type TimerState } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { ClockStyleContext } from '../render/clock-style';
import { TimerText } from '../render/TimerText';
import { Button } from '../ui/Button';
import { Pause, Play, RotateCcw, Square } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { dispatch } from './actions';

/*
 * The stage screens' timers in the Stage screen panel (Session 54, Part A3): each timer the layout every stage screen
 * shows (Session 55: the one chosen for them all) shows by name, with its time, what it counts to, and Start, Pause
 * and Reset, as Timers has them, so nobody hunts for it in Timers. Nothing for the Standard stage screen, or a layout
 * with no timer chosen in it. Since Session 55 (Session 54's question 13) a countdown to a time has the time it
 * counts to in a field, and a countdown its length: changed there, every stage screen shows it at once, its flash at
 * 0:00 as before.
 */

/**
 * What a stage timer counts to, changed in place (Session 55): the time of day a countdown to a time counts to (a time
 * field: each change of it is kept at once), or a countdown's length (kept on Enter or on leaving the field). Esc puts
 * back what it was; what does not read is said, and changes nothing.
 */
function TargetField({ timer }: { timer: TimerState }) {
  const now = stageTimerTarget(timer);
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  if (now === null) return null;
  const toTime = timer.kind === 'countdown_to_time';
  const value = typed ?? now;
  const keep = async (text: string) => {
    if (text.trim() === now) {
      setTyped(null);
      setProblem(null);
      return;
    }
    const change = stageTimerChange(timer, text);
    if (!change.ok) {
      setProblem(change.message);
      return;
    }
    const kept = await window.drashti.timers.update(timer.id, change.fields);
    if (!kept.ok) {
      setProblem(kept.message);
      return;
    }
    setTyped(null);
    setProblem(null);
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <label
        className="flex items-center gap-1.5 text-xs text-muted"
        htmlFor={id}
        data-testid="stage-timer-counts"
      >
        {toTime ? 'Counts down to' : 'Counts down from'}
        <input
          id={id}
          type={toTime ? 'time' : 'text'}
          inputMode={toTime ? undefined : 'numeric'}
          data-testid="stage-timer-target"
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${id}-problem` : undefined}
          value={value}
          className="h-7 w-24 min-w-0 rounded-md border border-field bg-panel-3 px-1.5 text-sm text-fg tabular-nums"
          onChange={(e) => {
            const text = e.target.value;
            setTyped(text);
            // A time of day is kept as soon as the field holds a whole one; a length when it is left or on Enter.
            if (toTime && text !== '') void keep(text);
          }}
          onBlur={() => {
            if (typed !== null) void keep(typed);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void keep(value);
            } else if (e.key === 'Escape' && typed !== null) {
              e.preventDefault();
              e.stopPropagation();
              setTyped(null);
              setProblem(null);
            }
          }}
        />
      </label>
      {problem && (
        <span
          id={`${id}-problem`}
          className="text-xs text-danger-fg"
          data-testid="stage-timer-target-problem"
        >
          {problem}
        </span>
      )}
    </div>
  );
}

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
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {/* What it counts to, changed here (Session 55); otherwise in words, wrapped, never cut, in the narrowest
            right column (300 px). */}
        {stageTimerTarget(timer) !== null ? (
          <TargetField timer={timer} />
        ) : (
          <span className="min-w-0 flex-1 text-xs text-muted" data-testid="stage-timer-counts">
            {words}
          </span>
        )}
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
  // The layout every stage screen shows (Session 55).
  const layout = useEngine((s) => s.state?.stage?.layout ?? null);
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const ids = layoutTimerIds(layout);
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
