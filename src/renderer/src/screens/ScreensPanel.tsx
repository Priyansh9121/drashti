import { useEffect, useState } from 'react';
import type {
  DisplayInfo,
  NodeDisplays,
  ScreenConfig,
  ScreenGroupConfig,
  ScreenState,
  ScalingMode,
} from '../../../shared/screens';
import { shortcutText } from '../../../shared/keymap';
import { CANVAS_PRESETS, SCALING_MODES } from '../../../shared/screens';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { Monitor, Plus, ScanEye, Trash2, Wand2 } from '../ui/icons';
import { openSetup } from '../setup/setup-store';
import { Kbd } from '../ui/Kbd';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { EmptyState, Loading } from '../ui/States';
import { Checkbox } from '../ui/Toggle';
import { cancelCover, connectScreens, screensAction, useScreens } from './screens-store';
import type { LookInfo } from '../../../shared/looks';
import { useEngine } from '../engine/engine-store';
import { connectLooks, useLooks } from '../looks/looks-store';
import { GroupLookSettings, LooksSection } from './LookSettings';
import { connectStageLayouts } from '../stage/stage-layouts-store';
import { connectMasks } from '../masks/masks-store';
import { SoundOutput } from './SoundOutput';
import { StreamGroupCard } from './StreamGroupCard';
import { NodesSection } from './NodesSection';
import { DisplayRow } from './DisplayRow';

const stateText: Record<ScreenState, string> = {
  showing: 'Showing',
  'missing-display': 'Display not connected',
  unassigned: 'No display',
  disabled: 'Off',
  'node-offline': 'Node offline',
};
const stateTone: Record<ScreenState, string> = {
  showing: 'border-success/60 bg-success-bg text-success-fg',
  'missing-display': 'border-warning/60 bg-warning-bg text-warning-fg',
  unassigned: 'border-line-strong bg-panel-2 text-muted',
  disabled: 'border-line-strong bg-panel-2 text-muted',
  'node-offline': 'border-warning/60 bg-warning-bg text-warning-fg',
};

const bridge = () => window.drashti.screens;

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  // Follow changes that come from the main process (adjusting state while rendering, as React recommends).
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 16 && n <= 16384 && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <TextInput
        className="w-20 tabular-nums"
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

function ScreenRow({
  screen,
  state,
  displays,
}: {
  screen: ScreenConfig;
  state: ScreenState;
  displays: DisplayInfo[];
}) {
  const update = (patch: Parameters<ReturnType<typeof bridge>['updateScreen']>[1]) =>
    void screensAction((consent) => bridge().updateScreen(screen.id, patch, consent));
  const preset = CANVAS_PRESETS.find(
    (p) => p.width === screen.canvasWidth && p.height === screen.canvasHeight,
  );
  const shownOn = displays.find((d) => d.key.id === screen.displayKey?.id);
  const node = useScreens((s) =>
    screen.nodeId ? s.snapshot?.nodes.find((n) => n.id === screen.nodeId) : undefined,
  );
  return (
    <li className="space-y-2 rounded-lg border border-line bg-panel px-3 py-2.5" data-testid="screen-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{screen.name}</span>
        <span
          className={cx('rounded-full border px-2 py-0.5 text-xs font-medium', stateTone[state])}
          data-testid="screen-state"
        >
          {stateText[state]}
          {state === 'showing' && shownOn ? ` on ${shownOn.label || `display ${shownOn.id}`}` : ''}
          {node ? ` · ${node.name}` : ''}
        </span>
        {state === 'missing-display' && (
          <span className="text-xs text-warning-fg">It opens by itself when the display is connected.</span>
        )}
        <span className="flex-1" />
        {screen.feed !== null && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Sends
            <Select
              aria-label={`What ${screen.name} sends`}
              data-testid="screen-feed"
              value={screen.feed}
              onChange={(e) => {
                update({ feed: e.target.value === 'key' ? 'key' : 'fill' });
              }}
            >
              <option value="fill">The fill (the picture)</option>
              <option value="key">The key (white where the fill has something)</option>
            </Select>
          </label>
        )}
        <Checkbox
          label="On"
          checked={screen.enabled}
          onChange={(e) => {
            update({ enabled: e.target.checked });
          }}
        />
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          onClick={() => void screensAction(() => bridge().removeScreen(screen.id))}
        >
          Remove
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <NumberField
          label="Canvas width"
          value={screen.canvasWidth}
          onCommit={(canvasWidth) => {
            update({ canvasWidth });
          }}
        />
        <NumberField
          label="height"
          value={screen.canvasHeight}
          onCommit={(canvasHeight) => {
            update({ canvasHeight });
          }}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Preset
          <Select
            value={preset ? preset.label : 'custom'}
            onChange={(e) => {
              const p = CANVAS_PRESETS.find((x) => x.label === e.target.value);
              if (p) update({ canvasWidth: p.width, canvasHeight: p.height });
            }}
          >
            {!preset && <option value="custom">Custom</option>}
            {CANVAS_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Scaling
          <Select
            value={screen.scaling}
            onChange={(e) => {
              update({ scaling: e.target.value as ScalingMode });
            }}
          >
            {SCALING_MODES.map((m) => (
              <option key={m} value={m}>
                {m === 'fit' ? 'Fit (letterbox)' : m === 'fill' ? 'Fill (crop)' : 'Stretch'}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </li>
  );
}

function GroupCard({
  group,
  states,
  displays,
  nodes,
  look,
}: {
  group: ScreenGroupConfig;
  states: Map<string, ScreenState>;
  displays: DisplayInfo[];
  /** Output nodes and their displays (a screen on a node shows on one of those). */
  nodes: NodeDisplays[];
  /** The Look whose settings the card shows. */
  look: LookInfo | null;
}) {
  const [name, setName] = useState(group.name);
  const [shown, setShown] = useState(group.name);
  if (shown !== group.name) {
    setShown(group.name);
    setName(group.name);
  }
  return (
    <section className="space-y-2 rounded-xl border border-line bg-panel-2 p-3" data-testid="screen-group">
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          aria-label="Group name"
          className="min-w-40 flex-1 border-transparent bg-transparent text-base font-bold hover:border-field focus:border-accent"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={() => {
            if (name.trim() && name !== group.name)
              void screensAction(() => bridge().renameGroup(group.id, name));
            else setName(group.name);
          }}
        />
        <label className="flex items-center gap-2 text-xs text-muted">
          Shows
          <Select
            aria-label="What the group shows"
            data-testid="group-role"
            value={group.role === 'stage' || group.role === 'keyfill' ? group.role : 'audience'}
            onChange={(e) => {
              const v = e.target.value;
              const role = v === 'stage' || v === 'keyfill' ? v : 'audience';
              void screensAction(() => bridge().setGroupRole(group.id, role));
            }}
          >
            <option value="audience">The audience picture</option>
            <option value="stage">The stage view (performers)</option>
            <option value="keyfill">Key and fill (for a video switcher)</option>
          </Select>
        </label>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          onClick={() => void screensAction(() => bridge().deleteGroup(group.id))}
        >
          Delete group
        </Button>
      </div>
      {look && <GroupLookSettings look={look} groupId={group.id} role={group.role} />}
      {group.role === 'keyfill' && (
        <p className="px-2 text-xs text-muted" data-testid="keyfill-hint">
          Two displays: the fill and the key, each into the video switcher (an ATEM, for example). Set its key
          to pre-multiplied. Black-out and the logo are for the hall: they take these graphics off.
        </p>
      )}
      {group.screens.length === 0 ? (
        <p className="px-2 text-sm text-muted">
          No screens yet. Choose a display above and press “Use this display”.
        </p>
      ) : (
        <ul className="space-y-2">
          {group.screens.map((sc) => (
            <ScreenRow
              key={sc.id}
              screen={sc}
              state={states.get(sc.id) ?? 'unassigned'}
              displays={sc.nodeId ? (nodes.find((n) => n.id === sc.nodeId)?.displays ?? []) : displays}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Cover the controls?" - shown before an output goes on the display the operator window is on. */
function CoverConfirm({ platform }: { platform: string }) {
  const pending = useScreens((s) => s.pendingCover);
  if (!pending) return null;
  return (
    <ConfirmDialog
      title="Cover the Drashti controls?"
      confirmLabel="Cover the controls"
      onCancel={cancelCover}
      onConfirm={pending.proceed}
      testId="cover-confirm"
    >
      <p>
        {pending.message} It will cover them completely: you will not be able to see or click the controls on
        this display while it shows.
      </p>
      <p>
        To get the controls back, press{' '}
        <Kbd className="text-fg">{shortcutText('uncoverControls', platform)}</Kbd> (Uncover the controls). It
        works even while Drashti is covered, and turns that output off.
      </p>
    </ConfirmDialog>
  );
}

export function ScreensPanel({ onClose, platform }: { onClose: () => void; platform: string }) {
  const { snapshot, error, busy } = useScreens();
  const [newGroup, setNewGroup] = useState('');
  useEffect(() => {
    connectScreens();
    connectLooks();
    connectStageLayouts();
    connectMasks();
  }, []);
  // The Look whose settings the group cards show: the live one until another is chosen.
  const liveId = useEngine((s) => s.state?.look.id ?? '');
  const lookList = useLooks((s) => s.view?.looks);
  const [chosenLook, setChosenLook] = useState<string | null>(null);
  const look =
    lookList?.find((l) => l.id === chosenLook) ??
    lookList?.find((l) => l.id === liveId) ??
    lookList?.[0] ??
    null;

  const states = new Map((snapshot?.status ?? []).map((s) => [s.screenId, s.state]));
  const usedBy = new Map<number, string>();
  for (const st of snapshot?.status ?? []) {
    if (st.displayId === null) continue;
    const screen = snapshot?.groups.flatMap((g) => g.screens).find((s) => s.id === st.screenId);
    // This computer's displays only (a node's displays are listed under the node).
    if (screen?.nodeId === null) usedBy.set(st.displayId, screen.name);
  }

  return (
    <Dialog
      title="Screens"
      subtitle="Where the show goes: screen groups, each display's output, and the sound."
      placement="right"
      size="lg"
      onClose={onClose}
      closeLabel="Close screens"
      bodyClassName="space-y-6"
      headerActions={
        <>
          <Button
            icon={Wand2}
            data-testid="open-setup"
            onClick={() => {
              onClose();
              void openSetup();
            }}
          >
            Setup wizard
          </Button>
          <Button icon={ScanEye} onClick={() => void window.drashti.screens.identify()}>
            Identify screens
          </Button>
        </>
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      <SoundOutput />
      <section className="space-y-2">
        <SectionTitle>Connected displays</SectionTitle>
        <p className="text-xs text-muted">
          Resolution and refresh rate are what the computer reports. Drashti never changes them.
        </p>
        {!snapshot ? (
          <Loading label="Looking for displays…" />
        ) : (
          <ul className="space-y-2">
            {snapshot.displays.map((d) => (
              <DisplayRow
                key={d.id}
                display={d}
                usedBy={usedBy.get(d.id) ?? null}
                groups={snapshot.groups.filter((g) => g.role !== 'stream')}
              />
            ))}
          </ul>
        )}
      </section>
      <NodesSection groups={(snapshot?.groups ?? []).filter((g) => g.role !== 'stream')} />
      <section className="space-y-3">
        <SectionTitle>Screen groups</SectionTitle>
        {look && <LooksSection lookId={look.id} onChoose={setChosenLook} />}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void screensAction(() => bridge().createGroup(newGroup)).then((ok) => {
              if (ok) setNewGroup('');
            });
          }}
        >
          <Field label="New group" layout="inline" className="flex-1">
            <TextInput
              aria-label="New group name"
              placeholder="For example Main Hall"
              className="flex-1"
              value={newGroup}
              onChange={(e) => {
                setNewGroup(e.target.value);
              }}
            />
          </Field>
          <Button variant="primary" icon={Plus} type="submit" disabled={busy || !newGroup.trim()}>
            Add group
          </Button>
        </form>
        {snapshot?.groups.every((g) => g.role === 'stream') && (
          <EmptyState icon={Monitor} title="No screen groups yet" compact>
            Add a group (for example Main Hall), then press “Use this display” next to each display that feeds
            it.
          </EmptyState>
        )}
        {(snapshot?.groups ?? []).map((g) =>
          g.role === 'stream' ? (
            <StreamGroupCard key={g.id} group={g} look={look} />
          ) : (
            <GroupCard
              key={g.id}
              group={g}
              states={states}
              displays={snapshot?.displays ?? []}
              nodes={snapshot?.nodes ?? []}
              look={look}
            />
          ),
        )}
      </section>
      <CoverConfirm platform={platform} />
    </Dialog>
  );
}
