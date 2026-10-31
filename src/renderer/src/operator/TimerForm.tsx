import { useState } from 'react';
import type { TimerFields, TimerKind, TimerState } from '../../../shared/timers';
import { parseDuration, TIMER_KIND_NAMES, TIMER_KINDS, timerDuration } from '../../../shared/timers';
import { Button } from '../ui/Button';
import { Select, TextInput } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';

export function TimerForm({
  initial,
  onDone,
  onCreated,
}: {
  initial: TimerState | null;
  onDone: () => void;
  onCreated?: (id: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? 'Countdown');
  const [kind, setKind] = useState<TimerKind>(initial?.kind ?? 'countdown');
  const [length, setLength] = useState(timerDuration(initial?.durationMs ?? 300_000, false));
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
    if (result.ok) {
      if (!initial && 'id' in result && typeof result.id === 'string') onCreated?.(result.id);
      onDone();
    } else setProblem(result.message);
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
        <Button type="submit" variant="secondary" size="sm">
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
