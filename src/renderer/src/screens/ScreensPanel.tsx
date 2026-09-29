import { useEffect, useState } from 'react';
import { describeDisplay } from '../../../shared/display-match';
import type {
  DisplayInfo,
  ScreenConfig,
  ScreenGroupConfig,
  ScreenState,
  ScalingMode,
} from '../../../shared/screens';
import { shortcutText } from '../../../shared/keymap';
import { CANVAS_PRESETS, SCALING_MODES } from '../../../shared/screens';
import { Button } from '../ui/Button';
import { cancelCover, connectScreens, screensAction, useScreens } from './screens-store';
import { SoundOutput } from './SoundOutput';

const stateText: Record<ScreenState, string> = {
  showing: 'Showing',
  'missing-display': 'Display not connected',
  unassigned: 'No display',
  disabled: 'Off',
};
const stateTone: Record<ScreenState, string> = {
  showing: 'bg-emerald-900/60 text-emerald-200 border-emerald-700',
  'missing-display': 'bg-amber-900/60 text-amber-100 border-amber-600',
  unassigned: 'bg-panel-2 text-muted border-line',
  disabled: 'bg-panel-2 text-muted border-line',
};

const bridge = () => window.drashti.screens;

function DisplayRow({
  display,
  usedBy,
  groups,
}: {
  display: DisplayInfo;
  usedBy: string | null;
  groups: ScreenGroupConfig[];
}) {
  const [groupId, setGroupId] = useState('');
  const target = groupId !== '' ? groupId : (groups[0]?.id ?? '');
  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel-2 px-3 py-2"
      data-testid="display-row"
      data-display-id={display.id}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{describeDisplay(display)}</div>
        <div className="text-xs text-muted">
          scale {display.scaleFactor}x{display.primary ? ' · main display' : ''}
          {display.internal ? ' · built in' : ''}
        </div>
      </div>
      {usedBy ? (
        <span className="text-xs text-muted">Used by “{usedBy}”</span>
      ) : groups.length === 0 ? (
        <span className="text-xs text-muted">Create a group first</span>
      ) : (
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted" htmlFor={`group-for-${display.id}`}>
            Add to
          </label>
          <select
            id={`group-for-${display.id}`}
            className="rounded-md border border-line bg-panel px-2 py-1 text-sm"
            value={target}
            onChange={(e) => {
              setGroupId(e.target.value);
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <Button
            tone="primary"
            onClick={() =>
              void screensAction((consent) => bridge().assignDisplay(target, display.id, consent))
            }
          >
            Use this display
          </Button>
        </div>
      )}
    </li>
  );
}

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
    <label className="flex items-center gap-1 text-xs text-muted">
      {label}
      <input
        className="w-20 rounded-md border border-line bg-panel px-2 py-1 text-sm text-white"
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
  return (
    <li className="space-y-2 rounded-md border border-line bg-panel px-3 py-2" data-testid="screen-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{screen.name}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${stateTone[state]}`}
          data-testid="screen-state"
        >
          {stateText[state]}
          {state === 'showing' && shownOn ? ` on ${shownOn.label || `display ${shownOn.id}`}` : ''}
        </span>
        {state === 'missing-display' && (
          <span className="text-xs text-amber-200">It opens by itself when the display is connected.</span>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-muted">
          <input
            type="checkbox"
            checked={screen.enabled}
            onChange={(e) => {
              update({ enabled: e.target.checked });
            }}
          />
          On
        </label>
        <Button tone="danger" onClick={() => void screensAction(() => bridge().removeScreen(screen.id))}>
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
        <label className="flex items-center gap-1 text-xs text-muted">
          Preset
          <select
            className="rounded-md border border-line bg-panel px-2 py-1 text-sm text-white"
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
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          Scaling
          <select
            className="rounded-md border border-line bg-panel px-2 py-1 text-sm text-white"
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
          </select>
        </label>
      </div>
    </li>
  );
}

function GroupCard({
  group,
  states,
  displays,
}: {
  group: ScreenGroupConfig;
  states: Map<string, ScreenState>;
  displays: DisplayInfo[];
}) {
  const [name, setName] = useState(group.name);
  const [shown, setShown] = useState(group.name);
  if (shown !== group.name) {
    setShown(group.name);
    setName(group.name);
  }
  return (
    <section className="space-y-2 rounded-lg border border-line bg-panel-2 p-3" data-testid="screen-group">
      <div className="flex items-center gap-2">
        <input
          aria-label="Group name"
          className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold hover:border-line focus:border-accent"
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
          <select
            aria-label="What the group shows"
            data-testid="group-role"
            className="rounded-md border border-line bg-panel px-2 py-1 text-sm text-white"
            value={group.role === 'stage' ? 'stage' : 'audience'}
            onChange={(e) => {
              const role = e.target.value === 'stage' ? 'stage' : 'audience';
              void screensAction(() => bridge().setGroupRole(group.id, role));
            }}
          >
            <option value="audience">The audience picture</option>
            <option value="stage">The stage view (performers)</option>
          </select>
        </label>
        <Button tone="danger" onClick={() => void screensAction(() => bridge().deleteGroup(group.id))}>
          Delete group
        </Button>
      </div>
      {group.screens.length === 0 ? (
        <p className="px-2 text-sm text-muted">
          No screens yet. Choose a display above and press “Use this display”.
        </p>
      ) : (
        <ul className="space-y-2">
          {group.screens.map((s) => (
            <ScreenRow key={s.id} screen={s} state={states.get(s.id) ?? 'unassigned'} displays={displays} />
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cover-title"
      aria-describedby="cover-text"
      data-testid="cover-confirm"
    >
      <div className="max-w-md space-y-4 rounded-lg border border-amber-600 bg-panel p-5 shadow-2xl">
        <h3 id="cover-title" className="text-lg font-semibold">
          Cover the Drashti controls?
        </h3>
        <div id="cover-text" className="space-y-2 text-sm text-muted">
          <p>
            {pending.message} It will cover them completely: you will not be able to see or click the controls
            on this display while it shows.
          </p>
          <p>
            To get the controls back, press{' '}
            <kbd className="rounded border border-line px-1 text-white">
              {shortcutText('uncoverControls', platform)}
            </kbd>{' '}
            (Uncover the controls). It works even while Drashti is covered, and turns that output off.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button autoFocus onClick={cancelCover}>
            Cancel
          </Button>
          <Button tone="danger" onClick={pending.proceed}>
            Cover the controls
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ScreensPanel({ onClose, platform }: { onClose: () => void; platform: string }) {
  const { snapshot, error, busy } = useScreens();
  const [newGroup, setNewGroup] = useState('');
  useEffect(() => {
    connectScreens();
  }, []);

  const states = new Map((snapshot?.status ?? []).map((s) => [s.screenId, s.state]));
  const usedBy = new Map<number, string>();
  for (const st of snapshot?.status ?? []) {
    if (st.displayId === null) continue;
    const screen = snapshot?.groups.flatMap((g) => g.screens).find((s) => s.id === st.screenId);
    if (screen) usedBy.set(st.displayId, screen.name);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Screens"
    >
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-line bg-panel shadow-2xl">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="flex-1 text-lg font-semibold">Screens</h2>
          <Button onClick={() => void window.drashti.screens.identify()}>Identify screens</Button>
          <Button tone="ghost" onClick={onClose} aria-label="Close screens">
            Close
          </Button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-100"
            >
              {error}
            </p>
          )}
          <SoundOutput />
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Connected displays</h3>
            <p className="text-xs text-muted">
              Resolution and refresh rate are what the computer reports. Drashti never changes them.
            </p>
            <ul className="space-y-2">
              {(snapshot?.displays ?? []).map((d) => (
                <DisplayRow
                  key={d.id}
                  display={d}
                  usedBy={usedBy.get(d.id) ?? null}
                  groups={snapshot?.groups ?? []}
                />
              ))}
            </ul>
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Screen groups</h3>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void screensAction(() => bridge().createGroup(newGroup)).then((ok) => {
                  if (ok) setNewGroup('');
                });
              }}
            >
              <input
                aria-label="New group name"
                placeholder="New group, e.g. Main Hall"
                className="flex-1 rounded-md border border-line bg-panel-2 px-3 py-1.5 text-sm"
                value={newGroup}
                onChange={(e) => {
                  setNewGroup(e.target.value);
                }}
              />
              <Button tone="primary" type="submit" disabled={busy || !newGroup.trim()}>
                Add group
              </Button>
            </form>
            {(snapshot?.groups ?? []).map((g) => (
              <GroupCard key={g.id} group={g} states={states} displays={snapshot?.displays ?? []} />
            ))}
          </section>
        </div>
      </div>
      <CoverConfirm platform={platform} />
    </div>
  );
}
