import { useEffect, useState } from 'react';
import {
  ANNOUNCEMENT_MINUTES_MAX,
  ANNOUNCEMENT_TEMPLATE,
  ANNOUNCEMENT_TEXT_MAX,
  type Announcement,
  type ShownAs,
} from '../../../shared/announcements';
import { fieldOf, type MessageTemplate, templateFields } from '../../../shared/messages';
import { useEngine } from '../engine/engine-store';
import { useNow } from '../render/useNow';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, NumberInput, Select, Textarea } from '../ui/Field';
import { Check, MessageSquare, Pencil, ScrollText, X } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { announcementAction, closeAnnouncements, useAnnouncements } from './announcements-store';
import { useNetwork } from './network-store';

/*
 * Announcements sent from phones (Pro Mode): waiting ones to approve (as a
 * message or in the ticker), edit or reject; the ones on the screens, until
 * their time is up; and the most recent of the rest. A sheet on the right,
 * like Phones.
 */

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

/** "just now", "5 min ago", "2 h ago". */
function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  return `${Math.floor(ms / 3_600_000)} h ago`;
}

const forHowLong = (minutes: number) => (minutes === 60 ? '1 hour' : `${minutes} min`);

/** Templates an announcement can go up with: one field to type the words into (and maybe {from}). */
const usable = (t: MessageTemplate) => {
  const typed = templateFields(t.template).filter((n) => fieldOf(t, n).kind === 'text');
  const words = typed.filter((n) => n.toLowerCase() !== 'from');
  return words.length === 1;
};

function Waiting({ a, templates }: { a: Announcement; templates: MessageTemplate[] }) {
  const now = useNow(30_000);
  const [as, setAs] = useState<ShownAs>('ticker');
  const own = templates.find((t) => t.name === ANNOUNCEMENT_TEMPLATE.name);
  const [templateId, setTemplateId] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a.text);
  const [minutes, setMinutes] = useState(String(a.minutes));
  const choices = templates.filter(usable);
  return (
    <li className="space-y-3 rounded-lg border border-line bg-panel-2 p-3" data-testid="announcement-waiting">
      {editing ? (
        <div className="space-y-3">
          <Field label="Announcement" hint={`${text.length} of ${ANNOUNCEMENT_TEXT_MAX}`}>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={ANNOUNCEMENT_TEXT_MAX}
              rows={3}
              data-testid="announcement-edit-text"
            />
          </Field>
          <Field label="Show it for" layout="inline">
            <NumberInput
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              min={1}
              max={ANNOUNCEMENT_MINUTES_MAX}
              unit="min"
              data-testid="announcement-edit-minutes"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="primary"
              icon={Check}
              data-testid="announcement-save"
              onClick={() =>
                void announcementAction(() =>
                  window.drashti.announcements.edit({ id: a.id, text, minutes: Number(minutes) }),
                ).then((r) => {
                  if (r.ok) setEditing(false);
                })
              }
            >
              Save
            </Button>
            <Button
              onClick={() => {
                setText(a.text);
                setMinutes(String(a.minutes));
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-base break-words text-fg" data-testid="announcement-text">
            {a.text}
          </p>
          <p className="text-xs text-muted">
            From {a.from} · {a.deviceName} · sent {ago(a.sentAt, now)} · for {forHowLong(a.minutes)}
            {a.text !== a.sentText && ' · edited'}
          </p>
        </div>
      )}
      {!editing && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Show it" layout="inline">
            <Select
              value={as}
              onChange={(e) => setAs(e.target.value as ShownAs)}
              data-testid="announcement-as"
              className="w-36"
            >
              <option value="ticker">In the ticker</option>
              <option value="message">As a message</option>
            </Select>
          </Field>
          {as === 'message' && (
            <Field label="Template" layout="inline">
              <Select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                data-testid="announcement-template"
                className="w-48"
              >
                <option value="">{own ? own.name : `${ANNOUNCEMENT_TEMPLATE.name} (made now)`}</option>
                {choices
                  .filter((t) => t.id !== own?.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <span className="flex-1" />
          <Button
            variant="primary"
            icon={as === 'ticker' ? ScrollText : MessageSquare}
            data-testid="announcement-approve"
            onClick={() =>
              void announcementAction(() =>
                window.drashti.announcements.approve({ id: a.id, as, templateId: templateId || null }),
              )
            }
          >
            Approve
          </Button>
          <Button icon={Pencil} onClick={() => setEditing(true)} data-testid="announcement-edit">
            Edit
          </Button>
          <Button
            variant="danger"
            icon={X}
            data-testid="announcement-reject"
            onClick={() => void announcementAction(() => window.drashti.announcements.reject({ id: a.id }))}
          >
            Reject
          </Button>
        </div>
      )}
    </li>
  );
}

function Showing({ a }: { a: Announcement }) {
  const up = useEngine((s) => {
    const layers = s.state?.layers;
    if (!layers) return false;
    return (
      layers.messages.some((m) => m.id === a.id) || (layers.ticker?.items.some((i) => i.id === a.id) ?? false)
    );
  });
  return (
    <li className="space-y-2 rounded-lg border border-line bg-panel-2 p-3" data-testid="announcement-showing">
      <p className="text-base break-words text-fg">{a.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        {up ? (
          <Badge tone="live">On the screens</Badge>
        ) : (
          <Badge tone="warning">Cleared from the screens</Badge>
        )}
        <span className="text-xs text-muted">
          {a.shownAs === 'ticker' ? 'In the ticker' : 'As a message'} · comes off at {clock(a.until)}
        </span>
        <span className="flex-1" />
        <Button
          icon={X}
          data-testid="announcement-take-off"
          onClick={() => void announcementAction(() => window.drashti.announcements.takeOff({ id: a.id }))}
        >
          Take off
        </Button>
      </div>
    </li>
  );
}

function Earlier({ a }: { a: Announcement }) {
  return (
    <li className="flex items-baseline gap-2 py-1 text-sm" data-testid="announcement-earlier">
      <span className="min-w-0 flex-1 truncate text-fg">{a.text}</span>
      <span className="shrink-0 text-xs text-muted">
        {a.status === 'rejected'
          ? `Not shown (${clock(a.decidedAt)})`
          : `Shown ${clock(a.decidedAt)}–${clock(a.endedAt)}`}
      </span>
    </li>
  );
}

export function AnnouncementsPanel() {
  const view = useAnnouncements((s) => s.view);
  const error = useAnnouncements((s) => s.error);
  const networkOn = useNetwork((s) => s.status?.on ?? false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  useEffect(() => {
    const reload = () => {
      void window.drashti.messages.list().then(setTemplates);
    };
    reload();
    return window.drashti.library.onChanged((what) => {
      if (what === 'messages') reload();
    });
  }, []);
  return (
    <Dialog
      title="Announcements"
      subtitle="Sent from phones. Nothing goes on the screens until you approve it."
      placement="right"
      size="md"
      onClose={closeAnnouncements}
      closeLabel="Close announcements"
      bodyClassName="space-y-6"
      testId="announcements-panel"
    >
      {error && (
        <Notice tone="danger" onDismiss={() => useAnnouncements.setState({ error: null })}>
          {error}
        </Notice>
      )}
      {!networkOn && (
        <Notice tone="info">
          The network is off, so phones cannot send announcements. Turn it on, and make the poster, in Phones.
        </Notice>
      )}
      {view && (
        <>
          <section className="space-y-2">
            <SectionTitle>Waiting{view.waiting.length > 0 ? ` (${view.waiting.length})` : ''}</SectionTitle>
            {view.waiting.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing waiting. Announcements sent from phones appear here.
              </p>
            ) : (
              <ul className="space-y-2">
                {view.waiting.map((a) => (
                  <Waiting key={a.id} a={a} templates={templates} />
                ))}
              </ul>
            )}
          </section>
          {view.showing.length > 0 && (
            <section className="space-y-2">
              <SectionTitle>On the screens</SectionTitle>
              <ul className="space-y-2">
                {view.showing.map((a) => (
                  <Showing key={a.id} a={a} />
                ))}
              </ul>
            </section>
          )}
          {view.earlier.length > 0 && (
            <section className="space-y-1">
              <SectionTitle>Earlier</SectionTitle>
              <ul className="divide-y divide-line">
                {view.earlier.map((a) => (
                  <Earlier key={a.id} a={a} />
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-faint">
            The ticker scrolls along the bottom of the audience screens, in step on each. A message also goes
            on the stream; the ticker does not. Black-out and the logo cover both; Clear all takes them off,
            and Put it back brings them back while their time lasts.
          </p>
        </>
      )}
    </Dialog>
  );
}
