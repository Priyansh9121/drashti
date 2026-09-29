import { useState } from 'react';
import type { MessageItem } from '../../../shared/engine/state';
import type { TimerFields, TimerKind, TimerState } from '../../../shared/timers';
import { formatDuration, parseDuration, TIMER_KIND_NAMES, TIMER_KINDS } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { TimerText } from '../render/TimerText';
import { Button } from '../ui/Button';
import { dispatch, useNotice } from './actions';

const NO_TIMERS: TimerState[] = [];
const NO_MESSAGES: MessageItem[] = [];
const field =
  'rounded-md border border-line bg-ink px-2 py-1 text-sm text-white focus-visible:outline-2 focus-visible:outline-accent';
const small = 'px-2 py-0.5 text-xs';

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
      className="space-y-2 rounded-md border border-accent/60 bg-panel-2 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        aria-label="Timer name"
        className={`${field} w-full`}
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Kind of timer"
          className={field}
          value={kind}
          onChange={(e) => setKind(e.target.value as TimerKind)}
        >
          {TIMER_KINDS.map((k) => (
            <option key={k} value={k}>
              {TIMER_KIND_NAMES[k]}
            </option>
          ))}
        </select>
        {kind === 'countdown' && (
          <input
            aria-label="Length"
            className={`${field} w-24`}
            value={length}
            onChange={(e) => setLength(e.target.value)}
            placeholder="5:00"
          />
        )}
        {kind === 'countdown_to_time' && (
          <input
            aria-label="Time of day"
            type="time"
            className={field}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        )}
      </div>
      {(kind === 'countdown' || kind === 'countdown_to_time') && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={overrun} onChange={(e) => setOverrun(e.target.checked)} />
          Keep counting below zero
        </label>
      )}
      {problem && <p className="text-xs text-amber-200">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" tone="primary" className={small}>
          Save
        </Button>
        <Button className={small} onClick={onDone}>
          Cancel
        </Button>
        {initial && (
          <Button
            tone="danger"
            className={`${small} ml-auto`}
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

function TimerRow({ t, shown, onEdit }: { t: TimerState; shown: boolean; onEdit: () => void }) {
  const running = t.startedAt !== null;
  const counts = t.kind === 'countdown' || t.kind === 'countup';
  return (
    <li
      data-testid="timer-row"
      data-timer-id={t.id}
      data-running={running ? 'true' : undefined}
      className="rounded-md border border-line bg-panel-2 px-2 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm" title={TIMER_KIND_NAMES[t.kind]}>
          {t.name}
        </span>
        <span className="text-lg font-semibold" data-testid="timer-value">
          <TimerText timer={t} />
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {running ? (
          <Button
            className={small}
            onClick={() => void dispatch({ type: counts ? 'pauseTimer' : 'resetTimer', timerId: t.id })}
          >
            {counts ? 'Pause' : 'Stop'}
          </Button>
        ) : (
          <Button
            tone="primary"
            className={small}
            onClick={() => void dispatch({ type: 'startTimer', timerId: t.id })}
          >
            Start
          </Button>
        )}
        {counts && (
          <Button className={small} onClick={() => void dispatch({ type: 'resetTimer', timerId: t.id })}>
            Reset
          </Button>
        )}
        <Button
          tone={shown ? 'live' : 'default'}
          className={small}
          onClick={() =>
            void dispatch(
              shown
                ? { type: 'hideMessage', messageId: `timer:${t.id}` }
                : { type: 'showMessage', message: timerMessage(t) },
            )
          }
        >
          {shown ? 'Take off the screens' : 'Show on the screens'}
        </Button>
        <Button tone="ghost" className={small} onClick={onEdit}>
          Edit
        </Button>
      </div>
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
    <section aria-label="Timers" data-testid="timers" className="space-y-2">
      <div className="flex items-center">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">Timers</h2>
        <Button tone="ghost" className={small} onClick={() => setEditing('new')}>
          + Timer
        </Button>
      </div>
      {editing === 'new' && <TimerForm initial={null} onDone={done} />}
      <ul className="space-y-1.5">
        {timers.map((t) =>
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
        <p className="text-xs text-muted">
          No timers yet. A countdown can show on the screens, for example “Sabha starts in 5:00”.
        </p>
      )}
    </section>
  );
}
