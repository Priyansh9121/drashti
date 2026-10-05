import { useEffect, useState } from 'react';
import { formatBytes } from '../../../shared/format';
import {
  type NodeInfo,
  type NodeOutputStatus,
  nodeWarnings,
  shortFingerprint,
  STEP_ROUND_TRIP_MS,
} from '../../../shared/nodes';
import type { DisplayInfo, ScreenConfig, ScreenState } from '../../../shared/screens';
import { useNow } from '../render/useNow';
import { connectScreens, screensAction, useScreens } from '../screens/screens-store';
import { Badge, type BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Field';
import { Monitor, RotateCw, ScanEye, Settings, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Checkbox } from '../ui/Toggle';
import { closeDashboard, connectNodes, nodesAction, useNodes } from './nodes-store';

/*
 * The screens dashboard (PLAN.md 4.1, Session 13): every display, on this
 * computer and on its nodes, with a picture of what it really shows (taken
 * every few seconds while the dashboard is open), and how it stands: online
 * or offline and since when, latency, the clock, media copies, late frames
 * and the version. Identify works in both modes; Simple Mode changes
 * nothing (the main process refuses it too).
 */

const STATE: Record<ScreenState, { text: string; tone: BadgeTone }> = {
  showing: { text: 'Showing', tone: 'success' },
  'missing-display': { text: 'Display not connected', tone: 'warning' },
  unassigned: { text: 'No display', tone: 'neutral' },
  disabled: { text: 'Off', tone: 'neutral' },
  'node-offline': { text: 'Node offline', tone: 'warning' },
};

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

function Rename({ name, label, onSave }: { name: string; label: string; onSave: (name: string) => void }) {
  const [text, setText] = useState(name);
  const [shown, setShown] = useState(name);
  if (shown !== name) {
    setShown(name);
    setText(name);
  }
  return (
    <TextInput
      aria-label={label}
      className="min-w-32 flex-1 border-transparent bg-transparent font-medium hover:border-field focus:border-accent"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
      }}
      onBlur={() => {
        if (text.trim() && text !== name) onSave(text.trim());
        else setText(name);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

interface DisplayCardProps {
  display: DisplayInfo;
  number: number;
  screen: ScreenConfig | null;
  state: ScreenState | null;
  output: NodeOutputStatus | null;
  thumb: string | null;
  nodeId: string | null;
  simple: boolean;
}

function DisplayCard({ display, number, screen, state, output, thumb, nodeId, simple }: DisplayCardProps) {
  const [removing, setRemoving] = useState(false);
  const shown = state ? STATE[state] : null;
  const name = screen?.name ?? (display.label || `Display ${number}`);
  return (
    <li
      className="flex flex-col overflow-hidden rounded-lg border border-line bg-panel-2"
      data-testid="dashboard-display"
      data-screen={screen?.id ?? ''}
      data-node={nodeId ?? 'main'}
    >
      <div className="relative aspect-video w-full bg-black" data-a11y-picture>
        {thumb ? (
          <img
            src={thumb}
            alt={`What ${name} shows now`}
            className="h-full w-full object-contain"
            data-testid="dashboard-thumb"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-faint">
            {screen ? (state === 'showing' ? 'Picture coming…' : 'No picture') : 'Not used'}
          </div>
        )}
        <span className="absolute top-1 left-1 rounded-sm bg-black/70 px-1.5 text-xs font-bold text-white">
          {number}
        </span>
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center gap-2">
          {screen && !simple ? (
            <Rename
              name={screen.name}
              label={`Name of ${screen.name}`}
              onSave={(n) =>
                void screensAction(() => window.drashti.screens.updateScreen(screen.id, { name: n }))
              }
            />
          ) : (
            <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          )}
          {shown && (
            <Badge tone={shown.tone} data-testid="dashboard-state">
              {shown.text}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted">
          {display.label || `Display ${number}`} · {display.pixelWidth} × {display.pixelHeight} ·{' '}
          {Math.round(display.refreshHz)} Hz
        </div>
        {output && state === 'showing' && (
          <div className="text-xs text-muted" data-testid="dashboard-frames">
            {output.droppedFrames === 0
              ? 'No late frames in the last minute'
              : `${output.droppedFrames} late ${output.droppedFrames === 1 ? 'frame' : 'frames'} in the last minute`}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button
            size="sm"
            icon={ScanEye}
            onClick={() => void window.drashti.nodes.identify(nodeId, display.id)}
            aria-label={`Identify ${name}`}
          >
            Identify
          </Button>
          {!simple && screen && state === 'showing' && (
            <Button
              size="sm"
              icon={RotateCw}
              onClick={() => void nodesAction(() => window.drashti.nodes.reload(nodeId, screen.id))}
              aria-label={`Reload ${name}`}
            >
              Reload
            </Button>
          )}
          {!simple && screen && (
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              onClick={() => {
                setRemoving(true);
              }}
              aria-label={`Remove ${name}`}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      {removing && screen && (
        <ConfirmDialog
          title={`Remove ${screen.name}?`}
          confirmLabel="Remove"
          onCancel={() => {
            setRemoving(false);
          }}
          onConfirm={() => {
            setRemoving(false);
            void screensAction(() => window.drashti.screens.removeScreen(screen.id));
          }}
          testId="dashboard-remove-screen"
        >
          <p>Its output closes and the display is no longer used. Screens can give it a group again.</p>
        </ConfirmDialog>
      )}
    </li>
  );
}

/** Each display of one computer, with the screen it shows (if any). */
function DisplayGrid({
  displays,
  nodeId,
  outputs,
  simple,
}: {
  displays: DisplayInfo[];
  nodeId: string | null;
  outputs: NodeOutputStatus[];
  simple: boolean;
}) {
  const snapshot = useScreens((s) => s.snapshot);
  const thumbs = useNodes((s) => s.thumbs);
  const screens = (snapshot?.groups ?? []).flatMap((g) => g.screens).filter((sc) => sc.nodeId === nodeId);
  if (displays.length === 0) return <p className="text-sm text-muted">No displays reported yet.</p>;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
      {displays.map((d, i) => {
        const status = snapshot?.status.find(
          (st) => st.displayId === d.id && screens.some((sc) => sc.id === st.screenId),
        );
        const screen =
          screens.find((sc) => sc.id === status?.screenId) ??
          screens.find((sc) => sc.displayKey?.id === d.id) ??
          null;
        const state = screen
          ? (snapshot?.status.find((st) => st.screenId === screen.id)?.state ?? null)
          : null;
        return (
          <DisplayCard
            key={d.id}
            display={d}
            number={i + 1}
            screen={screen}
            state={state}
            output={screen ? (outputs.find((o) => o.screenId === screen.id) ?? null) : null}
            thumb={screen ? (thumbs[screen.id]?.url ?? null) : null}
            nodeId={nodeId}
            simple={simple}
          />
        );
      })}
    </ul>
  );
}

function NodeFacts({ node }: { node: NodeInfo }) {
  const h = node.health;
  const media = h?.media;
  const clock = h?.clock;
  return (
    <dl
      className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-xs sm:grid-cols-[max-content_1fr_max-content_1fr]"
      data-testid="node-facts"
    >
      <dt className="text-muted">{node.online ? 'Online since' : 'Offline since'}</dt>
      <dd>{timeOf(node.since) || '–'}</dd>
      <dt className="text-muted">Latency</dt>
      <dd data-testid="node-latency">
        {node.online && node.latencyMs !== null ? `${node.latencyMs} ms round trip` : '–'}
      </dd>
      <dt className="text-muted">Clock</dt>
      <dd data-testid="node-clock-offset">
        {clock
          ? `${Math.abs(Math.round(clock.offsetMs))} ms off Main’s, corrected${clock.rttMs > STEP_ROUND_TRIP_MS ? ' (loosely)' : ''}`
          : '–'}
      </dd>
      <dt className="text-muted">Media</dt>
      <dd data-testid="node-media">
        {media
          ? media.wanted === 0
            ? 'Nothing to copy'
            : `${media.ready} of ${media.wanted} ready (${formatBytes(media.bytesReady)} of ${formatBytes(media.bytesWanted)})`
          : '–'}
      </dd>
      <dt className="text-muted">Version</dt>
      <dd data-testid="node-version">
        {node.versionRefused
          ? `${node.versionRefused} (needs updating to ${useNodes.getState().status?.main.version ?? 'Main’s'})`
          : (h?.version ?? '–')}
      </dd>
      <dt className="text-muted">Address</dt>
      <dd>{node.address ?? '–'}</dd>
    </dl>
  );
}

function NodeSection({ node, simple }: { node: NodeInfo; simple: boolean }) {
  const [removing, setRemoving] = useState(false);
  const snapshot = useScreens((s) => s.snapshot);
  const displays = node.health?.displays ?? snapshot?.nodes.find((n) => n.id === node.id)?.displays ?? [];
  return (
    <section className="space-y-3 rounded-xl border border-line bg-panel p-3" data-testid="dashboard-node">
      <div className="flex flex-wrap items-center gap-2">
        {simple ? (
          <h3 className="font-bold">{node.name}</h3>
        ) : (
          <Rename
            name={node.name}
            label={`Name of the node ${node.name}`}
            onSave={(n) => void nodesAction(() => window.drashti.nodes.rename(node.id, n))}
          />
        )}
        <Badge tone={node.online ? 'success' : 'warning'} data-testid="dashboard-node-online">
          {node.online ? 'Online' : 'Offline'}
        </Badge>
        <span className="flex-1" />
        <Button
          size="sm"
          icon={ScanEye}
          onClick={() => void window.drashti.nodes.identify(node.id, null)}
          aria-label={`Identify every display of ${node.name}`}
        >
          Identify all
        </Button>
        {!simple && (
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            onClick={() => {
              setRemoving(true);
            }}
            aria-label={`Remove the node ${node.name}`}
          >
            Remove
          </Button>
        )}
      </div>
      <NodeFacts node={node} />
      {node.health?.media.copying && (
        <p className="text-xs text-muted">
          Copying a file: {formatBytes(node.health.media.copying.done)} of{' '}
          {formatBytes(node.health.media.copying.bytes)}.
        </p>
      )}
      {!simple && (
        <Checkbox
          label="Get everything ready: copy every picture and video in the library, not only this week’s"
          checked={node.everything}
          onChange={(e) => void nodesAction(() => window.drashti.nodes.everything(node.id, e.target.checked))}
        />
      )}
      <DisplayGrid
        displays={displays}
        nodeId={node.id}
        outputs={node.health?.outputs ?? []}
        simple={simple}
      />
      {removing && (
        <ConfirmDialog
          title={`Remove ${node.name}?`}
          confirmLabel="Remove"
          onCancel={() => {
            setRemoving(false);
          }}
          onConfirm={() => {
            setRemoving(false);
            void nodesAction(() => window.drashti.nodes.remove(node.id));
          }}
          testId="dashboard-remove-node"
        >
          <p>
            It is cut off at once: its screens go black and its screens here are removed. To use it again,
            pair it again with a new code.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

export function ScreensDashboard({ simple, onSetUp }: { simple: boolean; onSetUp: (() => void) | null }) {
  const status = useNodes((s) => s.status);
  const error = useNodes((s) => s.error);
  const snapshot = useScreens((s) => s.snapshot);
  const now = useNow(2000);
  useEffect(() => {
    connectNodes();
    connectScreens();
    // Pictures of every screen while the dashboard is open.
    void window.drashti.nodes.watch(true);
    return () => {
      void window.drashti.nodes.watch(false);
    };
  }, []);
  const warnings = status ? nodeWarnings(status.nodes, now) : [];
  return (
    <Dialog
      title="Screens dashboard"
      subtitle="Every display, on this computer and its nodes: what it shows now, and how it stands."
      placement="right"
      size="xl"
      onClose={closeDashboard}
      closeLabel="Close the dashboard"
      testId="screens-dashboard"
      bodyClassName="space-y-5"
      headerActions={
        onSetUp && (
          <Button icon={Settings} onClick={onSetUp}>
            Set up screens…
          </Button>
        )
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {warnings.length > 0 && (
        <Notice tone="warning" title="Needs a look" data-testid="dashboard-warnings">
          <ul className="list-disc pl-4">
            {warnings.map((w) => (
              <li key={`${w.nodeId}-${w.kind}`}>{w.text}</li>
            ))}
          </ul>
        </Notice>
      )}
      <section className="space-y-3" data-testid="dashboard-main">
        <div className="flex flex-wrap items-center gap-2">
          <Monitor size={16} aria-hidden="true" className="text-muted" />
          <SectionTitle className="flex-1">This computer (Main)</SectionTitle>
          <span className="text-xs text-muted">
            Drashti {status?.main.version ?? ''}
            {status?.fingerprint ? ` · certificate ${shortFingerprint(status.fingerprint)}` : ''}
          </span>
          <Button
            size="sm"
            icon={ScanEye}
            onClick={() => void window.drashti.nodes.identify(null, null)}
            aria-label="Identify every display of this computer"
          >
            Identify all
          </Button>
        </div>
        <DisplayGrid
          displays={snapshot?.displays ?? []}
          nodeId={null}
          outputs={status?.main.outputs ?? []}
          simple={simple}
        />
      </section>
      {(status?.nodes ?? []).map((n) => (
        <NodeSection key={n.id} node={n} simple={simple} />
      ))}
      {status?.nodes.length === 0 && (
        <p className="text-sm text-muted">
          No nodes are paired. {simple ? '' : 'Screens, then Pair a node, adds another computer’s displays.'}
        </p>
      )}
    </Dialog>
  );
}
