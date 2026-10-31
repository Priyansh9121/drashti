import { useState } from 'react';
import type { TimerState } from '../../../shared/timers';
import { TIMER_KIND_NAMES } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { TimerText } from '../render/TimerText';
import { Button, IconButton } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { CalendarDays, Monitor, Palette, Pause, Play, Plus, RotateCcw, Square, Timer } from '../ui/icons';
import { START_COUNTDOWN_NAME } from '../../../shared/timer-look';
import { TimerLookDialog } from './TimerLookDialog';
import { openCalendar } from '../calendar/calendar-store';
import { Panel } from '../ui/Panel';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { dispatch, useNotice } from './actions';

import { TimerForm } from './TimerForm';

const NO_TIMERS: TimerState[] = [];

/**
 * One compact row a timer (Session 26a, tidied): its name and time, then Start (or Pause, or Stop for a
 * clock), Reset, Show for the audience, its look, and Edit for the rest. Show for the audience (Session 55, Part 15)
 * puts the timer up on the hall's screens in its own look (How it looks for the audience…: full screen or a corner, over the
 * wallpaper or over what is up, and the rest); pressed again (Hide), or Clear all, takes it off. Before, Show on the
 * screens put it up alone in the slide's place (the engine's showTimer still does, for the API).
 */
function TimerRow({
  t,
  shown,
  onEdit,
  onLook,
}: {
  t: TimerState;
  shown: boolean;
  onEdit: () => void;
  onLook: () => void;
}) {
  const running = t.startedAt !== null;
  const counts = t.kind === 'countdown' || t.kind === 'countup';
  return (
    <li
      data-testid="timer-row"
      data-timer-id={t.id}
      data-running={running ? 'true' : undefined}
      // relative: its words for a screen reader (sr-only, absolute) stay inside the scrolling column.
      className="relative flex items-center gap-1 rounded-md border border-line bg-panel-2 py-1 pr-1 pl-2.5"
    >
      <span className="min-w-0 flex-1">
        <Truncate text={t.name} className="text-sm font-medium" />
        <span className="sr-only">, {TIMER_KIND_NAMES[t.kind]}</span>
      </span>
      <span className="px-1 font-bold tabular-nums" data-testid="timer-value">
        <TimerText timer={t} />
      </span>
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
      <IconButton
        icon={Monitor}
        label={shown ? 'Hide' : 'Show for the audience'}
        variant={shown ? 'live' : 'ghost'}
        size="sm"
        data-testid="timer-show"
        onClick={() =>
          void dispatch(shown ? { type: 'hideAudienceTimer' } : { type: 'showAudienceTimer', timerId: t.id })
        }
      />
      <IconButton
        icon={Palette}
        label="How it looks for the audience…"
        size="sm"
        data-testid="timer-look-open"
        onClick={onLook}
      />
      <Button variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </li>
  );
}

/**
 * Countdown to the start (Session 55, Part 15): the sabha's time, a countdown over the wallpaper on the audience and
 * the stage, gone by itself at zero. Its one timer is made, or changed to this time, and shown.
 */
function StartCountdown({ onDone }: { onDone: () => void }) {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const q = timers.find((t) => t.name === START_COUNTDOWN_NAME);
  const up = useEngine((s) => s.state?.layers.timer?.timerId ?? null);
  const [at, setAt] = useState(q?.targetTime ?? '19:30');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      data-testid="start-countdown"
      className="space-y-2 rounded-lg border border-accent/60 bg-panel-2 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void window.drashti.timers.startCountdown(at).then((r) => {
          if (r.ok) onDone();
          else setProblem(r.message);
        });
      }}
    >
      <p className="text-xs text-muted">
        A countdown to the sabha’s time over the wallpaper, on the audience and the stage. It goes by itself
        at zero.
      </p>
      <label className="flex items-center gap-2 text-xs text-muted">
        The sabha’s time
        <TextInput
          aria-label="The sabha’s time"
          type="time"
          value={at}
          onChange={(e) => {
            setAt(e.target.value);
          }}
        />
      </label>
      {problem && (
        <p role="alert" className="text-xs text-warning-fg">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" size="sm">
          Show the countdown
        </Button>
        {up !== null && up === q?.id && (
          <Button
            size="sm"
            onClick={() => {
              void dispatch({ type: 'hideAudienceTimer' }).then(onDone);
            }}
          >
            Hide the countdown
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Countdowns, count-ups, countdowns to a time of day and clocks: start, pause, reset, edit, show. */
export function TimersPanel() {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  // The timer up for the audience, if one is (Session 55).
  const alone = useEngine((s) => s.state?.layers.timer?.timerId ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const [looking, setLooking] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const lookAt = timers.find((t) => t.id === looking);
  const done = () => {
    setEditing(null);
    useNotice.setState({ text: null });
  };
  return (
    <Panel
      help="timers"
      title="Timers"
      icon={Timer}
      collapsible
      remember="timers"
      data-testid="timers"
      bodyClassName="space-y-2 px-3 pb-3"
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={CalendarDays}
            data-testid="open-calendar"
            onClick={() => {
              openCalendar();
            }}
          >
            Calendar
          </Button>
          <Button variant="ghost" size="sm" icon={Plus} onClick={() => setEditing('new')}>
            New timer
          </Button>
        </>
      }
    >
      <Button
        size="sm"
        variant="secondary"
        icon={Timer}
        className="w-full"
        aria-expanded={starting}
        onClick={() => {
          setStarting((s) => !s);
        }}
      >
        Countdown to the start…
      </Button>
      {starting && (
        <StartCountdown
          onDone={() => {
            setStarting(false);
          }}
        />
      )}
      {lookAt && (
        <TimerLookDialog
          timer={lookAt}
          onClose={() => {
            setLooking(null);
          }}
        />
      )}
      {editing === 'new' && <TimerForm initial={null} onDone={done} />}
      <ul className="space-y-1">
        {/* Running timers first (Session 26a), the rest in their order. */}
        {[...timers.filter((t) => t.startedAt !== null), ...timers.filter((t) => t.startedAt === null)].map(
          (t) =>
            editing === t.id ? (
              <li key={t.id}>
                <TimerForm initial={t} onDone={done} />
              </li>
            ) : (
              <TimerRow
                key={t.id}
                t={t}
                shown={alone === t.id}
                onEdit={() => setEditing(t.id)}
                onLook={() => {
                  setLooking(t.id);
                }}
              />
            ),
        )}
      </ul>
      {timers.length === 0 && editing !== 'new' && (
        <EmptyState icon={Timer} title="No timers yet" compact>
          A countdown can go up on the screens on its own, or in a message, for example “Sabha starts in
          5:00”.
        </EmptyState>
      )}
    </Panel>
  );
}
