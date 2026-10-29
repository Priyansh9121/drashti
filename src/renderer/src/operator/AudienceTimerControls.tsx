import { useState } from 'react';
import type { TimerState } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { TimerText } from '../render/TimerText';
import { Button, IconButton } from '../ui/Button';
import { Field, Select } from '../ui/Field';
import { Monitor, Pause, Play, RotateCcw, Square } from '../ui/icons';
import { dispatch } from './actions';

/*
 * A timer for the audience from the Stage screen panel (Session 55, Part 15), as Timers has it: which timer, its time,
 * Start (or Pause, or Stop for a clock or a countdown to a time, which count by the clock), Reset, and Show for the
 * audience or Hide. The one up is chosen while it is up.
 */

const NO_TIMERS: TimerState[] = [];

export function AudienceTimerControls() {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const up = useEngine((s) => s.state?.layers.timer?.timerId ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  if (timers.length === 0) return null;
  const id = up ?? (picked !== null && timers.some((t) => t.id === picked) ? picked : (timers[0]?.id ?? ''));
  const t = timers.find((x) => x.id === id);
  if (!t) return null;
  const running = t.startedAt !== null;
  const counts = t.kind === 'countdown' || t.kind === 'countup';
  const shown = up === t.id;
  return (
    <div
      data-testid="stage-audience-timer"
      className="space-y-1.5 rounded-md border border-line bg-panel-2 p-2"
    >
      <div className="flex items-end gap-2">
        <Field label="Timer for the audience" className="min-w-0 flex-1">
          <Select
            aria-label="Timer for the audience"
            value={t.id}
            onChange={(e) => {
              setPicked(e.target.value);
            }}
          >
            {timers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <span className="pb-1.5 font-bold tabular-nums">
          <TimerText timer={t} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {running ? (
          <IconButton
            icon={counts ? Pause : Square}
            label={counts ? 'Pause' : 'Stop'}
            size="sm"
            onClick={() => void dispatch({ type: counts ? 'pauseTimer' : 'resetTimer', timerId: t.id })}
          />
        ) : (
          <IconButton
            icon={Play}
            label="Start"
            variant="secondary"
            size="sm"
            onClick={() => void dispatch({ type: 'startTimer', timerId: t.id })}
          />
        )}
        {counts && (
          <IconButton
            icon={RotateCcw}
            label="Reset"
            size="sm"
            onClick={() => void dispatch({ type: 'resetTimer', timerId: t.id })}
          />
        )}
        <Button
          size="sm"
          icon={Monitor}
          variant={shown ? 'live' : 'secondary'}
          className="ml-auto"
          onClick={() =>
            void dispatch(
              shown ? { type: 'hideAudienceTimer' } : { type: 'showAudienceTimer', timerId: t.id },
            )
          }
        >
          {shown ? 'Hide' : 'Show for the audience'}
        </Button>
      </div>
    </div>
  );
}
