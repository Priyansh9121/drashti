import { beforeEach, describe, expect, it } from 'vitest';
import type { DisplayInfo, DisplayKey, ScreenConfig } from '../../shared/screens';
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

const screen = (id: string, d: DisplayInfo | null, enabled = true): ScreenConfig => ({
  id,
  groupId: 'g',
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
});
