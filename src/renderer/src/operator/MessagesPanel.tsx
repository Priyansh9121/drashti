import { useEffect, useState } from 'react';
import { CALENDAR_LANG_NAMES, CALENDAR_LANGS } from '../../../shared/calendar';
import type { MessageItem } from '../../../shared/engine/state';
import type { MessageField, MessageTemplate, MessageTemplateFields } from '../../../shared/messages';
import { fieldOf, fillMessage, messageItemId, templateFields } from '../../../shared/messages';
import { DEFAULT_MESSAGE_LOOK, keptLook, type MessageLook, placeWords } from '../../../shared/message-look';
import { pushRemoval } from '../library/undo';
import { MessageLookFields } from './MessageLook';
import type { TimerState } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { Select, TextInput } from '../ui/Field';
import { MessageSquare, Pin, PinOff, Plus } from '../ui/icons';
import { pinIt, unpin, useQuickBar } from '../quick-bar/quick-bar-store';
import { pinKey, type QuickPin } from '../../../shared/quick-bar';
import { Panel } from '../ui/Panel';
import { EmptyState, Loading } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { dispatch } from './actions';
import { cutText } from '../../../shared/text';

/** A field's choice in its select: "" typed in, a timer's id, or "samvat:gu" / "samvat:en". */
function fieldChoice(f: MessageField): string {
  if (f.kind === 'timer') return f.timerId;
  if (f.kind === 'samvat') return `samvat:${f.lang}`;
  return '';
}

function fieldFromChoice(choice: string): MessageField {
  if (choice === '') return { kind: 'text' };
  if (choice === 'samvat:gu' || choice === 'samvat:en')
    return { kind: 'samvat', lang: choice === 'samvat:gu' ? 'gu' : 'en' };
  return { kind: 'timer', timerId: choice };
}

const NO_MESSAGES: MessageItem[] = [];
const NO_TIMERS: TimerState[] = [];

function TemplateForm({
  initial,
  timers,
  onDone,
}: {
  initial: MessageTemplate | null;
  timers: readonly TimerState[];
  onDone: (changed: boolean) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [template, setTemplate] = useState(initial?.template ?? '');
  const [fields, setFields] = useState<Record<string, MessageField>>(initial?.fields ?? {});
  // Its look and how long it stays up (Session 55, Part 15): the standard look, until taken off, to begin with.
  const [look, setLook] = useState<MessageLook>(initial?.look ?? DEFAULT_MESSAGE_LOOK);
  const [seconds, setSeconds] = useState<number | null>(initial?.seconds ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const names = templateFields(template);
  const save = async () => {
    // Keep only the fields the template still has.
    const kept = Object.fromEntries(names.flatMap((n) => (fields[n] ? [[n, fields[n]]] : [])));
    // The standard look is kept as none: the message shows in the band along the bottom, as every message did.
    const own = keptLook(look);
    const body: MessageTemplateFields = {
      name: name.trim() === '' ? cutText(template, 40) : name,
      template,
      fields: kept,
      ...(own ? { look: own } : {}),
      ...(seconds === null ? {} : { seconds }),
    };
    const result = initial
      ? await window.drashti.messages.update(initial.id, body)
      : await window.drashti.messages.create(body);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    // A change can be undone (Session 55): the message as it was.
    if (initial)
      pushRemoval({
        text: `Changed the message “${initial.name}”`,
        restore: async () => {
          await window.drashti.messages.restore(initial);
        },
      });
    onDone(true);
  };
  return (
    <form
      data-testid="message-form"
      className="space-y-2 rounded-lg border border-accent/60 bg-panel-2 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <TextInput
        aria-label="Message name"
        placeholder="Name, for example Car parking"
        className="w-full"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <TextInput
        aria-label="Message words"
        placeholder="Car {plate} please move"
        className="w-full"
        value={template}
        maxLength={300}
        onChange={(e) => setTemplate(e.target.value)}
      />
      <p className="text-xs text-muted">
        Put a field in braces, for example {'{plate}'}: it is filled in when the message is shown.
      </p>
      {names.map((n) => (
        <label key={n} className="flex items-center gap-2 text-xs text-muted">
          <span className="min-w-0 flex-1 truncate">{`{${n}}`}</span>
          <Select
            aria-label={`How {${n}} is filled`}

            value={fieldChoice(fieldOf({ fields }, n))}
            onChange={(e) => {
              const choice = e.target.value;
              setFields((f) => ({ ...f, [n]: fieldFromChoice(choice) }));
            }}
          >
            <option value="">Typed in</option>
            {timers.map((t) => (
              <option key={t.id} value={t.id}>
                Timer: {t.name}
              </option>
            ))}
            {CALENDAR_LANGS.map((lang) => (
              <option key={lang} value={`samvat:${lang}`}>
                {`Today’s Samvat date (${CALENDAR_LANG_NAMES[lang]})`}
              </option>
            ))}
          </Select>
        </label>
      ))}
      <MessageLookFields
        words={template}
        look={look}
        seconds={seconds}
        onLook={setLook}
        onSeconds={setSeconds}
      />
      {problem && (
        <p role="alert" className="text-xs text-warning-fg">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size="sm" disabled={template.trim() === ''}>
          Save
        </Button>
        <Button size="sm" onClick={() => onDone(false)}>
          Cancel
        </Button>
        {initial && (
          <Button
            variant="danger"
            size="sm"
            className="ml-auto"
            onClick={() => {
              void window.drashti.messages.remove(initial.id).then((r) => {
                if (!r.ok) {
                  setProblem(r.message);
                  return;
                }
                // Undo brings it back as it was, its look too (Session 55).
                pushRemoval({
                  text: `Deleted the message “${initial.name}”`,
                  restore: async () => {
                    await window.drashti.messages.restore(initial);
                  },
                });
                onDone(true);
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

function TemplateRow({
  t,
  timers,
  shown,
  onEdit,
}: {
  t: MessageTemplate;
  timers: readonly TimerState[];
  shown: boolean;
  onEdit: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const names = templateFields(t.template);
  // On the quick bar (Session 55, Part 8): one press shows it, as Show does.
  const pin: QuickPin = { kind: 'message', templateId: t.id, label: t.name };
  const pinned = useQuickBar((s) => s.pins.some((p) => p.kind === 'message' && p.templateId === t.id));
  const show = () => {
    const filled = fillMessage(t, values, (id) => timers.find((x) => x.id === id)?.name ?? 'timer');
    if (!filled.message) {
      setProblem(`Fill in ${filled.missing.map((n) => `{${n}}`).join(', ')} first.`);
      return;
    }
    setProblem(null);
    void dispatch({ type: 'showMessage', message: filled.message });
  };
  return (
    <li
      data-testid="message-row"
      data-shown={shown ? 'true' : undefined}
      className="space-y-1.5 rounded-md border border-line bg-panel-2 px-2.5 py-2"
    >
      <div className="flex items-center gap-2">
        <Truncate text={t.name} className="flex-1 text-sm font-medium" />
        {shown && <Badge tone="live">On the screens</Badge>}
        <IconButton
          icon={pinned ? PinOff : Pin}
          size="sm"
          label={pinned ? `Unpin “${t.name}” from the quick bar` : `Pin “${t.name}” to the quick bar`}
          data-testid="message-pin"
          onClick={() => void (pinned ? unpin(pinKey(pin)) : pinIt(pin))}
        />
      </div>
      <Truncate text={t.template} className="text-xs text-muted" />
      {/* Where its own look puts it, and how long it stays up (Session 55). */}
      {(t.look !== undefined || t.seconds !== undefined) && (
        <p className="text-xs text-faint" data-testid="message-row-look">
          {[
            t.look ? placeWords(t.look.place) : null,
            t.seconds === undefined ? null : `up ${String(t.seconds)} s`,
          ]
            .filter((w): w is string => w !== null)
            .join(' · ')}
        </p>
      )}
      {names.map((n) => {
        const f = fieldOf(t, n);
        return f.kind === 'timer' ? (
          <p key={n} className="text-xs text-muted">
            {`{${n}}`}: timer “{timers.find((x) => x.id === f.timerId)?.name ?? 'removed'}”
          </p>
        ) : f.kind === 'samvat' ? (
          <p key={n} className="text-xs text-muted">
            {`{${n}}`}: today’s Samvat date ({CALENDAR_LANG_NAMES[f.lang]})
          </p>
        ) : (
          <TextInput
            key={n}
            aria-label={n}
            placeholder={n}
            className="w-full"
            value={values[n] ?? ''}
            maxLength={120}
            onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') show();
            }}
          />
        );
      })}
      {problem && (
        <p role="alert" className="text-xs text-warning-fg">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <Button variant="secondary" size="sm" onClick={show}>
          {shown ? 'Update' : 'Show'}
        </Button>
        {shown && (
          <Button
            size="sm"
            onClick={() => void dispatch({ type: 'hideMessage', messageId: messageItemId(t.id) })}
          >
            Take off
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </li>
  );
}

/** Message templates with fields: fill in, show on the audience screens (several at once), take off. */
export function MessagesPanel() {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const messages = useEngine((s) => s.state?.layers.messages) ?? NO_MESSAGES;
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const reload = () => {
    void window.drashti.messages.list().then(setTemplates);
  };
  // Loaded as the window opens, and again whenever templates change (here, or arriving with an import).
  useEffect(() => {
    reload();
    return window.drashti.library.onChanged((what) => {
      if (what === 'messages' || what === 'presentations') reload();
    });
  }, []);
  const done = (changed: boolean) => {
    setEditing(null);
    if (changed) reload();
  };
  return (
    <Panel
      help="messages"
      title="Messages"
      icon={MessageSquare}
      collapsible
      remember="messages"
      data-testid="messages"
      bodyClassName="space-y-2 px-3 pb-3"
      actions={
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setEditing('new')}>
          New message
        </Button>
      }
    >
      {editing === 'new' && <TemplateForm initial={null} timers={timers} onDone={done} />}
      {templates === null && <Loading label="Loading the messages…" />}
      <ul className="space-y-1.5">
        {(templates ?? []).map((t) =>
          editing === t.id ? (
            <li key={t.id}>
              <TemplateForm initial={t} timers={timers} onDone={done} />
            </li>
          ) : (
            <TemplateRow
              key={t.id}
              t={t}
              timers={timers}
              shown={messages.some((m) => m.id === messageItemId(t.id))}
              onEdit={() => setEditing(t.id)}
            />
          ),
        )}
      </ul>
      {templates?.length === 0 && editing !== 'new' && (
        <EmptyState icon={MessageSquare} title="No messages yet" compact>
          For example: Car {'{plate}'} please move.
        </EmptyState>
      )}
    </Panel>
  );
}
