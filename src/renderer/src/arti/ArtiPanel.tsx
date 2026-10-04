import { useEffect, useMemo, useState } from 'react';
import type { ArtiFields, ArtiScheduleInfo } from '../../../shared/arti';
import { ARTI_PROMPT_MAX_MINUTES, artiWhen, WEEKDAY_NAMES, WEEKDAY_SHORT } from '../../../shared/arti';
import { useLibrary } from '../library/library-store';
import { useNow } from '../render/useNow';
import { useNotice } from '../operator/actions';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, NumberInput, Select, TextInput } from '../ui/Field';
import { Flame, Plus } from '../ui/icons';
import { Panel } from '../ui/Panel';
import { Checkbox, Toggle } from '../ui/Toggle';
import { Truncate } from '../ui/Truncate';
import { connectArti, editArti, useArti } from './arti-store';

/*
 * The arti schedules, in the live column (Pro Mode; Simple Mode only
 * answers the prompt). Each says when, which presentation, and when it next
 * prompts; a click edits it. Admins set them; the prompt does the rest.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** "Today 19:00", "Thu 07:00", "2026-11-12 18:30". */
function nextText(at: number, now: number): string {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const days = (at - now) / 864e5;
  if (days < 6.5) return `${WEEKDAY_SHORT[d.getDay()] ?? ''} ${time}`;
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

export function ArtiPanel() {
  const schedules = useArti((s) => s.view?.schedules ?? null);
  useEffect(() => {
    connectArti();
  }, []);
  const now = useNow(60_000);
  return (
    <Panel
      title="Arti"
      icon={Flame}
      collapsible
      remember="arti"
      bodyClassName="space-y-1.5 px-3 pb-3"
      data-testid="arti-panel"
      actions={
        <Button variant="ghost" size="sm" icon={Plus} data-testid="add-arti" onClick={() => editArti('new')}>
          Add
        </Button>
      }
    >
      {schedules && schedules.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Arti schedules">
          {schedules.map((s) => (
            <li
              key={s.id}
              data-testid="arti-schedule"
              className="flex items-center gap-2 rounded-lg border border-line-strong bg-panel-2 px-2 py-1.5"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => editArti(s)}
                aria-label={`Edit ${s.name}`}
              >
                <Truncate text={s.name} className="text-sm font-medium" />
                <span className="block text-xs text-muted">
                  {artiWhen(s)}
                  {s.presentationName === null
                    ? ''
                    : s.enabled && s.nextAt !== null
                      ? ` · next ${nextText(s.nextAt, now)}`
                      : ''}
                </span>
                {s.presentationName === null ? (
                  <span className="block text-xs text-warning-fg">
                    Its presentation was removed: choose another.
                  </span>
                ) : (
                  <Truncate text={s.presentationName} className="block text-xs text-muted" />
                )}
              </button>
              {s.byItself && <Badge tone="warning">By itself</Badge>}
              <Toggle
                checked={s.enabled}
                label={`${s.name} on`}
                hideLabel
                data-testid="arti-enabled"
                onChange={(on) => {
                  void window.drashti.arti.setEnabled(s.id, on).then((r) => {
                    if (!r.ok) useNotice.setState({ text: r.message });
                  });
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">
          No arti times yet. <strong>Add</strong> one: its days and time, and its presentation. Minutes
          before, a prompt asks to put it up.
        </p>
      )}
    </Panel>
  );
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function startFields(editing: ArtiScheduleInfo | 'new', firstPresentation: string): ArtiFields {
  if (editing !== 'new')
    return {
      name: editing.name,
      presentationId:
        editing.presentationName === null ? firstPresentation : (editing.presentationId ?? firstPresentation),
      days: editing.days,
      date: editing.date,
      time: editing.time,
      promptMinutes: editing.promptMinutes,
      byItself: editing.byItself,
      enabled: editing.enabled,
    };
  return {
    name: 'Evening arti',
    presentationId: firstPresentation,
    days: EVERY_DAY,
    date: null,
    time: '19:00',
    promptMinutes: 5,
    byItself: false,
    enabled: true,
  };
}

/** Making or changing a schedule (Pro Mode). */
export function ArtiDialog() {
  const editing = useArti((s) => s.editing);
  if (!editing) return null;
  return <ArtiForm key={editing === 'new' ? 'new' : editing.id} editing={editing} />;
}

function ArtiForm({ editing }: { editing: ArtiScheduleInfo | 'new' }) {
  const presentations = useLibrary((s) => s.presentations);
  const selectedId = useLibrary((s) => s.selectedId);
  const sorted = useMemo(
    () => [...presentations].sort((a, b) => a.name.localeCompare(b.name)),
    [presentations],
  );
  const first = sorted.find((p) => p.id === selectedId)?.id ?? sorted[0]?.id ?? '';
  const [f, setF] = useState<ArtiFields>(() => startFields(editing, first));
  const [weekly, setWeekly] = useState(f.date === null);
  const [date, setDate] = useState(f.date ?? new Date().toISOString().slice(0, 10));
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const id = editing === 'new' ? null : editing.id;
  const close = () => {
    editArti(null);
  };
  const set = (patch: Partial<ArtiFields>) => {
    setF((was) => ({ ...was, ...patch }));
    setProblem(null);
  };
  const save = async () => {
    const fields: ArtiFields = weekly ? { ...f, date: null } : { ...f, days: [], date };
    const result = await window.drashti.arti.save(id, fields);
    if (result.ok) close();
    else setProblem(result.message);
  };
  const missing = editing !== 'new' && editing.presentationName === null;
  return (
    <Dialog
      title={editing === 'new' ? 'New arti time' : `Arti: ${editing.name}`}
      size="md"
      onClose={close}
      closeLabel="Close the arti time"
      testId="arti-dialog"
      footer={
        <>
          {id !== null && (
            <Button
              variant="danger"
              className="mr-auto"
              data-testid="remove-arti"
              onClick={() => setRemoving(true)}
            >
              Remove
            </Button>
          )}
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="arti-form" data-testid="save-arti">
            Save
          </Button>
        </>
      }
    >
      <form
        id="arti-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          <TextInput
            data-testid="arti-name"
            value={f.name}
            maxLength={80}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field
          label="The arti (a presentation, with its sound and background)"
          error={missing ? 'Its presentation was removed: choose another.' : null}
        >
          <Select
            data-testid="arti-presentation"
            value={f.presentationId}
            onChange={(e) => set({ presentationId: e.target.value })}
          >
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted">When</legend>
          <div className="flex gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="arti-when"
                checked={weekly}
                onChange={() => {
                  setWeekly(true);
                  if (f.days.length === 0) set({ days: EVERY_DAY });
                }}
              />
              Every week
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="arti-when"
                data-testid="arti-one-date"
                checked={!weekly}
                onChange={() => setWeekly(false)}
              />
              On one date
            </label>
          </div>
          {weekly ? (
            <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-x-3 gap-y-1">
              {WEEKDAY_NAMES.map((name, day) => (
                <Checkbox
                  key={name}
                  label={WEEKDAY_SHORT[day]}
                  aria-label={name}
                  checked={f.days.includes(day)}
                  onChange={(e) =>
                    set({
                      days: e.target.checked ? [...f.days, day].sort() : f.days.filter((d) => d !== day),
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <Field label="Date">
              <TextInput
                type="date"
                data-testid="arti-date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setProblem(null);
                }}
              />
            </Field>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <Field label="Time (this computer's clock)">
            <TextInput
              type="time"
              data-testid="arti-time"
              value={f.time}
              onChange={(e) => set({ time: e.target.value })}
            />
          </Field>
          <Field label="Prompt this long before">
            <NumberInput
              data-testid="arti-prompt-minutes"
              unit="minutes"
              min={0}
              max={ARTI_PROMPT_MAX_MINUTES}
              value={f.promptMinutes}
              onChange={(e) => set({ promptMinutes: Math.round(Number(e.target.value) || 0) })}
            />
          </Field>
        </div>
        <Checkbox
          data-testid="arti-by-itself"
          label="At the time, put it up by itself (after a ten-second countdown the operator can cancel)"
          checked={f.byItself}
          onChange={(e) => set({ byItself: e.target.checked })}
        />
        <Checkbox label="On" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {problem && (
          <p role="alert" className="text-sm text-danger-fg" data-testid="arti-problem">
            {problem}
          </p>
        )}
      </form>
      {removing && id !== null && (
        <ConfirmDialog
          title="Remove this arti time?"
          confirmLabel="Remove"
          testId="arti-remove-confirm"
          onConfirm={() => {
            void window.drashti.arti.remove(id).then((r) => {
              setRemoving(false);
              if (r.ok) close();
              else setProblem(r.message);
            });
          }}
          onCancel={() => setRemoving(false)}
        >
          It no longer prompts. Its presentation stays in the library.
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
