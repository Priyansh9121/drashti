import { useEffect, useState } from 'react';
import type { NodeInfo, NodePairingOffer } from '../../../shared/nodes';
import type { NodeDisplays, ScreenGroupConfig } from '../../../shared/screens';
import { connectNodes, nodesAction, useNodes } from '../nodes/nodes-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { Plus, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { DisplayRow } from './DisplayRow';
import { screensAction, useScreens } from './screens-store';

/*
 * Output nodes in Screens (Session 13): pairing one (a code and this
 * computer's address to type on the node), and each node with the displays
 * it reported, which go into screen groups like this computer's own.
 */

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);
  return Math.max(0, Math.round((until - now) / 1000));
}

function PairingCard({ pairing }: { pairing: NodePairingOffer }) {
  const left = useSecondsLeft(pairing.expiresAt);
  return (
    <div
      className="space-y-2 rounded-lg border border-accent/60 bg-panel px-4 py-3"
      data-testid="node-pairing"
    >
      <p className="text-sm">On the node, in its window, type Main’s address and this code:</p>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <div className="text-xs text-muted">Main’s address</div>
          <div className="font-mono text-lg" data-testid="node-pairing-address">
            {pairing.addresses[0] ?? 'this computer'}
            {pairing.port === 8741 ? '' : `:${pairing.port}`}
          </div>
          {pairing.addresses.length > 1 && (
            <div className="text-xs text-muted">or {pairing.addresses.slice(1).join(', ')}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted">Code</div>
          <div
            className="font-mono text-3xl font-bold tracking-widest"
            data-testid="node-pairing-code"
            data-a11y-picture
          >
            {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>
          Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more.
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void nodesAction(() => window.drashti.nodes.cancelPairing())}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  displays,
  groups,
}: {
  node: NodeInfo;
  displays: NodeDisplays | undefined;
  groups: ScreenGroupConfig[];
}) {
  const [removing, setRemoving] = useState(false);
  const snapshot = useScreens((s) => s.snapshot);
  const mine = (snapshot?.groups ?? []).flatMap((g) => g.screens).filter((sc) => sc.nodeId === node.id);
  const usedBy = (displayId: number) =>
    mine.find(
      (sc) =>
        snapshot?.status.find((st) => st.screenId === sc.id)?.displayId === displayId ||
        sc.displayKey?.id === displayId,
    )?.name ?? null;
  return (
    <li
      className="space-y-2 rounded-xl border border-line bg-panel-2 p-3"
      data-testid="node-card"
      data-node={node.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{node.name}</span>
        <Badge tone={node.online ? 'success' : 'warning'} data-testid="node-online">
          {node.online ? 'Online' : 'Offline'}
        </Badge>
        {node.since && (
          <span className="text-xs text-muted">
            {node.online ? 'since' : 'since'} {timeOf(node.since)}
          </span>
        )}
        <span className="flex-1" />
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          onClick={() => {
            setRemoving(true);
          }}
        >
          Remove
        </Button>
      </div>
      {node.versionRefused && (
        <Notice tone="danger" compact data-testid="node-version-refused">
          This node runs Drashti {node.versionRefused}, and this computer runs{' '}
          {useNodes.getState().status?.main.version}. Install the same version on both: until then it is
          refused.
        </Notice>
      )}
      {!displays || displays.displays.length === 0 ? (
        <p className="text-xs text-muted">
          {node.online ? 'It has reported no displays yet.' : 'Its displays show here once it has connected.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {displays.displays.map((d) => (
            <DisplayRow
              key={d.id}
              display={d}
              usedBy={usedBy(d.id)}
              groups={groups}
              onUse={(groupId) => {
                void screensAction(() => window.drashti.screens.assignNodeDisplay(groupId, node.id, d.id));
              }}
            />
          ))}
        </ul>
      )}
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
          testId="node-remove-confirm"
        >
          <p>
            It is cut off at once: its screens go black and its screens here are removed. To use it again,
            pair it again with a new code.
          </p>
        </ConfirmDialog>
      )}
    </li>
  );
}

export function NodesSection({ groups }: { groups: ScreenGroupConfig[] }) {
  const status = useNodes((s) => s.status);
  const error = useNodes((s) => s.error);
  const snapshot = useScreens((s) => s.snapshot);
  useEffect(() => {
    connectNodes();
  }, []);
  return (
    <section className="space-y-2" data-testid="nodes-section">
      <div className="flex items-center gap-2">
        <SectionTitle className="flex-1">Nodes (other computers)</SectionTitle>
        <Button
          icon={Plus}
          data-testid="pair-node"
          onClick={() => void nodesAction(() => window.drashti.nodes.startPairing())}
        >
          Pair a node
        </Button>
      </div>
      <p className="text-xs text-muted">
        A node is another computer on this network running Drashti as a Node: it shows screens on its own
        displays, following this computer, with its own copies of the pictures and videos.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      {status?.message && <Notice tone="warning">{status.message}</Notice>}
      {status?.pairing && <PairingCard pairing={status.pairing} />}
      {status && status.nodes.length > 0 && (
        <ul className="space-y-2">
          {status.nodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              displays={snapshot?.nodes.find((x) => x.id === n.id)}
              groups={groups}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
