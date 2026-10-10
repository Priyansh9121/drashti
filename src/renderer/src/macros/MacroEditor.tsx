import { useEffect, useState } from 'react';
import { LAYER_NAMES } from '../../../shared/engine/state';
import type { MacroAction, MacroActionKind, MacroSchedule } from '../../../shared/macros';
import {
  MACRO_ACTION_KINDS,
  MACRO_ACTION_NAMES,
  MACRO_COLORS,
  MACRO_SCHEDULES_MAX,
} from '../../../shared/macros';
import { localDate } from '../../../shared/schedule';
import { DaysPicker } from '../ui/DaysPicker';
import type { MessageTemplate } from '../../../shared/messages';
import { fieldOf, templateFields } from '../../../shared/messages';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { loadMedia, useMedia } from '../library/library-store';
import { connectLooks, useLooks } from '../looks/looks-store';
import { loadProps, useLogo } from '../operator/logo-store';
import { loadTree, usePlaylists } from '../playlists/playlist-store';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { KeepChangesDialog, settingsChanged } from '../ui/KeepChanges';
import { plural } from '../ui/text';
import { ColorInput, Field, NumberInput, Select, TextInput } from '../ui/Field';
import { ArrowDown, ArrowUp, Clock, Plus, Trash2, X } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Checkbox, Toggle } from '../ui/Toggle';
import { change, closeMacros, isDirty, remove, save, show, startNew, useMacros } from './macros-store';

/*
 * The macro editor (the Macros panel's Edit): the macros on the left; the
 * chosen one's name, colour and actions in the middle, run in order as one
 * change. Each action is a row of plain choices. Only actions a macro may do
 * can be chosen: a macro never starts or ends the stream and never changes
 * the library or a setting (Drashti checks again when it is saved and run).
 */

const LAYER_LABELS: Record<(typeof LAYER_NAMES)[number], string> = {
  audio: 'Audio',
  background: 'Background',
  slide: 'Slide',
  props: 'Props',
  messages: 'Messages',
  ticker: 'Ticker',
  masks: 'Masks',
};

/** What the action rows choose from: the library's lists. */
interface Choices {
  looks: { id: string; name: string }[];
  props: { id: string; name: string }[];
  templates: MessageTemplate[];
  timers: { id: string; name: string }[];
  media: { id: string; name: string; kind: string }[];
  playlists: { id: string; name: string }[];
}

/** A new action of a kind, with the first of whatever it names. */
function newAction(kind: MacroActionKind, c: Choices): MacroAction {
  switch (kind) {
    case 'look':
      return { kind, lookId: c.looks[0]?.id ?? '' };
    case 'clearLayer':
      return { kind, layer: 'slide' };
    case 'clearAll':
      return { kind };
    case 'showProp':
    case 'hideProp':
      return { kind, propId: c.props[0]?.id ?? '' };
    case 'showMessage':
      return { kind, templateId: c.templates[0]?.id ?? '', values: {} };
    case 'hideMessage':
      return { kind, templateId: c.templates[0]?.id ?? '' };
    case 'timer':
      return { kind, timerId: c.timers[0]?.id ?? '', how: 'start' };
    case 'playSound':
      return { kind, mediaId: c.media.find((m) => m.kind === 'audio')?.id ?? '', volume: 1, loop: false };
    case 'background':
      return {
        kind,
        mediaId: c.media.find((m) => m.kind === 'image' || m.kind === 'video')?.id ?? '',
        fit: 'fill',
        loop: true,
      };
    case 'backgroundColor':
      return { kind, color: '#000000' };
    case 'blackout':
    case 'logo':
      return { kind, to: 'toggle' };
    case 'stageMessage':
      return { kind, text: 'Placeholder: two minutes' };
    case 'playItem':
      return { kind, playlistId: c.playlists[0]?.id ?? '', itemId: '' };
    case 'idle':
      return { kind, to: 'start' };
  }
}

function Pick({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
  testId?: string;
}) {
  return (
    <Select
      aria-label={label}
      className="min-w-0 flex-1"
      value={value}
      data-testid={testId}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    >
      {!options.some((o) => o.id === value) && <option value={value}>{value ? 'Gone' : 'Choose…'}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}

/** A playlist and one of its items. */
function ItemPick({
  action,
  c,
  set,
}: {
  action: Extract<MacroAction, { kind: 'playItem' }>;
  c: Choices;
  set: (a: MacroAction) => void;
}) {
  const [items, setItems] = useState<PlaylistItemInfo[]>([]);
  useEffect(() => {
    if (!action.playlistId) return;
    let live = true;
    void window.drashti.playlists.items(action.playlistId).then((list) => {
      if (live) setItems(list);
    });
    return () => {
      live = false;
    };
  }, [action.playlistId]);
  const playable = items.filter((i) => i.kind === 'presentation' || i.kind === 'media');
  return (
    <>
      <Pick
        label="Playlist"
        value={action.playlistId}
        options={c.playlists}
        onChange={(playlistId) => {
          set({ ...action, playlistId, itemId: '' });
        }}
      />
      <Pick
        label="Item"
        value={action.itemId}
        options={playable.map((i) => ({ id: i.id, name: i.label }))}
        onChange={(itemId) => {
          set({ ...action, itemId });
        }}
      />
    </>
  );
}

function ActionFields({
  action,
  c,
  set,
}: {
  action: MacroAction;
  c: Choices;
  set: (a: MacroAction) => void;
}) {
  switch (action.kind) {
    case 'look':
      return (
        <Pick
          label="Look"
          value={action.lookId}
          options={c.looks}
          onChange={(lookId) => set({ ...action, lookId })}
        />
      );
    case 'clearLayer':
      return (
        <Select
          aria-label="Layer"
          value={action.layer}
          onChange={(e) => {
            set({ ...action, layer: e.target.value as typeof action.layer });
          }}
        >
          {LAYER_NAMES.map((l) => (
            <option key={l} value={l}>
              {LAYER_LABELS[l]}
            </option>
          ))}
        </Select>
      );
    case 'clearAll':
      return null;
    case 'showProp':
    case 'hideProp':
      return (
        <Pick
          label="Prop"
          value={action.propId}
          options={c.props}
          onChange={(propId) => set({ ...action, propId })}
        />
      );
    case 'showMessage': {
      const t = c.templates.find((x) => x.id === action.templateId);
      const fields = t ? templateFields(t.template).filter((f) => fieldOf(t, f).kind === 'text') : [];
      return (
        <>
          <Pick
            label="Message"
            value={action.templateId}
            options={c.templates}
            onChange={(templateId) => {
              set({ ...action, templateId, values: {} });
            }}
          />
          {fields.map((f) => (
            <TextInput
              key={f}
              aria-label={`{${f}}`}
              placeholder={`{${f}}`}
              className="w-32"
              maxLength={200}
              value={action.values[f] ?? ''}
              onChange={(e) => {
                set({ ...action, values: { ...action.values, [f]: e.target.value } });
              }}
            />
          ))}
        </>
      );
    }
    case 'hideMessage':
      return (
        <Pick
          label="Message"
          value={action.templateId}
          options={c.templates}
          onChange={(templateId) => set({ ...action, templateId })}
        />
      );
    case 'timer':
      return (
        <>
          <Pick
            label="Timer"
            value={action.timerId}
            options={c.timers}
            onChange={(timerId) => set({ ...action, timerId })}
          />
          <Select
            aria-label="Start, pause or reset"
            value={action.how}
            onChange={(e) => {
              set({ ...action, how: e.target.value as typeof action.how });
            }}
          >
            <option value="start">Start</option>
            <option value="pause">Pause</option>
            <option value="reset">Reset</option>
          </Select>
        </>
      );
    case 'playSound':
      return (
        <>
          <Pick
            label="Sound"
            value={action.mediaId}
            options={c.media.filter((m) => m.kind === 'audio')}
            onChange={(mediaId) => set({ ...action, mediaId })}
          />
          <NumberInput
            aria-label="Volume"
            unit="%"
            min={0}
            max={100}
            value={Math.round(action.volume * 100)}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v)) set({ ...action, volume: Math.min(1, Math.max(0, v / 100)) });
            }}
          />
          <Checkbox
            label="Loop"
            checked={action.loop}
            onChange={(e) => set({ ...action, loop: e.target.checked })}
          />
        </>
      );
    case 'background':
      return (
        <>
          <Pick
            label="Picture or video"
            value={action.mediaId}
            options={c.media.filter((m) => m.kind === 'image' || m.kind === 'video')}
            onChange={(mediaId) => set({ ...action, mediaId })}
          />
          <Select
            aria-label="Fit"
            value={action.fit}
            onChange={(e) => {
              set({ ...action, fit: e.target.value as typeof action.fit });
            }}
          >
            <option value="fit">Fit</option>
            <option value="fill">Fill</option>
            <option value="stretch">Stretch</option>
          </Select>
          <Checkbox
            label="Loop"
            checked={action.loop}
            onChange={(e) => set({ ...action, loop: e.target.checked })}
          />
        </>
      );
    case 'backgroundColor':
      return (
        <ColorInput
          aria-label="Colour"
          value={action.color}
          onChange={(e) => set({ ...action, color: e.target.value })}
        />
      );
    case 'blackout':
    case 'logo':
      return (
        <Select
          aria-label={action.kind === 'blackout' ? 'Black-out' : 'Logo'}
          value={action.to}
          onChange={(e) => {
            set({ ...action, to: e.target.value as typeof action.to });
          }}
        >
          <option value="on">On</option>
          <option value="off">Off</option>
          <option value="toggle">The other way</option>
        </Select>
      );
    case 'stageMessage':
      return (
        <TextInput
          aria-label="Stage message (empty clears it)"
          placeholder="Empty: clear the stage message"
          className="min-w-0 flex-1"
          maxLength={300}
          value={action.text ?? ''}
          onChange={(e) => {
            set({ ...action, text: e.target.value.trim() === '' ? null : e.target.value });
          }}
        />
      );
    case 'playItem':
      return <ItemPick action={action} c={c} set={set} />;
    case 'idle':
      return (
        <Select
          aria-label="The idle rotation"
          value={action.to}
          onChange={(e) => {
            set({ ...action, to: e.target.value === 'stop' ? 'stop' : 'start' });
          }}
        >
          <option value="start">Start</option>
          <option value="stop">Stop</option>
        </Select>
      );
  }
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** The times a macro runs by itself (Session 14): weekly on days, or one date, each with its time. */
function MacroTimes({ schedules, set }: { schedules: MacroSchedule[]; set: (s: MacroSchedule[]) => void }) {
  const update = (i: number, patch: Partial<MacroSchedule>) => {
    set(schedules.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };
  return (
    <section className="space-y-2" data-testid="macro-times">
      <SectionTitle>Runs by itself</SectionTitle>
      <p className="text-xs text-muted">
        At each time, Drashti counts down ten seconds (Cancel stops it), then runs this macro, in Simple Mode
        too. A time while Drashti is closed, or a computer asleep, is not run later.
      </p>
      <ul className="space-y-2">
        {schedules.map((s, i) => (
          <li
            key={s.id}
            data-testid="macro-time"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel-2 px-2 py-1.5"
          >
            <Select
              aria-label="Every week or on one date"
              value={s.date === null ? 'weekly' : 'date'}
              onChange={(ev) => {
                if (ev.target.value === 'weekly') update(i, { date: null, days: EVERY_DAY });
                else update(i, { days: [], date: localDate(new Date()) });
              }}
            >
              <option value="weekly">Every week</option>
              <option value="date">On one date</option>
            </Select>
            {s.date === null ? (
              <DaysPicker days={s.days} onChange={(days) => update(i, { days })} />
            ) : (
              <TextInput
                type="date"
                aria-label="Date"
                value={s.date}
                onChange={(ev) => update(i, { date: ev.target.value })}
              />
            )}
            <TextInput
              type="time"
              aria-label="Time (this computer's clock)"
              data-testid="macro-time-at"
              value={s.time}
              onChange={(ev) => update(i, { time: ev.target.value })}
            />
            <Toggle checked={s.enabled} label="On" onChange={(on) => update(i, { enabled: on })} />
            <span className="flex-1" />
            <IconButton
              icon={X}
              label="Remove this time"
              size="sm"
              onClick={() => {
                set(schedules.filter((_, j) => j !== i));
              }}
            />
          </li>
        ))}
      </ul>
      <Button
        icon={Clock}
        data-testid="macro-add-time"
        disabled={schedules.length >= MACRO_SCHEDULES_MAX}
        onClick={() => {
          set([
            ...schedules,
            { id: crypto.randomUUID(), days: EVERY_DAY, date: null, time: '18:30', enabled: true },
          ]);
        }}
      >
        Add a time
      </Button>
    </section>
  );
}

export function MacroEditor() {
  const s = useMacros();
  const looks = useLooks((x) => x.view?.looks);
  const props = useLogo((x) => x.props);
  const timers = useEngine((x) => x.state?.timers);
  const media = useMedia((x) => x.media);
  const tree = usePlaylists((x) => x.tree);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [kind, setKind] = useState<MacroActionKind>('clearAll');
  const [ask, setAsk] = useState<
    null | { why: 'switch'; to: string | null } | { why: 'close' } | { why: 'remove' }
  >(null);
  useEffect(() => {
    if (!s.open) return;
    connectLooks();
    void loadProps();
    void loadMedia();
    void loadTree();
    void window.drashti.messages.list().then(setTemplates);
  }, [s.open]);
  const e = s.editing;
  if (!s.open || !e) return null;
  const dirty = isDirty(s);
  const choices: Choices = {
    looks: looks ?? [],
    props: props ?? [],
    templates,
    timers: (timers ?? []).map((t) => ({ id: t.id, name: t.name })),
    media: media.map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
    playlists: tree.filter((n) => !n.isFolder).map((n) => ({ id: n.id, name: n.name })),
  };
  const setAction = (i: number, a: MacroAction) => {
    change((x) => ({ ...x, actions: x.actions.map((y, j) => (j === i ? a : y)) }));
  };
  const move = (i: number, by: -1 | 1) => {
    change((x) => {
      const actions = [...x.actions];
      const [a] = actions.splice(i, 1);
      if (a) actions.splice(i + by, 0, a);
      return { ...x, actions };
    });
  };
  const go = (to: string | null) => {
    if (dirty) setAsk({ why: 'switch', to });
    else if (to) show(to);
    else startNew();
  };
  /** What the question was asked for: closing, or another macro (or a new one). */
  const leave = (was: { why: 'close' } | { why: 'switch'; to: string | null }) => {
    if (was.why === 'close') closeMacros();
    else if (was.to) show(was.to);
    else startNew();
  };
  return (
    <Dialog
      title="Macros"
      subtitle="Actions run in order, as one change. A macro never starts or ends the stream, and never changes the library or settings."
      size="xl"
      onClose={() => {
        if (dirty) setAsk({ why: 'close' });
        else closeMacros();
      }}
      closeLabel="Close macros"
      testId="macro-editor"
      bodyClassName="flex gap-4"
      footer={
        <>
          {e.id && (
            <Button
              variant="danger"
              icon={Trash2}
              className="mr-auto"
              onClick={() => {
                setAsk({ why: 'remove' });
              }}
            >
              Remove macro
            </Button>
          )}
          <Button
            disabled={!dirty || e.id === null}
            onClick={() => {
              if (e.id) show(e.id);
            }}
          >
            Undo changes
          </Button>
          <Button variant="primary" disabled={!dirty} onClick={() => void save()} data-testid="macro-save">
            Save
          </Button>
        </>
      }
    >
      <nav aria-label="Macros" className="flex w-52 shrink-0 flex-col gap-2">
        <ul className="space-y-1" data-testid="macro-list">
          {(s.macros ?? []).map((m) => (
            <li key={m.id}>
              <button
                type="button"
                aria-current={m.id === e.id ? 'true' : undefined}
                onClick={() => {
                  go(m.id);
                }}
                className={cx(
                  'flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm',
                  m.id === e.id
                    ? 'bg-panel-3 font-medium text-fg'
                    : 'text-muted hover:bg-panel-2 hover:text-fg',
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: m.color }}
                />
                <span className="truncate">{m.name}</span>
              </button>
            </li>
          ))}
          {e.id === null && (
            <li>
              <span className="block truncate rounded-md bg-panel-3 px-2 py-1.5 text-sm font-medium">
                {e.name} (not saved)
              </span>
            </li>
          )}
        </ul>
        <Button
          icon={Plus}
          data-testid="macro-new"
          onClick={() => {
            go(null);
          }}
        >
          New macro
        </Button>
      </nav>
      <div className="min-w-0 flex-1 space-y-4">
        {s.problem && <Notice tone="danger">{s.problem}</Notice>}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name" className="min-w-48 flex-1">
            <TextInput
              value={e.name}
              maxLength={60}
              data-testid="macro-name"
              onChange={(ev) => {
                const name = ev.target.value;
                change((x) => ({ ...x, name }));
              }}
            />
          </Field>
          <fieldset className="flex items-center gap-1.5">
            <legend className="mb-1 text-xs font-medium text-muted">Colour</legend>
            {MACRO_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Colour ${color}`}
                aria-pressed={e.color === color}
                onClick={() => {
                  change((x) => ({ ...x, color }));
                }}
                className={cx(
                  'h-7 w-7 rounded-md border-2',
                  e.color === color ? 'border-fg' : 'border-transparent hover:border-line-strong',
                )}
                style={{ background: color }}
              />
            ))}
          </fieldset>
        </div>
        <section className="space-y-2">
          <SectionTitle>Actions, in order</SectionTitle>
          {e.actions.length === 0 && <p className="text-sm text-muted">No actions yet: add one below.</p>}
          <ol className="space-y-2" data-testid="macro-actions">
            {e.actions.map((a, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2 px-2 py-1.5"
                data-testid="macro-action"
                data-kind={a.kind}
              >
                <span className="w-6 text-right text-xs text-muted tabular-nums">{i + 1}.</span>
                <span className="text-sm font-medium">{MACRO_ACTION_NAMES[a.kind]}</span>
                <ActionFields
                  action={a}
                  c={choices}
                  set={(next) => {
                    setAction(i, next);
                  }}
                />
                <span className="flex-1" />
                <IconButton
                  icon={ArrowUp}
                  label="Up"
                  size="sm"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <IconButton
                  icon={ArrowDown}
                  label="Down"
                  size="sm"
                  disabled={i === e.actions.length - 1}
                  onClick={() => move(i, 1)}
                />
                <IconButton
                  icon={X}
                  label="Remove this action"
                  size="sm"
                  onClick={() => {
                    change((x) => ({ ...x, actions: x.actions.filter((_, j) => j !== i) }));
                  }}
                />
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <Select
              aria-label="Action to add"
              className="min-w-0 flex-1"
              value={kind}
              data-testid="macro-add-kind"
              onChange={(ev) => {
                setKind(ev.target.value as MacroActionKind);
              }}
            >
              {MACRO_ACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {MACRO_ACTION_NAMES[k]}
                </option>
              ))}
            </Select>
            <Button
              icon={Plus}
              disabled={e.actions.length >= 30}
              data-testid="macro-add-action"
              onClick={() => {
                const a = newAction(kind, choices);
                change((x) => ({ ...x, actions: [...x.actions, a] }));
              }}
            >
              Add action
            </Button>
          </div>
        </section>
        <MacroTimes
          schedules={e.schedules}
          set={(schedules) => {
            change((x) => ({ ...x, schedules }));
          }}
        />
      </div>
      {ask?.why === 'remove' && (
        <ConfirmDialog
          title={`Remove “${e.name}”?`}
          confirmLabel="Remove"
          onCancel={() => {
            setAsk(null);
          }}
          onConfirm={() => {
            setAsk(null);
            void remove();
          }}
          testId="macro-confirm"
        >
          <p>
            Slides that run it when they go up no longer run anything, and MIDI mapped to it does nothing.
          </p>
        </ConfirmDialog>
      )}
      {ask && ask.why !== 'remove' && (
        <KeepChangesDialog
          name={<>the macro “{e.name}”</>}
          lost={
            s.saved === null
              ? 'This new macro is not saved yet.'
              : `You changed ${plural(Math.max(1, settingsChanged(s.saved, e)), 'setting')}.`
          }
          note="Saving changes only the macro: nothing on the screens changes until it runs."
          onKeepEditing={() => {
            setAsk(null);
          }}
          onSave={() => {
            const was = ask;
            setAsk(null);
            void save().then((ok) => {
              if (ok) leave(was);
            });
          }}
          onThrowAway={() => {
            const was = ask;
            setAsk(null);
            leave(was);
          }}
        />
      )}
    </Dialog>
  );
}
