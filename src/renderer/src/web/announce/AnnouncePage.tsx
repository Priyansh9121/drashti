import { useCallback, useEffect, useState } from 'react';
import {
  ANNOUNCEMENT_FROM_MAX,
  ANNOUNCEMENT_MINUTES,
  ANNOUNCEMENT_TEXT_MAX,
  type AnnouncementStatusView,
} from '../../../../shared/announcements';
import type { DeviceKind } from '../../../../shared/network';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { api, current, PAGE_OF } from '../device';

/*
 * Sending an announcement from a phone (an Announcements device: paired, or
 * opened from the poster's link, whose key is in the address's #fragment
 * and never reaches a server). Nothing goes on the screens until the
 * operator approves it. The phone remembers what it sent, so the person can
 * see what became of it.
 *
 * The poster's key is kept apart from the phone's pairing: a phone paired
 * as a remote that scans the poster stays a remote.
 */

const FROM_KEY = 'drashti.announce.from';
const SENT_KEY = 'drashti.announce.sent';
const POSTER_KEY = 'drashti.announce.poster';
/** The phone keeps this many of its own, newest first. */
const KEEP = 5;
/** How often it asks what became of them, while any is waiting or showing. */
const ASK_EVERY_MS = 10_000;

interface Sent {
  id: string;
  text: string;
  sentAt: string;
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing without storage: kept for this page only.
  }
};

const forget = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing kept.
  }
};

/** The poster's key in the address (#k=...), taken out of it at once. */
function posterKey(): string | null {
  const match = /^#k=([A-Za-z0-9_-]{20,100})$/u.exec(location.hash);
  if (!match?.[1]) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return match[1];
}

/** Read once, as the page opens. */
const FROM_POSTER = posterKey();

type Start = 'checking' | 'ready' | 'poster-gone' | 'unreachable';

/** Whether Drashti still knows this key as an Announcements device (or cannot be asked now). */
async function known(token: string): Promise<'yes' | 'no' | 'unreachable'> {
  const r = await api<{ device: { kind: DeviceKind } }>('/api/v1/me', { token });
  if (r.ok) return r.device.kind === 'announcements' ? 'yes' : 'no';
  return r.status === 401 || r.status === 403 ? 'no' : 'unreachable';
}

/** The key this page sends with: the poster's, or this phone's own pairing when it is an Announcements device. */
let poster: string | null = null;
const token = (): string | undefined => poster ?? undefined;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function StatusBadge({ status }: { status: AnnouncementStatusView | undefined }) {
  if (!status) return <Badge tone="neutral">Sent</Badge>;
  switch (status.status) {
    case 'waiting':
      return <Badge tone="warning">Waiting for the operator</Badge>;
    case 'showing':
      return <Badge tone="live">On the screens{status.until ? ` until ${time(status.until)}` : ''}</Badge>;
    case 'ended':
      return <Badge tone="neutral">Shown</Badge>;
    case 'rejected':
      return <Badge tone="neutral">Not shown</Badge>;
  }
}

export function AnnouncePage() {
  const [start, setStart] = useState<Start>('checking');
  const [text, setText] = useState('');
  const [from, setFrom] = useState(() => read<string>(FROM_KEY, ''));
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>(() => read<Sent[]>(SENT_KEY, []));
  const [statuses, setStatuses] = useState<Record<string, AnnouncementStatusView>>({});

  useEffect(() => {
    void (async () => {
      // The poster just scanned, else one scanned before; a key that no longer works is forgotten.
      const stored = read<string | null>(POSTER_KEY, null);
      for (const key of [FROM_POSTER, stored]) {
        if (!key) continue;
        const answer = await known(key);
        if (answer === 'unreachable') {
          setStart('unreachable');
          return;
        }
        if (answer === 'yes') {
          poster = key;
          write(POSTER_KEY, key);
          setStart('ready');
          return;
        }
        if (key === stored) forget(POSTER_KEY);
      }
      const own = current();
      if (own?.kind === 'announcements') {
        setStart('ready');
        return;
      }
      if (FROM_POSTER || stored) {
        setStart('poster-gone');
        return;
      }
      location.replace(own ? PAGE_OF[own.kind] : '/pair');
    })();
  }, []);

  const ask = useCallback(async () => {
    const answers = await Promise.all(
      sent.map((s) =>
        api<{ announcement: AnnouncementStatusView }>(`/api/v1/announcements/${encodeURIComponent(s.id)}`, {
          token: token(),
        }),
      ),
    );
    const next: Record<string, AnnouncementStatusView> = {};
    for (const a of answers) if (a.ok) next[a.announcement.id] = a.announcement;
    setStatuses(next);
  }, [sent]);

  const open = sent.some((s) => {
    const st = statuses[s.id]?.status;
    return st === undefined || st === 'waiting' || st === 'showing';
  });
  useEffect(() => {
    if (start !== 'ready' || sent.length === 0) return;
    void Promise.resolve().then(ask);
    if (!open) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void ask();
    }, ASK_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [start, sent, open, ask]);

  const send = async () => {
    setProblem(null);
    setNotice(null);
    if (text.trim() === '') {
      setProblem('Write the announcement first.');
      return;
    }
    if (from.trim() === '') {
      setProblem('Say who it is from.');
      return;
    }
    setBusy(true);
    const r = await api<{ announcement: AnnouncementStatusView }>('/api/v1/announcements', {
      method: 'POST',
      body: { text, from, minutes },
      token: token(),
    });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401 && poster) setStart('poster-gone');
      else setProblem(r.message);
      return;
    }
    write(FROM_KEY, from.trim());
    const kept = [
      { id: r.announcement.id, text: text.trim(), sentAt: new Date().toISOString() },
      ...sent,
    ].slice(0, KEEP);
    write(SENT_KEY, kept);
    setSent(kept);
    setStatuses({ ...statuses, [r.announcement.id]: r.announcement });
    setText('');
    setNotice('Sent. It is waiting for the operator, who decides whether it goes on the screens.');
  };

  if (start === 'unreachable')
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col gap-6 px-5 py-8" data-testid="announce-page">
        <h1 className="text-2xl font-bold text-fg">Send an announcement</h1>
        <Notice tone="warning">
          Drashti cannot be reached. Check this phone is on the mandir’s Wi-Fi (not mobile data), then open
          the page again.
        </Notice>
      </main>
    );

  if (start === 'poster-gone')
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col gap-6 px-5 py-8" data-testid="announce-page">
        <h1 className="text-2xl font-bold text-fg">Send an announcement</h1>
        <Notice tone="warning">
          This poster’s link no longer works: the operator has made a new one. Ask at the desk for the new
          poster, or for a code to pair this phone.
        </Notice>
      </main>
    );

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-6 px-5 py-8" data-testid="announce-page">
      <header className="space-y-1">
        <p className="text-base font-bold tracking-wide text-muted">Drashti</p>
        <h1 className="text-2xl font-bold text-fg">Send an announcement</h1>
        <p className="text-base text-muted">
          The operator sees it first, and decides whether and how it goes on the screens.
        </p>
      </header>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="block space-y-2">
          <span className="block text-base text-fg">Announcement</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={ANNOUNCEMENT_TEXT_MAX}
            rows={4}
            data-testid="announce-text"
            aria-describedby="announce-count"
            className="w-full rounded-lg border border-field bg-panel-2 p-3 text-lg text-fg placeholder:text-faint"
          />
          <span id="announce-count" className="block text-right text-sm text-muted">
            {text.length} of {ANNOUNCEMENT_TEXT_MAX}
          </span>
        </label>
        <label className="block space-y-2">
          <span className="block text-base text-fg">From</span>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            maxLength={ANNOUNCEMENT_FROM_MAX}
            autoComplete="name"
            data-testid="announce-from"
            className="h-14 w-full rounded-lg border border-field bg-panel-2 px-3 text-lg text-fg"
          />
        </label>
        <label className="block space-y-2">
          <span className="block text-base text-fg">Show it for</span>
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            data-testid="announce-minutes"
            className="h-14 w-full rounded-lg border border-field bg-panel-2 px-3 text-lg text-fg"
          >
            {ANNOUNCEMENT_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m === 60 ? '1 hour' : `${m} minutes`}
              </option>
            ))}
          </select>
        </label>
        {problem && (
          <p className="text-base text-danger-fg" role="alert">
            {problem}
          </p>
        )}
        {notice && (
          <p className="text-base text-fg" role="status">
            {notice}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="xl"
          disabled={busy || start !== 'ready'}
          className="w-full"
          data-testid="announce-send"
        >
          {busy ? 'Sending…' : 'Send'}
        </Button>
      </form>
      {sent.length > 0 && (
        <section className="space-y-2" aria-labelledby="sent-title">
          <h2 id="sent-title" className="text-sm font-bold tracking-wider text-muted uppercase">
            What you sent
          </h2>
          <ul className="space-y-2">
            {sent.map((s) => (
              <li
                key={s.id}
                className="space-y-2 rounded-lg border border-line bg-panel-2 px-3 py-2"
                data-testid="announce-sent"
              >
                <p className="text-base break-words text-fg">{s.text}</p>
                <StatusBadge status={statuses[s.id]} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
