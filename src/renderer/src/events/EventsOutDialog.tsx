import { useEffect, useState } from 'react';
import {
  EVENT_KINDS,
  EVENT_NAMES,
  type EventAddressView,
  type EventKind,
  type EventsOutResult,
  type EventsOutView,
  WORDY_KINDS,
} from '../../../shared/events-out';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { Copy, Lock } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { useSavedSetting } from '../ui/saved-setting';
import { Checkbox } from '../ui/Toggle';
import { closeEventsOut, connectEventsOut, useEventsOut } from './events-store';

/*
 * File › Events Out… (Session 28, decision 20): the addresses Drashti tells what happens in the show, what
 * each gets, and how each stands. An admin's, in Pro Mode only. Nothing is sent until a kind is ticked;
 * words only where "Include the words" is ticked; a new secret is shown once, to copy into the receiver.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function StatusLine({ a, index }: { a: EventAddressView; index: number }) {
  const s = a.status;
  const lines: { text: string; tone: 'muted' | 'warning' }[] = [];
  if (a.off)
    lines.push({
      text: 'Off: it said this address is gone (410). Turn it on again once it is fixed.',
      tone: 'warning',
    });
  if (s.setupProblem)
    lines.push({
      text: 'Set up wrongly? The receiver refused the events (a 404, or another address given instead).',
      tone: 'warning',
    });
  if (s.lastSuccess)
    lines.push({
      text: `Last sent ${clock(s.lastSuccess.at)} (${String(s.lastSuccess.status)}).`,
      tone: 'muted',
    });
  if (s.lastFailure && (!s.lastSuccess || s.lastFailure.at > s.lastSuccess.at))
    lines.push({
      text: `Last failed ${clock(s.lastFailure.at)}: ${s.lastFailure.error ?? `the receiver answered ${String(s.lastFailure.status)}.`}`,
      tone: 'warning',
    });
  if (s.dropped > 0)
    lines.push({
      text: `${String(s.dropped)} ${s.dropped === 1 ? 'event' : 'events'} given up after half an hour of tries.`,
      tone: 'warning',
    });
  if (s.clockOffBy !== null)
    lines.push({
      text: `Its clock is ${String(Math.round(Math.abs(s.clockOffBy) / 60_000))} min off this computer’s: it may refuse signed events. Set both to the right time.`,
      tone: 'warning',
    });
  if (lines.length === 0) lines.push({ text: 'Nothing sent yet.', tone: 'muted' });
  return (
    <div data-testid={`events-status-${String(index)}`} className="space-y-0.5 text-xs">
      {lines.map((l) => (
        <p key={l.text} className={l.tone === 'warning' ? 'text-warning-fg' : 'text-muted'}>
          {l.text}
        </p>
      ))}
    </div>
  );
}

function Address({
  a,
  index,
  onResult,
}: {
  a: EventAddressView;
  index: number;
  onResult: (r: Promise<EventsOutResult> | EventsOutResult, note: string) => void;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  // What it gets, as ticked (Session 54): a second tick before the first is saved is made to the first.
  const update = (patch: { kinds: EventKind[] } | { words: EventKind[] }) => {
    const answer = window.drashti.events.update(a.id, patch);
    onResult(answer, '');
    return answer;
  };
  const [kindsTicked, setKinds] = useSavedSetting(`${a.id}:kinds`, a.kinds, (kinds) => update({ kinds }));
  const [wordsTicked, setWords] = useSavedSetting(`${a.id}:words`, a.words, (words) => update({ words }));
  const kinds = new Set(kindsTicked);
  const words = new Set(wordsTicked);
  const tick = (kind: EventKind, on: boolean) => {
    setKinds(on ? [...kinds, kind] : [...kinds].filter((k) => k !== kind));
  };
  const tickWords = (kind: EventKind, on: boolean) => {
    setWords(on ? [...words, kind] : [...words].filter((k) => k !== kind));
  };
  return (
    <li
      data-testid={`events-address-${String(index)}`}
      className="space-y-3 rounded-sm border border-line p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {a.secure && <Lock size={14} aria-label="https" />}
        <span className="font-medium" data-testid={`events-host-${String(index)}`}>
          {a.host}
        </span>
        {a.allowInternet && <Badge tone="warning">On the internet</Badge>}
        {a.off ? (
          <Badge tone="danger">Off</Badge>
        ) : kinds.size > 0 ? (
          <Badge tone="success">On</Badge>
        ) : (
          <Badge>Nothing ticked</Badge>
        )}
      </div>
      <StatusLine a={a} index={index} />
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-medium text-muted">It gets</legend>
        {EVENT_KINDS.map((kind) => (
          <div key={kind} className="flex flex-wrap items-center gap-x-4">
            <Checkbox
              label={EVENT_NAMES[kind]}
              checked={kinds.has(kind)}
              data-testid={`events-kind-${kind}-${String(index)}`}
              onChange={(e) => {
                tick(kind, e.currentTarget.checked);
              }}
            />
            {WORDY_KINDS.includes(kind) && kinds.has(kind) && (
              <Checkbox
                className="text-muted"
                label="Include the words"
                checked={words.has(kind)}
                data-testid={`events-words-${kind}-${String(index)}`}
                onChange={(e) => {
                  tickWords(kind, e.currentTarget.checked);
                }}
              />
            )}
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          data-testid={`events-test-${String(index)}`}
          disabled={testing === '…'}
          onClick={() => {
            setTesting('…');
            void window.drashti.events.test(a.id).then((r) => {
              setTesting(r.message);
            });
          }}
        >
          Send a test
        </Button>
        <Button
          size="sm"
          data-testid={`events-rotate-${String(index)}`}
          onClick={() => {
            onResult(
              window.drashti.events.rotate(a.id),
              'The old secret still signs too for a day, while the receiver changes over.',
            );
          }}
        >
          New secret
        </Button>
        {a.off && (
          <Button
            size="sm"
            data-testid={`events-on-${String(index)}`}
            onClick={() => {
              onResult(window.drashti.events.update(a.id, { on: true }), '');
            }}
          >
            Turn on again
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          className="ml-auto"
          data-testid={`events-remove-${String(index)}`}
          onClick={() => {
            onResult(window.drashti.events.remove(a.id), '');
          }}
        >
          Remove
        </Button>
      </div>
      {testing !== null && testing !== '…' && (
        <p className="text-sm" role="status" data-testid={`events-test-result-${String(index)}`}>
          {testing}
        </p>
      )}
    </li>
  );
}

export function EventsOutDialog() {
  const open = useEventsOut((s) => s.open);
  const view = useEventsOut((s) => s.view);
  useEffect(() => {
    connectEventsOut();
  }, []);
  if (!open || !view) return null;
  return <EventsOutForm view={view} />;
}

function EventsOutForm({ view }: { view: EventsOutView }) {
  const [url, setUrl] = useState('');
  const [internet, setInternet] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ value: string; note: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const take = (pending: Promise<EventsOutResult> | EventsOutResult, note: string) => {
    void Promise.resolve(pending).then((r) => {
      if (!r.ok) {
        setProblem(r.message);
        return;
      }
      setProblem(null);
      useEventsOut.setState({ view: r.view });
      if (r.secret) {
        setSecret({ value: r.secret, note });
        setCopied(false);
      }
    });
  };
  return (
    <Dialog
      title="Events out"
      size="lg"
      onClose={closeEventsOut}
      closeLabel="Close events out"
      testId="events-dialog"
      footer={<Button onClick={closeEventsOut}>Close</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Drashti can tell another program what happens in the show (n8n on this computer or this network,
          say) by a signed request to each address added here. Nothing is sent until you tick what an address
          gets, and then only ids and kinds, unless you tick Include the words.
        </p>
        {!view.available && view.message && <Notice tone="warning">{view.message}</Notice>}
        {secret && (
          <Notice tone="info" title="The secret, shown once" data-testid="events-secret">
            <p className="text-sm">
              Copy it into the receiver now: it checks each request with it. Drashti never shows it again.{' '}
              {secret.note}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code
                className="min-w-0 flex-1 truncate rounded-sm bg-panel-2 px-2 py-1 text-xs"
                data-testid="events-secret-value"
              >
                {secret.value}
              </code>
              <Button
                size="sm"
                data-testid="events-secret-copy"
                onClick={() => {
                  void navigator.clipboard.writeText(secret.value).then(() => {
                    setCopied(true);
                  });
                }}
              >
                <Copy size={14} aria-hidden="true" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSecret(null);
                }}
              >
                Done
              </Button>
            </div>
          </Notice>
        )}
        {problem && (
          <Notice tone="danger" data-testid="events-problem">
            {problem}
          </Notice>
        )}
        {view.addresses.length > 0 && (
          <ul className="space-y-3">
            {view.addresses.map((a, i) => (
              <Address key={a.id} a={a} index={i} onResult={take} />
            ))}
          </ul>
        )}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            take(window.drashti.events.add(url, internet), '');
            setUrl('');
          }}
        >
          <Field
            label="Add an address"
            hint="On this computer or this network, such as http://192.168.1.20:5678/webhook/drashti. An address on the internet must start https://."
          >
            <TextInput
              value={url}
              placeholder="http://"
              data-testid="events-url"
              onChange={(e) => {
                setUrl(e.currentTarget.value);
                setProblem(null);
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              label="It is on the internet (https only; one address at most)"
              checked={internet}
              data-testid="events-internet"
              onChange={(e) => {
                setInternet(e.currentTarget.checked);
              }}
            />
            <Button
              type="submit"
              variant="primary"
              className="ml-auto"
              data-testid="events-add"
              disabled={url.trim() === ''}
            >
              Add
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
