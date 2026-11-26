import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_ON, switchFor } from '../../shared/screen-switches';
import type { DisplayInfo, DisplayKey, ScreenConfig, ScreenRole } from '../../shared/screens';
import { DISPLAY_DROP_MS, OutputManager, type OutputWindow } from './output-manager';

function display(id: number, label: string, x = 0): DisplayInfo {
  const key: DisplayKey = { id, label, pixelWidth: 1920, pixelHeight: 1080, x, y: 0, internal: false };
  return {
    id,
    label,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workArea: { x, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    pixelWidth: 1920,
    pixelHeight: 1080,
    refreshHz: 60,
    rotation: 0,
    internal: false,
    primary: false,
    key,
  };
}

class FakeWindow implements OutputWindow {
  static next = 100;
  readonly webContentsId = FakeWindow.next++;
  closed = false;
  hidden = false;
  bounds: DisplayInfo['bounds'] | null = null;
  constructor(
    readonly screenId: string,
    readonly displayId: number,
  ) {}
  setBounds(b: DisplayInfo['bounds']): void {
    this.bounds = b;
  }
  close(): void {
    this.closed = true;
  }
  isDestroyed(): boolean {
    return this.closed;
  }
  hide(): void {
    this.hidden = true;
  }
  show(): void {
    this.hidden = false;
  }
}

/** The tests' clock: what was asked to happen later, done when they say. */
let waiting: { at: number; fn: () => void; cancelled: boolean }[];
let now: number;
const advance = (ms: number) => {
  now += ms;
  for (const w of waiting.filter((x) => x.at <= now && !x.cancelled)) {
    w.cancelled = true;
    w.fn();
  }
};

const hall = display(2, 'Hall TV', 1440);
const stage = display(3, 'Stage TV', 3360);
const laptop = display(1, 'Built-in');

let displays: DisplayInfo[];
let screens: ScreenConfig[];
let opened: FakeWindow[];
let saved: [string, DisplayKey][];
let changes: number;
let putBack: string[];
let manager: OutputManager;
/** Each group's role (Session 50: the switches go by it); a group not here shows the audience picture. */
let roles: Record<string, ScreenRole>;

const screen = (id: string, d: DisplayInfo | null, enabled = true, groupId = 'g'): ScreenConfig => ({
  id,
  groupId,
  name: id,
  displayKey: d ? d.key : null,
  canvasWidth: 1920,
  canvasHeight: 1080,
  scaling: 'fit',
  enabled,
  feed: null,
  nodeId: null,
});

beforeEach(() => {
  displays = [laptop, hall, stage];
  screens = [];
  opened = [];
  saved = [];
  changes = 0;
  putBack = [];
  waiting = [];
  now = 0;
  roles = {};
  manager = new OutputManager({
    listDisplays: () => displays,
    screens: () => screens,
    saveDisplayKey: (id, key) => saved.push([id, key]),
    openWindow: (s, d) => {
      const w = new FakeWindow(s.id, d.id);
      opened.push(w);
      return w;
    },
    onChange: () => {
      changes++;
    },
    onPutBack: (id) => putBack.push(id),
    switchOf: (s) => switchFor(roles[s.groupId] ?? 'audience'),
    later: (fn, ms) => {
      const w = { at: now + ms, fn, cancelled: false };
      waiting.push(w);
      return () => {
        w.cancelled = true;
      };
    },
  });
});

const live = () => opened.filter((w) => !w.closed).map((w) => `${w.screenId}@${w.displayId}`);

describe('OutputManager', () => {
  it('opens one window per assigned display', () => {
    screens = [screen('audience', hall), screen('stage', stage), screen('spare', null)];
    manager.reconcile();
    expect(live()).toEqual(['audience@2', 'stage@3']);
    expect(manager.status()).toEqual([
      { screenId: 'audience', state: 'showing', displayId: 2 },
      { screenId: 'stage', state: 'showing', displayId: 3 },
      { screenId: 'spare', state: 'unassigned', displayId: null },
    ]);
    expect(changes).toBe(1);
  });

  it('does not reopen windows that are already showing', () => {
    screens = [screen('audience', hall)];
    manager.reconcile();
    manager.reconcile();
    expect(opened).toHaveLength(1);
  });

  it('copes with a display that is missing at startup, and opens it when it arrives', () => {
    screens = [screen('audience', hall), screen('stage', stage)];
    displays = [laptop, hall];
    manager.reconcile();
    expect(live()).toEqual(['audience@2']);
    expect(manager.status()[1]).toEqual({ screenId: 'stage', state: 'missing-display', displayId: null });

    displays = [laptop, hall, stage];
    manager.reconcile();
    expect(live()).toEqual(['audience@2', 'stage@3']);
  });

  it('closes the window when its display is unplugged, instead of letting it land on another screen', () => {
    screens = [screen('stage', stage)];
    manager.reconcile();
    displays = [laptop, hall];
    manager.reconcile();
    // Hidden at once, and kept a while for the display to come back (ROB-4), then closed.
    expect(opened[0]?.hidden).toBe(true);
    expect(manager.status()[0]?.state).toBe('missing-display');
    advance(DISPLAY_DROP_MS);
    expect(live()).toEqual([]);
    expect(manager.status()[0]?.state).toBe('missing-display');
  });

  it('keeps an output through a short display drop: hidden, then the same window back on it (ROB-4)', () => {
    screens = [screen('stage', stage)];
    manager.reconcile();
    const stageWindow = opened[0];
    displays = [laptop, hall];
    manager.reconcile();
    expect(stageWindow?.hidden).toBe(true);
    expect(stageWindow?.closed).toBe(false);
    // Its window still answers for its screen (the page's reports keep coming).
    expect(manager.screenIdFor(stageWindow?.webContentsId ?? -1)).toBe('stage');
    advance(DISPLAY_DROP_MS - 1);
    // Back, at a new place: the same window on it, shown, never a new one.
    const moved = { ...stage, bounds: { ...stage.bounds, y: 10 } };
    displays = [laptop, hall, moved];
    manager.reconcile();
    expect(opened).toHaveLength(1);
    expect(stageWindow?.hidden).toBe(false);
    expect(stageWindow?.bounds).toEqual(moved.bounds);
    expect(putBack).toEqual(['stage']);
    expect(manager.status()[0]).toEqual({ screenId: 'stage', state: 'showing', displayId: 3 });
    // The grace it had is over: nothing closes it later.
    advance(DISPLAY_DROP_MS);
    expect(live()).toEqual(['stage@3']);
  });

  it('closes a held output at once when its screen is turned off, and on closeAll', () => {
    screens = [screen('stage', stage), screen('audience', hall)];
    manager.reconcile();
    displays = [laptop];
    manager.reconcile();
    expect(live()).toEqual(['stage@3', 'audience@2']);
    screens = [screen('stage', stage, false), screen('audience', hall)];
    manager.reconcile();
    expect(live()).toEqual(['audience@2']);
    manager.closeAll();
    expect(live()).toEqual([]);
    // Nothing waits on them any more.
    advance(DISPLAY_DROP_MS);
    expect(opened).toHaveLength(2);
  });

  it('follows a display whose resolution or position changed', () => {
    screens = [screen('audience', hall)];
    manager.reconcile();
    const moved = { ...hall, bounds: { ...hall.bounds, x: 0 }, key: { ...hall.key, x: 0 } };
    displays = [moved];
    manager.reconcile();
    expect(opened[0]?.bounds).toEqual(moved.bounds);
    expect(saved).toEqual([['audience', moved.key]]);
  });

  it('saves a display’s own identity once it is known, and never loses it while it is not (Session 55)', () => {
    screens = [screen('audience', hall)];
    manager.reconcile();
    expect(saved).toEqual([]);
    // Read: the hall's identity is saved with its key.
    const known = { ...hall, key: { ...hall.key, hardwareId: 'edid:10ac:a0f3:n4c4c4c4c' } };
    displays = [laptop, known, stage];
    manager.reconcile();
    expect(saved).toEqual([['audience', known.key]]);
    // A moment it is not known (the display came back, not read yet), moved: its place saved, its identity kept.
    screens = [{ ...screen('audience', hall), displayKey: known.key }];
    saved = [];
    const moved = { ...hall, bounds: { ...hall.bounds, x: 0 }, key: { ...hall.key, x: 0, hardwareId: null } };
    displays = [moved];
    manager.reconcile();
    expect(saved).toEqual([['audience', { ...moved.key, hardwareId: 'edid:10ac:a0f3:n4c4c4c4c' }]]);
  });

  it('closes windows for disabled and removed screens', () => {
    screens = [screen('a', hall), screen('b', stage)];
    manager.reconcile();
    screens = [screen('a', hall, false)];
    manager.reconcile();
    expect(live()).toEqual([]);
    expect(manager.status()).toEqual([{ screenId: 'a', state: 'disabled', displayId: null }]);
  });

  it('moves a screen to a new display', () => {
    screens = [screen('a', hall)];
    manager.reconcile();
    screens = [screen('a', stage)];
    manager.reconcile();
    expect(live()).toEqual(['a@3']);
  });

  it('reopens a window that was destroyed from outside', () => {
    screens = [screen('a', hall)];
    manager.reconcile();
    opened[0]?.close();
    manager.reconcile();
    expect(live()).toEqual(['a@2']);
  });

  it('knows which screen a window shows', () => {
    screens = [screen('a', hall)];
    manager.reconcile();
    expect(manager.screenIdFor(opened[0]?.webContentsId ?? -1)).toBe('a');
    expect(manager.screenIdFor(-5)).toBeUndefined();
    manager.closeAll();
    expect(live()).toEqual([]);
  });

  it('a window the watchdog gave up on is Stopped, not showing, until it draws again (Session 23)', () => {
    screens = [screen('audience', hall), screen('stage', stage)];
    manager.reconcile();
    const before = changes;
    manager.setStopped('audience', true);
    expect(manager.status()[0]).toEqual({ screenId: 'audience', state: 'stopped', displayId: 2 });
    expect(manager.status()[1]?.state).toBe('showing');
    expect(changes).toBe(before + 1);
    // Its window stays open on its display (it is tried again there).
    expect(live()).toEqual(['audience@2', 'stage@3']);
    manager.setStopped('audience', true);
    expect(changes).toBe(before + 1);
    manager.setStopped('audience', false);
    expect(manager.status()[0]?.state).toBe('showing');
    // A window closed (turned off) forgets it: turned on again, it starts afresh.
    manager.setStopped('audience', true);
    screens = [screen('audience', hall, false), screen('stage', stage)];
    manager.reconcile();
    screens = [screen('audience', hall), screen('stage', stage)];
    manager.reconcile();
    expect(manager.status()[0]?.state).toBe('showing');
  });

  it('a screen restarted again and again by the heartbeat says so (a23-heartbeat): showing, with its count, until it no longer is', () => {
    screens = [screen('audience', hall), screen('stage', stage)];
    manager.reconcile();
    const before = changes;
    manager.setRestarting('audience', 4);
    expect(manager.status()[0]).toEqual({
      screenId: 'audience',
      state: 'showing',
      displayId: 2,
      restarts: 4,
    });
    expect(manager.status()[1]).toEqual({ screenId: 'stage', state: 'showing', displayId: 3 });
    expect(changes).toBe(before + 1);
    manager.setRestarting('audience', 4);
    expect(changes).toBe(before + 1);
    manager.setRestarting('audience', 5);
    expect(manager.status()[0]?.restarts).toBe(5);
    expect(changes).toBe(before + 2);
    // Its window is left as it is, on its display.
    expect(live()).toEqual(['audience@2', 'stage@3']);
    // Stopped by the watchdog meanwhile: Stopped says it, and the count is back once it shows again.
    manager.setStopped('audience', true);
    expect(manager.status()[0]).toEqual({ screenId: 'audience', state: 'stopped', displayId: 2 });
    manager.setStopped('audience', false);
    expect(manager.status()[0]?.restarts).toBe(5);
    manager.setRestarting('audience', null);
    expect(manager.status()[0]).toEqual({ screenId: 'audience', state: 'showing', displayId: 2 });
    // A window closed (turned off) forgets it: turned on again, it starts afresh.
    manager.setRestarting('audience', 4);
    screens = [screen('audience', hall, false), screen('stage', stage)];
    manager.reconcile();
    screens = [screen('audience', hall), screen('stage', stage)];
    manager.reconcile();
    expect(manager.status()[0]).toEqual({ screenId: 'audience', state: 'showing', displayId: 2 });
    // Moved to another display: its window is made again there, and nothing of the old one carries over (review S2).
    manager.setRestarting('audience', 4);
    screens = [screen('audience', laptop), screen('stage', stage)];
    manager.reconcile();
    expect(live()).toEqual(['stage@3', 'audience@1']);
    expect(manager.status()[0]).toEqual({ screenId: 'audience', state: 'showing', displayId: 1 });
  });

  it('held for the owner (QA23-HEARTBEAT-1, A): a screen kept as it is says so while Stopped, and no more once it is not', () => {
    screens = [screen('audience', hall), screen('stage', stage)];
    manager.reconcile();
    manager.setRestarting('audience', 4);
    const before = changes;
    manager.setNotAnswering('audience', true);
    manager.setStopped('audience', true);
    expect(manager.status()[0]).toEqual({
      screenId: 'audience',
      state: 'stopped',
      displayId: 2,
      notAnswering: true,
    });
    expect(changes).toBe(before + 2);
    manager.setNotAnswering('audience', true);
    expect(changes).toBe(before + 2);
    // Its window is left as it is, on its display.
    expect(live()).toEqual(['audience@2', 'stage@3']);
    // Back (by itself, or tried again and drawing): Stopped no more, and nor is it said.
    manager.setStopped('audience', false);
    expect(manager.status()[0]).toEqual({
      screenId: 'audience',
      state: 'showing',
      displayId: 2,
      restarts: 4,
    });
    manager.setStopped('audience', true);
    expect(manager.status()[0]).toEqual({ screenId: 'audience', state: 'stopped', displayId: 2 });
    // Said only of a stopped screen.
    manager.setStopped('audience', false);
    manager.setRestarting('audience', null);
    manager.setNotAnswering('audience', true);
    expect(manager.status()[0]).toEqual({ screenId: 'audience', state: 'showing', displayId: 2 });
    // Kept, then moved to another display: its window made again there is not said to be kept (review round 2 nit).
    manager.setStopped('audience', true);
    expect(manager.status()[0]?.notAnswering).toBe(true);
    screens = [screen('audience', laptop), screen('stage', stage)];
    manager.reconcile();
    expect(live()).toEqual(['stage@3', 'audience@1']);
    expect(manager.status()[0]?.notAnswering).toBeUndefined();
  });

  // ---- Audience and Stage (Session 50) ----------------------------------------------------------------------

  const fill = display(4, 'Switcher fill', 5280);
  const key = display(5, 'Switcher key', 7200);
  /** The hall's screen, a key and fill pair for a video switcher, and the stage screen. */
  const show = () => {
    displays = [laptop, hall, stage, fill, key];
    roles = { hall: 'audience', atem: 'keyfill', stage: 'stage' };
    screens = [
      screen('hall', hall, true, 'hall'),
      screen('fill', fill, true, 'atem'),
      screen('key', key, true, 'atem'),
      screen('stage', stage, true, 'stage'),
    ];
    manager.reconcile();
  };

  it('Audience off closes every audience window, key and fill included, and only them; on opens them where they were', () => {
    show();
    expect(live()).toEqual(['hall@2', 'fill@4', 'key@5', 'stage@3']);
    expect(manager.switches()).toEqual(ALL_ON);
    expect(manager.setSwitch('audience', false)).toBe(true);
    // Their displays are the computer's again; the stage screen carries on, the same window.
    expect(live()).toEqual(['stage@3']);
    expect(opened.find((w) => w.screenId === 'stage')?.closed).toBe(false);
    expect(manager.switches()).toEqual({ audience: false, stage: true });
    // Off on purpose, never "display not connected": each still knows its display.
    expect(manager.status()).toEqual([
      { screenId: 'hall', state: 'switched-off', displayId: 2 },
      { screenId: 'fill', state: 'switched-off', displayId: 4 },
      { screenId: 'key', state: 'switched-off', displayId: 5 },
      { screenId: 'stage', state: 'showing', displayId: 3 },
    ]);
    expect(manager.windows().map((w) => w.screenId)).toEqual(['stage']);
    // Off again changes nothing.
    const before = changes;
    expect(manager.setSwitch('audience', false)).toBe(false);
    expect(changes).toBe(before);
    // Still off through any other change (a display's resolution, a screen setting): nothing reopens them.
    manager.reconcile();
    expect(live()).toEqual(['stage@3']);
    // On: a new window on each one's own display.
    expect(manager.setSwitch('audience', true)).toBe(true);
    expect(live()).toEqual(['stage@3', 'hall@2', 'fill@4', 'key@5']);
    expect(opened).toHaveLength(7);
    expect(manager.status().map((st) => st.state)).toEqual(['showing', 'showing', 'showing', 'showing']);
    // The screens were never changed: nothing about them was saved.
    expect(saved).toEqual([]);
  });

  // Session 55: Stage off no longer gives the stage's displays back to the computer; its screens stay, and show
  // exactly the audience picture (render/StageScreen.tsx), from the engine's state.
  it('Stage off keeps every window, the stage’s the same ones, showing; each switch is on and off on its own', () => {
    show();
    const before = opened.length;
    expect(manager.setSwitch('stage', false)).toBe(true);
    expect(live()).toEqual(['hall@2', 'fill@4', 'key@5', 'stage@3']);
    expect(opened).toHaveLength(before);
    expect(opened.find((w) => w.screenId === 'stage')?.closed).toBe(false);
    expect(manager.status()[3]).toEqual({ screenId: 'stage', state: 'showing', displayId: 3 });
    expect(manager.switches()).toEqual({ audience: true, stage: false });
    manager.setSwitch('audience', false);
    expect(live()).toEqual(['stage@3']);
    expect(manager.switches()).toEqual({ audience: false, stage: false });
    manager.setSwitch('stage', true);
    expect(live()).toEqual(['stage@3']);
    expect(opened).toHaveLength(before);
    expect(manager.switches()).toEqual({ audience: false, stage: true });
  });

  it('a switched-off screen keeps its other states first: off (saved), or no display', () => {
    show();
    screens = [screen('hall', hall, false, 'hall'), screen('spare', null, true, 'hall'), ...screens.slice(1)];
    manager.setSwitch('audience', false);
    expect(manager.status().slice(0, 2)).toEqual([
      { screenId: 'hall', state: 'disabled', displayId: null },
      { screenId: 'spare', state: 'unassigned', displayId: null },
    ]);
    // A switched-off screen whose display is not connected says so when it is on again, not before.
    displays = [laptop, stage, fill, key];
    screens = [screen('hall', hall, true, 'hall'), ...screens.slice(2)];
    manager.reconcile();
    expect(manager.status()[0]).toEqual({ screenId: 'hall', state: 'switched-off', displayId: null });
    manager.setSwitch('audience', true);
    expect(manager.status()[0]).toEqual({ screenId: 'hall', state: 'missing-display', displayId: null });
  });

  it('an output held through a display drop closes at once when its switch goes off, and nothing opens it while off', () => {
    show();
    displays = [laptop, stage, fill, key];
    manager.reconcile();
    const hallWindow = opened.find((w) => w.screenId === 'hall');
    expect(hallWindow?.hidden).toBe(true);
    expect(hallWindow?.closed).toBe(false);
    manager.setSwitch('audience', false);
    expect(hallWindow?.closed).toBe(true);
    // Its display back, and the grace over: still off.
    displays = [laptop, hall, stage, fill, key];
    advance(DISPLAY_DROP_MS);
    manager.reconcile();
    expect(live()).toEqual(['stage@3']);
    expect(manager.status()[0]).toEqual({ screenId: 'hall', state: 'switched-off', displayId: 2 });
  });

  it('a window the watchdog gave up on, switched off, starts afresh when on again: Try again never fights the switch', () => {
    show();
    manager.setStopped('hall', true);
    expect(manager.status()[0]?.state).toBe('stopped');
    manager.setSwitch('audience', false);
    expect(manager.status()[0]?.state).toBe('switched-off');
    // A late word from the watchdog about the closed window changes nothing.
    manager.setStopped('hall', true);
    expect(manager.status()[0]?.state).toBe('switched-off');
    expect(live()).toEqual(['stage@3']);
    manager.setSwitch('audience', true);
    expect(manager.status()[0]).toEqual({ screenId: 'hall', state: 'showing', displayId: 2 });
  });

  it('a group given another role follows its new switch at once', () => {
    show();
    manager.setSwitch('audience', false);
    roles = { ...roles, hall: 'stage' };
    manager.reconcile();
    expect(live()).toEqual(['stage@3', 'hall@2']);
  });

  it('remembers nothing: a manager made at the next start has both on', () => {
    show();
    manager.setSwitch('audience', false);
    manager.setSwitch('stage', false);
    const next = new OutputManager({
      listDisplays: () => displays,
      screens: () => screens,
      saveDisplayKey: () => undefined,
      openWindow: (s, d) => new FakeWindow(s.id, d.id),
      onChange: () => undefined,
      switchOf: (s) => switchFor(roles[s.groupId] ?? 'audience'),
    });
    expect(next.switches()).toEqual(ALL_ON);
    next.reconcile();
    expect(next.windows().map((w) => w.screenId)).toEqual(['hall', 'fill', 'key', 'stage']);
  });

  // alpha.22: Stage starts as it was left (off on a new library), told to the manager as it is made.
  it('a manager made with Stage off has it off from the start; its stage screens open all the same, Audience on', () => {
    show();
    const next = new OutputManager({
      listDisplays: () => displays,
      screens: () => screens,
      saveDisplayKey: () => undefined,
      openWindow: (s, d) => new FakeWindow(s.id, d.id),
      onChange: () => undefined,
      switchOf: (s) => switchFor(roles[s.groupId] ?? 'audience'),
      startsOff: ['stage'],
    });
    expect(next.switches()).toEqual({ audience: true, stage: false });
    next.reconcile();
    expect(next.windows().map((w) => w.screenId)).toEqual(['hall', 'fill', 'key', 'stage']);
    expect(next.setSwitch('stage', true)).toBe(true);
    expect(next.switches()).toEqual(ALL_ON);
  });

  it('closeAll closes what is open, switched off or not', () => {
    show();
    manager.setSwitch('stage', false);
    manager.closeAll();
    expect(live()).toEqual([]);
  });
});

/*
 * Drashti quitting (QA24-QUITRACE-1; Windows CI run a22-pippreview-1126-152423-56400, wallpapers.spec.ts:154): the
 * start's reading of the displays' own identities ended 16 ms after "Quitting", and its reconcile found the output
 * window the quit had just closed and opened it again. Electron's quit closes only the windows open as it began, and
 * app.quit() again does nothing while it quits: the new window kept Drashti running, and the quit never ended.
 */
describe('OutputManager as Drashti quits (QA24-QUITRACE-1)', () => {
  it('once the quit has begun, the window the quit closed is never opened again', () => {
    screens = [screen('audience', hall)];
    manager.reconcile();
    manager.quitting();
    // Electron's quit closes the window; the display reading that ends now reconciles.
    opened[0]?.close();
    manager.reconcile();
    expect(opened).toHaveLength(1);
    expect(live()).toEqual([]);
  });

  it('once the quit has begun, nothing opens or is put back: a display plugged in or back, a screen turned on, Audience on, a window drawing again', () => {
    screens = [screen('audience', hall), screen('stage', stage), screen('spare', laptop, false)];
    manager.reconcile();
    expect(live()).toEqual(['audience@2', 'stage@3']);
    // The hall's display drops (its window held, hidden); Audience is turned off; the stage's window is given up on.
    displays = [laptop, stage];
    manager.reconcile();
    const held = opened[0];
    expect(held?.hidden).toBe(true);
    manager.setStopped('stage', true);
    manager.quitting();
    // The quit closes the stage's window.
    opened[1]?.close();
    // The hall's display back: its window is not shown again.
    displays = [laptop, hall, stage];
    manager.reconcile();
    expect(held?.hidden).toBe(true);
    expect(putBack).toEqual([]);
    // A screen turned on, Audience off and on, the stage's page drawing again: nothing opens.
    screens = [screen('audience', hall), screen('stage', stage), screen('spare', laptop)];
    manager.reconcile();
    manager.setSwitch('audience', false);
    manager.setSwitch('audience', true);
    manager.setStopped('stage', false);
    // The held window's grace ends: it closes, and nothing opens after it.
    advance(DISPLAY_DROP_MS);
    expect(opened).toHaveLength(2);
    expect(live()).toEqual([]);
  });

  it('after closeAll (the quit’s last stop, and as LIVE’s window closes in a quit), nothing opens again, and a window opened in the gap is closed', () => {
    screens = [screen('audience', hall), screen('stage', stage)];
    manager.reconcile();
    // The quit closes both; a reconcile before the manager is told opens one again (the gap).
    opened[0]?.close();
    opened[1]?.close();
    manager.reconcile();
    expect(live()).toEqual(['audience@2', 'stage@3']);
    // closeAll closes the windows opened in the gap...
    manager.closeAll();
    expect(live()).toEqual([]);
    // ...and a display change noticed after it (Session 23: as Drashti quits) opens nothing.
    displays = [laptop, hall];
    manager.reconcile();
    displays = [laptop, hall, stage];
    manager.reconcile();
    expect(opened).toHaveLength(4);
    expect(live()).toEqual([]);
  });
});
