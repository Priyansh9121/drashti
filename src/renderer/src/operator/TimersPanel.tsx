import { useState } from 'react';
import type { MessageItem } from '../../../shared/engine/state';
import type { TimerFields, TimerKind, TimerState } from '../../../shared/timers';
import { formatDuration, parseDuration, TIMER_KIND_NAMES, TIMER_KINDS } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { TimerText } from '../render/TimerText';
import { Button, IconButton } from '../ui/Button';
import { Select, TextInput } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';
import { CalendarDays, Monitor, Pause, Play, Plus, RotateCcw, Square, Timer } from '../ui/icons';
import { openCalendar } from '../calendar/calendar-store';
import { Panel } from '../ui/Panel';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { dispatch, useNotice } from './actions';

const NO_TIMERS: TimerState[] = [];
const NO_MESSAGES: MessageItem[] = [];

/** The message that puts a timer on the audience screens: its name, then its time. */
const timerMessage = (t: TimerState): MessageItem => ({
  id: `timer:${t.id}`,
  text: `${t.name} [${TIMER_KIND_NAMES[t.kind]}]`,
  parts: [
    { kind: 'text', text: `${t.name} ` },
    { kind: 'timer', timerId: t.id },
  ],
});

function TimerForm({ initial, onDone }: { initial: TimerState | null; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? 'Countdown');
  const [kind, setKind] = useState<TimerKind>(initial?.kind ?? 'countdown');
  const [length, setLength] = useState(formatDuration(initial?.durationMs ?? 300_000, false));
  const [at, setAt] = useState(initial?.targetTime ?? '19:30');
  const [overrun, setOverrun] = useState(initial?.allowsOverrun ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    const durationMs = kind === 'countdown' ? parseDuration(length) : 0;
    if (durationMs === null) {
      setProblem('Write the length as minutes and seconds, for example 5:00.');
      return;
    }
    const fields: TimerFields = {
      name,
      kind,
      durationMs,
      targetTime: kind === 'countdown_to_time' ? at : null,
      allowsOverrun: overrun,
    };
    const result = initial
      ? await window.drashti.timers.update(initial.id, fields)
      : await window.drashti.timers.create(fields);
    if (result.ok) onDone();
    else setProblem(result.message);
  };
  return (
    <form
      data-testid="timer-form"
      className="space-y-2 rounded-lg border border-accent/60 bg-panel-2 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <TextInput
        aria-label="Timer name"
        className="w-full"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Kind of timer"

          value={kind}
          onChange={(e) => setKind(e.target.value as TimerKind)}
        >
          {TIMER_KINDS.map((k) => (
            <option key={k} value={k}>
              {TIMER_KIND_NAMES[k]}
            </option>
          ))}
        </Select>
        {kind === 'countdown' && (
          <TextInput
            aria-label="Length"
            className="w-24"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            placeholder="5:00"
          />
        )}
        {kind === 'countdown_to_time' && (
          <TextInput
            aria-label="Time of day"
            type="time"

            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        )}
      </div>
      {(kind === 'countdown' || kind === 'countdown_to_time') && (
        <Checkbox
          label="Keep counting below zero"
          className="text-xs"
          checked={overrun}
          onChange={(e) => setOverrun(e.target.checked)}
        />
      )}
      {problem && (
        <p role="alert" className="text-xs text-warning-fg">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        {initial && (
          <Button
            variant="danger"
            size="sm"
            className="ml-auto"
            onClick={() => {
              void window.drashti.timers.remove(initial.id).then((r) => {
                if (r.ok) onDone();
                else setProblem(r.message);
              });
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * One compact row a timer (Session 26a, tidied): its name and time, then Start (or Pause, or Stop for a
 * clock), Reset, Show on the screens, and Edit for the rest.
 */
function TimerRow({ t, shown, onEdit }: { t: TimerState; shown: boolean; onEdit: () => void }) {
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
          variant="primary"
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
        label={shown ? 'Take off the screens' : 'Show on the screens'}
        variant={shown ? 'live' : 'ghost'}
        aria-pressed={shown}
        size="sm"
        onClick={() =>
          void dispatch(
            shown
              ? { type: 'hideMessage', messageId: `timer:${t.id}` }
              : { type: 'showMessage', message: timerMessage(t) },
          )
        }
      />
      <Button variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </li>
  );
}

/** Countdowns, count-ups, countdowns to a time of day and clocks: start, pause, reset, edit, show. */
export function TimersPanel() {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const messages = useEngine((s) => s.state?.layers.messages) ?? NO_MESSAGES;
  const [editing, setEditing] = useState<string | null>(null);
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
                shown={messages.some((m) => m.id === `timer:${t.id}`)}
                onEdit={() => setEditing(t.id)}
              />
            ),
        )}
      </ul>
      {timers.length === 0 && editing !== 'new' && (
        <EmptyState icon={Timer} title="No timers yet" compact>
          A countdown can show on the screens, for example “Sabha starts in 5:00”.
        </EmptyState>
      )}
    </Panel>
  );
}
