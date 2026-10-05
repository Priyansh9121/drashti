import { useEffect, useState } from 'react';
import { formatBytes } from '../../../shared/format';
import { type LinkState, type NodeView, shortFingerprint } from '../../../shared/nodes';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { Monitor, ScanEye, Tv } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Progress } from '../ui/Progress';
import { Loading } from '../ui/States';

/*
 * A node's own window (Session 13): which Main it follows and how the link
 * stands, its displays and what each shows, its copies of Main's media, and
 * its clock against Main's. It has no show controls: Main runs the show, and
 * assigns this node's displays in its Screens.
 */

const LINK_TEXT: Record<LinkState, string> = {
  connecting: 'Connecting…',
  online: 'Online',
  offline: 'Offline',
  refused: 'Refused',
  unpaired: 'Not paired',
};

const LINK_TONE: Record<LinkState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  connecting: 'neutral',
  online: 'success',
  offline: 'warning',
  refused: 'danger',
  unpaired: 'neutral',
};

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Refused for its version (Session 14): update this node to Main's version.
 * It downloads that version's installer from the releases, then Quit and
 * install: the node quits, the installer runs, and the node is started
 * again by hand (Drashti never starts itself again).
 */
function MatchMain({ view }: { view: NodeView }) {
  const [problem, setProblem] = useState<string | null>(null);
  const u = view.update;
  const version = view.mainVersion;
  if (!version) return null;
  const act = (run: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setProblem(null);
    void run().then((r) => {
      if (!r.ok) setProblem(r.message);
    });
  };
  const offered = u.offer?.version === version;
  return (
    <section className="space-y-2 rounded-lg border border-line p-3" data-testid="node-update">
      <SectionTitle>Update this node</SectionTitle>
      <p className="text-sm">
        Main runs Drashti <strong>{version}</strong>; this node runs {view.version}. They must match.
      </p>
      {(!offered || u.phase === 'error' || u.phase === 'idle') && u.phase !== 'checking' && (
        <Button
          variant="primary"
          data-testid="node-update-check"
          onClick={() => act(() => window.drashti.node.updateCheck())}
        >
          Update to Drashti {version}
        </Button>
      )}
      {u.phase === 'checking' && <Loading label="Looking for it…" />}
      {offered && u.phase === 'available' && (
        <Button
          variant="primary"
          data-testid="node-update-download"
          onClick={() => act(() => window.drashti.node.updateDownload())}
        >
          Download Drashti {version}
          {u.offer && u.offer.size > 0 ? ` (${formatBytes(u.offer.size)})` : ''}
        </Button>
      )}
      {u.phase === 'downloading' && u.progress && (
        <Progress
          value={u.progress.total > 0 ? u.progress.done / u.progress.total : 0}
          label="Downloading the update"
        />
      )}
      {offered && u.phase === 'ready' && u.install === 'at-quit' && (
        <div className="space-y-1">
          <p className="text-sm">
            Downloaded and checked. Quitting this node installs it; then start Drashti again here.
          </p>
          <Button
            variant="primary"
            data-testid="node-update-install"
            onClick={() => act(() => window.drashti.node.updateInstall())}
          >
            Quit and install
          </Button>
        </div>
      )}
      {offered && u.phase === 'ready' && u.install === 'by-hand' && (
        <Notice tone="info">
          This copy of Drashti is not signed, so the Mac cannot install it by itself: quit Drashti, open the
          downloaded file and drag Drashti into Applications.
          <Button size="sm" className="mt-2" onClick={() => void window.drashti.node.updateShowFile()}>
            Show the file
          </Button>
        </Notice>
      )}
      {(problem ?? u.message) && (
        <p role="alert" className="text-sm text-warning-fg">
          {problem ?? u.message}
        </p>
      )}
    </section>
  );
}

function PairForm({ onPaired }: { onPaired: (view: NodeView) => void }) {
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="node-pair-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void window.drashti.node.pair(address, code).then((r) => {
          setBusy(false);
          if (r.ok) onPaired(r.view);
          else setError(r.message);
        });
      }}
    >
      <p className="text-sm text-muted">
        On Main, open <strong className="text-fg">Screens</strong>, then{' '}
        <strong className="text-fg">Pair a node</strong>. It shows its address and a code for two minutes:
        type both here.
      </p>
      <div className="flex flex-wrap gap-3">
        <Field
          label="Main’s address"
          className="min-w-56 flex-1"
          hint="For example 192.168.1.20, or the name Main shows."
        >
          <TextInput
            value={address}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setAddress(e.target.value);
            }}
          />
        </Field>
        <Field label="Code" className="w-36">
          <TextInput
            value={code}
            inputMode="numeric"
            autoComplete="off"
            maxLength={7}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
        </Field>
      </div>
      {error && (
        <Notice tone="danger" data-testid="node-pair-error">
          {error}
        </Notice>
      )}
      <Button variant="primary" type="submit" disabled={busy || address.trim() === '' || code.trim() === ''}>
        {busy ? 'Pairing…' : 'Pair with Main'}
      </Button>
    </form>
  );
}

function MainSection({ view, setView }: { view: NodeView; setView: (v: NodeView) => void }) {
  const [confirm, setConfirm] = useState<'unpair' | 'main' | null>(null);
  const paired = view.paired;
  if (!paired)
    return (
      <section
        className="space-y-3 rounded-xl border border-line bg-panel-2 p-4"
        aria-labelledby="node-main-title"
      >
        <SectionTitle>
          <span id="node-main-title">Main</span>
        </SectionTitle>
        {view.link.why && <Notice tone="warning">{view.link.why}</Notice>}
        <PairForm onPaired={setView} />
        <div className="border-t border-line pt-3">
          <Button
            variant="ghost"
            onClick={() => {
              setConfirm('main');
            }}
          >
            Use this computer as Main…
          </Button>
        </div>
        {confirm === 'main' && <UseAsMain onCancel={() => setConfirm(null)} />}
      </section>
    );
  const link = view.link;
  return (
    <section
      className="space-y-3 rounded-xl border border-line bg-panel-2 p-4"
      aria-labelledby="node-main-title"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle className="flex-1">
          <span id="node-main-title">Main</span>
        </SectionTitle>
        <Badge tone={LINK_TONE[link.state]} data-testid="node-link-state">
          {LINK_TEXT[link.state]}
        </Badge>
      </div>
      <p className="text-base" data-testid="node-main-name">
        Follows <strong>{paired.main.name}</strong>
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Address</dt>
        <dd>
          {paired.main.addresses.join(', ')}
          {paired.main.port === 8741 ? '' : ` (port ${paired.main.port})`}
        </dd>
        <dt className="text-muted">Certificate</dt>
        <dd className="font-mono" title="Main’s certificate, as this node pinned it when it paired">
          {shortFingerprint(paired.main.fingerprint)}
        </dd>
        <dt className="text-muted">{link.state === 'online' ? 'Online since' : 'Since'}</dt>
        <dd>{timeOf(link.since)}</dd>
        {view.clock && (
          <>
            <dt className="text-muted">Clock</dt>
            <dd data-testid="node-clock">
              {Math.abs(view.clock.offsetMs) < 1
                ? 'in step with Main'
                : `${Math.abs(Math.round(view.clock.offsetMs))} ms ${view.clock.offsetMs > 0 ? 'behind' : 'ahead of'} Main, corrected`}
              {` (round trip ${view.clock.rttMs.toFixed(1)} ms)`}
            </dd>
          </>
        )}
      </dl>
      {link.why && link.state !== 'online' && (
        <Notice tone={link.state === 'refused' ? 'danger' : 'warning'} data-testid="node-link-why">
          {link.why}
        </Notice>
      )}
      {view.fromSaved && (
        <Notice tone="info" data-testid="node-from-saved">
          Showing the last picture this node kept: Main has not been reached since it started.
        </Notice>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button
          variant="danger"
          onClick={() => {
            setConfirm('unpair');
          }}
        >
          Unpair…
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setConfirm('main');
          }}
        >
          Use this computer as Main…
        </Button>
      </div>
      {confirm === 'unpair' && (
        <ConfirmDialog
          title="Unpair this node?"
          confirmLabel="Unpair"
          onCancel={() => {
            setConfirm(null);
          }}
          onConfirm={() => {
            setConfirm(null);
            void window.drashti.node.unpair().then((r) => {
              if (r.ok) setView(r.view);
            });
          }}
          testId="node-unpair-confirm"
        >
          <p>
            This node stops following “{paired.main.name}”, and its screens go black. To use it again, pair it
            with a new code from Main. On Main, remove it from Screens too.
          </p>
        </ConfirmDialog>
      )}
      {confirm === 'main' && <UseAsMain onCancel={() => setConfirm(null)} />}
    </section>
  );
}

function UseAsMain({ onCancel }: { onCancel: () => void }) {
  return (
    <ConfirmDialog
      title="Use this computer as Main?"
      confirmLabel="Restart as Main"
      confirmVariant="primary"
      onCancel={onCancel}
      onConfirm={() => {
        void window.drashti.node.useAsMain();
      }}
      testId="node-use-as-main-confirm"
    >
      <p>
        Drashti restarts as Main: the library, the playlists and the controls. Its screens go black while it
        restarts. To be a node again, choose File, then Use This Computer as a Node.
      </p>
    </ConfirmDialog>
  );
}

function Displays({ view }: { view: NodeView }) {
  return (
    <section className="space-y-2" aria-labelledby="node-displays-title">
      <div className="flex items-center gap-2">
        <SectionTitle className="flex-1">
          <span id="node-displays-title">Displays</span>
        </SectionTitle>
        <Button icon={ScanEye} onClick={() => void window.drashti.node.identify()}>
          Show display numbers
        </Button>
      </div>
      <p className="text-xs text-muted">
        Main chooses what each display shows, in its Screens. Drashti never changes a display’s resolution.
      </p>
      <ul className="space-y-2">
        {view.displays.map((d, i) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2"
            data-testid="node-display"
          >
            <Monitor size={18} aria-hidden="true" className="shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {i + 1}. {d.label || `Display ${i + 1}`}
              </div>
              <div className="text-xs text-muted">
                {d.pixelWidth} × {d.pixelHeight} · {Math.round(d.refreshHz)} Hz
              </div>
            </div>
            {d.screen ? (
              <span className="flex items-center gap-2 text-sm">
                <Tv size={14} aria-hidden="true" />
                {d.screen.name} ({d.screen.groupName})
                <Badge tone={d.screen.showing ? 'success' : 'warning'}>
                  {d.screen.showing ? 'Showing' : 'Waiting'}
                </Badge>
              </span>
            ) : (
              <span className="text-xs text-muted">Not used</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Media({ view }: { view: NodeView }) {
  const m = view.media;
  const fraction = m.bytesWanted > 0 ? m.bytesReady / m.bytesWanted : 1;
  return (
    <section className="space-y-2" aria-labelledby="node-media-title" data-testid="node-media">
      <SectionTitle>
        <span id="node-media-title">Media</span>
      </SectionTitle>
      <p className="text-sm">
        {m.wanted === 0
          ? 'Main has not asked for any pictures or videos yet.'
          : `${m.ready} of ${m.wanted} files ready (${formatBytes(m.bytesReady)} of ${formatBytes(m.bytesWanted)}).`}
      </p>
      {m.wanted > 0 && <Progress value={fraction} label="Media copied" />}
      {m.copying && (
        <p className="text-xs text-muted">
          Copying a file: {formatBytes(m.copying.done)} of {formatBytes(m.copying.bytes)}.
        </p>
      )}
      {m.missingNow > 0 && (
        <Notice tone="warning" compact>
          {m.missingNow === 1
            ? 'A picture or video on the screens is'
            : `${m.missingNow} pictures or videos on the screens are`}{' '}
          still being copied: it shows as soon as it arrives.
        </Notice>
      )}
      {m.problem && (
        <Notice tone="danger" compact>
          {m.problem}
        </Notice>
      )}
    </section>
  );
}

export function NodeApp() {
  const [view, setView] = useState<NodeView | null>(null);
  useEffect(() => {
    const off = window.drashti.node.onChanged(setView);
    void window.drashti.node.view().then(setView);
    return off;
  }, []);
  if (!view) return <Loading label="Starting…" />;
  return (
    <main
      className="mx-auto h-full max-w-3xl space-y-5 overflow-y-auto bg-bg p-5 text-fg"
      data-testid="node-window"
    >
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-xl font-bold">Drashti Node</h1>
        <span className="text-sm text-muted">
          {view.host} · Drashti {view.version}
        </span>
      </header>
      <p className="text-sm text-muted">
        This computer shows screens for a Main on the local network. It has no show controls and makes no
        sound.
      </p>
      <MainSection view={view} setView={setView} />
      <MatchMain view={view} />
      <Displays view={view} />
      <Media view={view} />
    </main>
  );
}
