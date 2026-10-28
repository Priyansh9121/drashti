import { useState } from 'react';
import { describeDisplay } from '../../../../shared/display-match';
import type { DesktopAskView } from '../../../../shared/network-desktop';
import { ASK_WORDS } from '../../../../shared/network-desktop';
import {
  ALL_ON,
  SCREEN_SWITCHES,
  type ScreenSwitch,
  SWITCH_NAMES,
  switchFor,
} from '../../../../shared/screen-switches';
import {
  CANVAS_PRESETS,
  type DisplayInfo,
  GROUP_ROLES,
  GROUP_ROLE_WORDS,
  type NodeDisplays,
  SCALING_MODES,
  SCALING_WORDS,
  type ScreenConfig,
  type ScreenGroupConfig,
  SCREEN_STATE_WORDS,
  type ScreenState,
  type ScreenStatus,
} from '../../../../shared/screens';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Monitor, Plus, ScanEye, Trash2 } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { useRemote } from './remote-store';
import { changeScreens, closeSheet, turnSwitch, useDesktop } from './desktop-store';
import { PhoneSheet } from './PhoneSheet';

/*
 * The Drashti computer's screens set up from a phone (Session 54, the phone as a full Drashti), as its Screens sheet
 * has them, laid out for the phone: Audience and Stage; each connected display as the computer sees it, the one the
 * controls are on said so, with Use this display; the screen groups (their names, what each shows, Delete group);
 * and each screen (On, its canvas, Fit, Fill or Stretch, what a key and fill screen sends, Remove). Each change is
 * the window's own request, answered with the screens as they are after it; Keep these screens? is asked here once
 * a change of this phone's waits for it (DesktopTools.tsx). An output on the controls' display is asked of the
 * computer itself: this sheet says so, and how it stands. The stream's YouTube card, a node's displays and Set Up
 * Screens… stay on the computer.
 */

const FIELD = 'h-12 w-full rounded-lg border border-field bg-panel-3 px-3 text-base text-fg';
const LABEL = 'block space-y-1';
const LABEL_WORDS = 'block text-base text-muted';

const send = (path: string, body?: unknown) => void changeScreens(path, body);
const groupPath = (id: string, what: string) => `/api/v1/screen-groups/${encodeURIComponent(id)}/${what}`;
const screenPath = (id: string, what: string) => `/api/v1/screens/${encodeURIComponent(id)}/${what}`;

/** Audience or Stage, as the window's top bar has it: its name, said On or Off, a switch. */
export function SwitchButtons() {
  const fromSheet = useDesktop((s) => s.screens?.switches);
  const fromHall = useRemote((s) => s.hall?.switches);
  const switches = fromSheet ?? fromHall ?? ALL_ON;
  return (
    <div role="group" aria-label="The Drashti computer’s screens" className="grid grid-cols-2 gap-2">
      {SCREEN_SWITCHES.map((which: ScreenSwitch) => {
        const on = switches[which];
        return (
          <Button
            key={which}
            size="lg"
            className="min-h-12"
            variant={on ? 'secondary' : 'warning'}
            role="switch"
            aria-checked={on}
            data-testid={`remote-switch-${which}`}
            data-on={on ? 'true' : 'false'}
            onClick={() => void turnSwitch(which, !on)}
          >
            {SWITCH_NAMES[which]}
            <span aria-hidden="true" className="font-bold">
              {on ? 'On' : 'Off'}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

/** How this phone's ask to cover the controls stands, while the computer asks and for a minute after. */
function Asked({ asked }: { asked: DesktopAskView }) {
  const tone =
    asked.state === 'agreed'
      ? 'success'
      : asked.state === 'waiting'
        ? 'info'
        : asked.state === 'refused'
          ? 'warning'
          : 'danger';
  return (
    <Notice tone={tone} data-testid="remote-screens-asked" data-state={asked.state}>
      {asked.state === 'waiting' ? `${ASK_WORDS.waiting} ${COVER_WORDS}` : asked.message}
    </Notice>
  );
}

/** What asking the computer means, said while it asks. */
const COVER_WORDS =
  'The Drashti controls are on that display, so an output there would cover them: the computer asks in its own box, and only its answer there puts it there.';

function Displays({
  displays,
  groups,
  usedBy,
  controlsDisplayId,
}: {
  displays: DisplayInfo[];
  groups: ScreenGroupConfig[];
  usedBy: Map<number, string>;
  controlsDisplayId: number | null;
}) {
  return (
    <section className="space-y-2" aria-labelledby="remote-displays-title">
      <h3 id="remote-displays-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Connected displays
      </h3>
      <p className="text-base text-muted">
        As the Drashti computer sees them: their resolution and refresh rate are what it reports, never
        changed.
      </p>
      <ul className="space-y-2">
        {displays.map((d) => (
          <DisplayCard
            key={d.id}
            display={d}
            groups={groups}
            usedBy={usedBy.get(d.id) ?? null}
            controls={d.id === controlsDisplayId}
          />
        ))}
      </ul>
    </section>
  );
}

function DisplayCard({
  display,
  groups,
  usedBy,
  controls,
}: {
  display: DisplayInfo;
  groups: ScreenGroupConfig[];
  usedBy: string | null;
  controls: boolean;
}) {
  const busy = useDesktop((s) => s.busy);
  const [groupId, setGroupId] = useState('');
  const target = groups.some((g) => g.id === groupId) ? groupId : (groups[0]?.id ?? '');
  const selectId = `remote-display-group-${String(display.id)}`;
  return (
    <li
      className="space-y-2 rounded-lg border border-line bg-panel-2 p-3"
      data-testid="remote-display"
      data-display-id={display.id}
    >
      <div className="flex items-start gap-2">
        <Monitor size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-base break-words text-fg">{describeDisplay(display)}</p>
          <p className="text-base text-muted">
            scale {display.scaleFactor}x{display.primary ? ' · main display' : ''}
            {display.internal ? ' · built in' : ''}
          </p>
        </div>
      </div>
      {controls && (
        <p className="text-base text-warning-fg" data-testid="remote-display-controls">
          <Badge tone="warning">Controls here</Badge> The Drashti controls are on this display: an output put
          here is asked of the computer first.
        </p>
      )}
      {usedBy ? (
        <p className="text-base text-muted">Used by “{usedBy}”</p>
      ) : groups.length === 0 ? (
        <p className="text-base text-muted">Add a screen group below first.</p>
      ) : (
        <div className="space-y-2">
          <label className={LABEL} htmlFor={selectId}>
            <span className={LABEL_WORDS}>Add to</span>
          </label>
          <select
            id={selectId}
            className={FIELD}
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
            size="lg"
            variant="primary"
            className="min-h-12 w-full"
            disabled={busy}
            data-testid="remote-use-display"
            onClick={() => {
              send(groupPath(target, 'display'), { displayId: display.id });
            }}
          >
            Use this display
          </Button>
        </div>
      )}
    </li>
  );
}

/** A canvas size, kept as typed until it is left or Enter is pressed (16 to 16384), as Screens' field does. */
function SizeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  // Follow a change from the computer (adjusting state while rendering, as React recommends).
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
    <label className={LABEL}>
      <span className={LABEL_WORDS}>{label}</span>
      <input
        className={cx(FIELD, 'tabular-nums')}
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

function ScreenCard({
  screen,
  state,
  display,
  role,
  node,
}: {
  screen: ScreenConfig;
  state: ScreenState;
  display: DisplayInfo | null;
  role: ScreenGroupConfig['role'];
  node: string | null;
}) {
  const busy = useDesktop((s) => s.busy);
  const change = (patch: Record<string, unknown>) => {
    send(screenPath(screen.id, 'change'), patch);
  };
  const switchName = SWITCH_NAMES[switchFor(role) ?? 'audience'];
  const preset = CANVAS_PRESETS.find(
    (p) => p.width === screen.canvasWidth && p.height === screen.canvasHeight,
  );
  return (
    <li className="space-y-3 rounded-lg border border-line bg-panel p-3" data-testid="remote-screen">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-base font-medium break-words text-fg">{screen.name}</span>
        <Badge tone={state === 'showing' ? 'success' : state === 'stopped' ? 'danger' : 'neutral'}>
          <span data-testid="remote-screen-state">
            {SCREEN_STATE_WORDS[state]}
            {state === 'showing' && display ? ` on ${display.label || `display ${String(display.id)}`}` : ''}
            {node ? ` · ${node}` : ''}
          </span>
        </Badge>
      </div>
      {state === 'missing-display' && (
        <p className="text-base text-muted">It opens by itself when the display is connected.</p>
      )}
      {state === 'switched-off' && (
        <p className="text-base text-muted">
          {switchName} is off: its display shows the computer’s desktop until {switchName} is on again.
        </p>
      )}
      {state === 'stopped' && (
        <p className="text-base text-danger-fg">
          It kept failing, so it is black for now. Drashti tries it again by itself every few minutes.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {/* A switch named for its screen, as the window's top bar has Audience and Stage: On and Off for the eye. */}
        <Button
          size="lg"
          className="min-h-12"
          role="switch"
          aria-checked={screen.enabled}
          variant={screen.enabled ? 'secondary' : 'warning'}
          disabled={busy}
          data-testid="remote-screen-on"
          onClick={() => {
            change({ enabled: !screen.enabled });
          }}
        >
          <span className="sr-only">{screen.name}</span>
          <span aria-hidden="true">{screen.enabled ? 'On' : 'Off'}</span>
        </Button>
        <Button
          size="lg"
          variant="danger"
          className="min-h-12"
          icon={Trash2}
          disabled={busy}
          aria-label={`Remove ${screen.name}`}
          data-testid="remote-screen-remove"
          onClick={() => {
            send(screenPath(screen.id, 'remove'));
          }}
        >
          Remove
        </Button>
      </div>
      {screen.feed !== null && (
        <label className={LABEL}>
          <span className={LABEL_WORDS}>Sends</span>
          <select
            className={FIELD}
            value={screen.feed}
            data-testid="remote-screen-feed"
            onChange={(e) => {
              change({ feed: e.target.value === 'key' ? 'key' : 'fill' });
            }}
          >
            <option value="fill">The fill (the picture)</option>
            <option value="key">The key (white where the fill has something)</option>
          </select>
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <SizeField
          label="Canvas width"
          value={screen.canvasWidth}
          onCommit={(canvasWidth) => {
            change({ canvasWidth });
          }}
        />
        <SizeField
          label="Canvas height"
          value={screen.canvasHeight}
          onCommit={(canvasHeight) => {
            change({ canvasHeight });
          }}
        />
      </div>
      <label className={LABEL}>
        <span className={LABEL_WORDS}>Preset</span>
        <select
          className={FIELD}
          value={preset ? preset.label : 'custom'}
          onChange={(e) => {
            const p = CANVAS_PRESETS.find((x) => x.label === e.target.value);
            if (p) change({ canvasWidth: p.width, canvasHeight: p.height });
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
      <label className={LABEL}>
        <span className={LABEL_WORDS}>Scaling</span>
        <select
          className={FIELD}
          value={screen.scaling}
          data-testid="remote-screen-scaling"
          onChange={(e) => {
            change({ scaling: e.target.value });
          }}
        >
          {SCALING_MODES.map((m) => (
            <option key={m} value={m}>
              {SCALING_WORDS[m]}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

function GroupCard({
  group,
  states,
  displays,
  nodes,
}: {
  group: ScreenGroupConfig;
  states: Map<string, ScreenStatus>;
  displays: DisplayInfo[];
  nodes: NodeDisplays[];
}) {
  const busy = useDesktop((s) => s.busy);
  const [name, setName] = useState(group.name);
  const [shown, setShown] = useState(group.name);
  if (shown !== group.name) {
    setShown(group.name);
    setName(group.name);
  }
  const rename = () => {
    if (name.trim() && name !== group.name) send(groupPath(group.id, 'name'), { name });
    else setName(group.name);
  };
  const role = group.role === 'stage' || group.role === 'keyfill' ? group.role : 'audience';
  return (
    <li
      className="space-y-3 rounded-xl border border-line bg-panel-2 p-3"
      data-testid="remote-screen-group"
      data-group-id={group.id}
      data-group-name={group.name}
    >
      <label className={LABEL}>
        <span className={LABEL_WORDS}>Group name</span>
        <input
          className={cx(FIELD, 'font-bold')}
          value={name}
          maxLength={80}
          enterKeyHint="done"
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename();
          }}
        />
      </label>
      <label className={LABEL}>
        <span className={LABEL_WORDS}>Shows</span>
        <select
          className={FIELD}
          value={role}
          data-testid="remote-group-role"
          onChange={(e) => {
            send(groupPath(group.id, 'role'), { role: e.target.value });
          }}
        >
          {GROUP_ROLES.map((r) => (
            <option key={r} value={r}>
              {GROUP_ROLE_WORDS[r]}
            </option>
          ))}
        </select>
      </label>
      {group.role === 'keyfill' && (
        <p className="text-base text-muted">
          Two displays: the fill and the key, each into the video switcher. Set its key to pre-multiplied.
        </p>
      )}
      {group.screens.length === 0 ? (
        <p className="text-base text-muted">
          No screens yet: choose a display above and press Use this display.
        </p>
      ) : (
        <ul className="space-y-2">
          {group.screens.map((sc) => {
            const status = states.get(sc.id);
            const node = sc.nodeId ? (nodes.find((n) => n.id === sc.nodeId) ?? null) : null;
            const among = node ? node.displays : displays;
            return (
              <ScreenCard
                key={sc.id}
                screen={sc}
                state={status?.state ?? 'unassigned'}
                display={among.find((d) => d.id === status?.displayId) ?? null}
                role={group.role}
                node={node?.name ?? null}
              />
            );
          })}
        </ul>
      )}
      <Button
        size="lg"
        variant="danger"
        className="min-h-12 w-full"
        icon={Trash2}
        disabled={busy}
        aria-label={`Delete group ${group.name}`}
        data-testid="remote-group-delete"
        onClick={() => {
          send(groupPath(group.id, 'delete'));
        }}
      >
        Delete group
      </Button>
    </li>
  );
}

function NewGroup() {
  const busy = useDesktop((s) => s.busy);
  const [name, setName] = useState('');
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void changeScreens('/api/v1/screen-groups', { name }).then((ok) => {
          if (ok) setName('');
        });
      }}
    >
      <label className={LABEL}>
        <span className={LABEL_WORDS}>New group</span>
        <input
          className={FIELD}
          placeholder="For example Main Hall"
          value={name}
          maxLength={80}
          enterKeyHint="done"
          data-testid="remote-new-group"
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <Button
        type="submit"
        size="lg"
        variant="primary"
        icon={Plus}
        className="min-h-12 w-full"
        disabled={busy || name.trim() === ''}
      >
        Add group
      </Button>
    </form>
  );
}

export function ScreensSheet() {
  const screens = useDesktop((s) => s.screens);
  const problem = useDesktop((s) => s.problem);
  const states = new Map((screens?.status ?? []).map((st) => [st.screenId, st]));
  // This computer's displays in use, and by which screen (a node's displays are its own).
  const usedBy = new Map<number, string>();
  for (const st of screens?.status ?? []) {
    if (st.displayId === null) continue;
    const screen = screens?.groups.flatMap((g) => g.screens).find((s) => s.id === st.screenId);
    if (screen?.nodeId === null) usedBy.set(st.displayId, screen.name);
  }
  return (
    <PhoneSheet
      title="Screens"
      subtitle="The Drashti computer’s displays, and what each shows."
      onClose={closeSheet}
      testId="remote-screens"
    >
      <Button
        size="lg"
        className="min-h-12 w-full"
        icon={ScanEye}
        data-testid="remote-identify"
        onClick={() => void changeScreens('/api/v1/screens/identify')}
      >
        Identify screens
      </Button>
      {problem && (
        <Notice
          tone="warning"
          data-testid="remote-screens-problem"
          onDismiss={() => useDesktop.setState({ problem: null })}
        >
          {problem}
        </Notice>
      )}
      {screens?.asked && <Asked asked={screens.asked} />}
      <section className="space-y-2" aria-labelledby="remote-switches-title">
        <h3 id="remote-switches-title" className="text-base font-bold tracking-wider text-muted uppercase">
          Audience and Stage
        </h3>
        <p className="text-base text-muted">
          Off gives the hall’s or the stage screens’ displays back to the computer; the show carries on.
        </p>
        <SwitchButtons />
      </section>
      {!screens ? (
        <p role="status" className="text-base text-muted">
          Looking for the computer’s displays…
        </p>
      ) : (
        <>
          <Displays
            displays={screens.displays}
            groups={screens.groups}
            usedBy={usedBy}
            controlsDisplayId={screens.controlsDisplayId}
          />
          <section className="space-y-3" aria-labelledby="remote-groups-title">
            <h3 id="remote-groups-title" className="text-base font-bold tracking-wider text-muted uppercase">
              Screen groups
            </h3>
            <NewGroup />
            {screens.groups.length === 0 ? (
              <p className="text-base text-muted">
                No screen groups yet: add one (for example Main Hall), then press Use this display beside each
                display that feeds it.
              </p>
            ) : (
              <ul className="space-y-3">
                {screens.groups.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    states={states}
                    displays={screens.displays}
                    nodes={screens.nodes}
                  />
                ))}
              </ul>
            )}
          </section>
          <p className="text-base text-muted">
            The stream’s YouTube card, a node’s displays and Set Up Screens… are on the Drashti computer, in
            Screens.
          </p>
        </>
      )}
    </PhoneSheet>
  );
}
