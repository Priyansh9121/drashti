import { useEffect, useState } from 'react';
import type { MessageItem } from '../../../shared/engine/state';
import type { MessageField, MessageTemplate } from '../../../shared/messages';
import { fieldOf, fillMessage, messageItemId, templateFields } from '../../../shared/messages';
import type { TimerState } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { dispatch } from './actions';

const NO_MESSAGES: MessageItem[] = [];
const NO_TIMERS: TimerState[] = [];
const field =
  'rounded-md border border-line bg-ink px-2 py-1 text-sm text-white placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent';
const small = 'px-2 py-0.5 text-xs';

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
  const [problem, setProblem] = useState<string | null>(null);
  const names = templateFields(template);
  const save = async () => {
    // Keep only the fields the template still has.
    const kept = Object.fromEntries(names.flatMap((n) => (fields[n] ? [[n, fields[n]]] : [])));
    const body = { name: name.trim() === '' ? template.slice(0, 40) : name, template, fields: kept };
    const result = initial
      ? await window.drashti.messages.update(initial.id, body)
      : await window.drashti.messages.create(body);
    if (result.ok) onDone(true);
    else setProblem(result.message);
  };
  return (
    <form
      data-testid="message-form"
      className="space-y-2 rounded-md border border-accent/60 bg-panel-2 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        aria-label="Message name"
        placeholder="Name, for example Car parking"
        className={`${field} w-full`}
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="Message words"
        placeholder="Car {plate} please move"
        className={`${field} w-full`}
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
          <select
            aria-label={`How {${n}} is filled`}
            className={field}
            value={fieldOf({ fields }, n).kind === 'timer' ? (fields[n] as { timerId: string }).timerId : ''}
            onChange={(e) => {
              const timerId = e.target.value;
              setFields((f) => ({
                ...f,
                [n]: timerId === '' ? { kind: 'text' } : { kind: 'timer', timerId },
              }));
            }}
          >
            <option value="">Typed in</option>
            {timers.map((t) => (
              <option key={t.id} value={t.id}>
                Timer: {t.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      {problem && <p className="text-xs text-amber-200">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" tone="primary" className={small} disabled={template.trim() === ''}>
          Save
        </Button>
        <Button className={small} onClick={() => onDone(false)}>
          Cancel
        </Button>
        {initial && (
          <Button
            tone="danger"
            className={`${small} ml-auto`}
            onClick={() => {
              void window.drashti.messages.remove(initial.id).then((r) => {
                if (r.ok) onDone(true);
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
      className="space-y-1.5 rounded-md border border-line bg-panel-2 px-2 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm" title={t.template}>
          {t.name}
        </span>
        {shown && <span className="rounded bg-live px-1.5 text-[10px] font-bold text-white">ON SCREENS</span>}
      </div>
      <p className="truncate text-xs text-muted">{t.template}</p>
      {names.map((n) => {
        const f = fieldOf(t, n);
        return f.kind === 'timer' ? (
          <p key={n} className="text-xs text-muted">
            {`{${n}}`}: timer “{timers.find((x) => x.id === f.timerId)?.name ?? 'removed'}”
          </p>
        ) : (
          <input
            key={n}
            aria-label={n}
            placeholder={n}
            className={`${field} w-full`}
            value={values[n] ?? ''}
            maxLength={120}
            onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') show();
            }}
          />
        );
      })}
      {problem && <p className="text-xs text-amber-200">{problem}</p>}
      <div className="flex flex-wrap gap-1">
        <Button tone="primary" className={small} onClick={show}>
          {shown ? 'Update' : 'Show'}
        </Button>
        {shown && (
          <Button
            className={small}
            onClick={() => void dispatch({ type: 'hideMessage', messageId: messageItemId(t.id) })}
          >
            Take off
          </Button>
        )}
        <Button tone="ghost" className={small} onClick={onEdit}>
          Edit
        </Button>
      </div>
    </li>
  );
}

/** Message templates with fields: fill in, show on the audience screens (several at once), take off. */
export function MessagesPanel() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const messages = useEngine((s) => s.state?.layers.messages) ?? NO_MESSAGES;
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const reload = () => {
    void window.drashti.messages.list().then(setTemplates);
  };
  useEffect(reload, []);
  const done = (changed: boolean) => {
    setEditing(null);
    if (changed) reload();
  };
  return (
    <section aria-label="Messages" data-testid="messages" className="space-y-2">
      <div className="flex items-center">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">Messages</h2>
        <Button tone="ghost" className={small} onClick={() => setEditing('new')}>
          + Message
        </Button>
      </div>
      {editing === 'new' && <TemplateForm initial={null} timers={timers} onDone={done} />}
      <ul className="space-y-1.5">
        {templates.map((t) =>
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
      {templates.length === 0 && editing !== 'new' && (
        <p className="text-xs text-muted">No messages yet. For example: Car {'{plate}'} please move.</p>
      )}
    </section>
  );
}
