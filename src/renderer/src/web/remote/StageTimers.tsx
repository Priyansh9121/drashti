import { useContext } from 'react';
import { countsToWords, layoutTimerIds } from '../../../../shared/stage-timer';
import { isRunning, type TimerState } from '../../../../shared/timers';
import { useEngine } from '../../engine/engine-store';
import { ClockStyleContext } from '../../render/clock-style';
import { TimerText } from '../../render/TimerText';
import { Button } from '../../ui/Button';
import { Pause, Play, RotateCcw, Square } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { useRemote } from './remote-store';

/*
 * The stage screens' timers on the phone remote (Session 54, Part A3), as the Stage screen panel has them in
 * Drashti: each timer the stage screens' layout shows by name (the live Look's first stage group's, which Drashti
 * names in GET /api/v1/hall), with its time, what it counts to, and Start, Pause and Reset. Nothing for the
 * Standard stage screen, or a layout with no timer chosen in it. The remote's Stage screen section (D5's) has the
 * list under its message.
 */

const NO_TIMERS: TimerState[] = [];

const post = (path: string) => () => api<{ rev?: number }>(path, { method: 'POST' });

function StageTimerRow({ timer }: { timer: TimerState }) {
  const running = isRunning(timer);
  // A countdown and a count-up pause and reset; a countdown to a time and a clock count by the clock, and stop.
  const counts = timer.kind === 'countdown' || timer.kind === 'countup';
  const style = useContext(ClockStyleContext);
  const words = countsToWords(timer, style);
  const at = `/api/v1/timers/${encodeURIComponent(timer.id)}`;
  return (
    <li
      className="space-y-2 rounded-lg border border-line bg-panel-2 px-3 py-2"
      data-testid="remote-stage-timer"
      data-timer-id={timer.id}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-fg">{timer.name}</span>
          {words && <span className="block text-base text-muted">{words}</span>}
        </span>
        <span className="font-mono text-2xl text-fg" data-testid="remote-stage-timer-value">
          <TimerText timer={timer} />
        </span>
      </div>
      <div className="flex gap-2">
        {running ? (
          <Button
            size="lg"
            className="min-h-12 flex-1"
            icon={counts ? Pause : Square}
            onClick={() => void tap(post(`${at}/${counts ? 'pause' : 'reset'}`))}
          >
            {counts ? 'Pause' : 'Stop'}
          </Button>
        ) : (
          <Button
            size="lg"
            className="min-h-12 flex-1"
            variant="secondary"
            icon={Play}
            onClick={() => void tap(post(`${at}/start`))}
          >
            Start
          </Button>
        )}
        {counts && (
          <Button
            size="lg"
            className="min-h-12 flex-1"
            icon={RotateCcw}
            onClick={() => void tap(post(`${at}/reset`))}
          >
            Reset
          </Button>
        )}
      </div>
    </li>
  );
}

/** The stage layout's timers shown now, each once, in its order: none for the Standard stage screen. */
function useStageTimers(): TimerState[] {
  const groupId = useRemote((s) => s.hall?.stageGroupId ?? null);
  const layout = useEngine((s) => (groupId ? s.state?.look.groups[groupId]?.stageLayout : null) ?? null);
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  return layoutTimerIds(layout).flatMap((id) => timers.filter((t) => t.id === id));
}

/** The stage layout's timers as a list, or nothing when it names none. */
export function StageTimerList() {
  const shown = useStageTimers();
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="The stage screens’ timers" data-testid="remote-stage-timers">
      {shown.map((t) => (
        <StageTimerRow key={t.id} timer={t} />
      ))}
    </ul>
  );
}
