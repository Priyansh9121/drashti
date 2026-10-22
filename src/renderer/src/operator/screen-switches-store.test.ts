import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import type { ScreenSwitch, ScreenSwitches, ScreenSwitchResult } from '../../../shared/screen-switches';
import type { ScreensSnapshot, ScreenState } from '../../../shared/screens';
import type * as SwitchStore from './screen-switches-store';

/*
 * Audience and Stage as the operator window keeps them (Session 50): turning one off asks first while its
 * screens show something, and otherwise goes straight to the main process; on never asks; Simple Mode's key
 * only turns one on. The main process is stood in for by a fake bridge; placeholder screens only.
 */

interface Fake {
  store: typeof SwitchStore;
  turns: [ScreenSwitch, boolean][];
  change: (switches: ScreenSwitches) => void;
  /** What the next turn answers (a refusal, say); otherwise it turns. */
  refuse: { message: string } | null;
}

async function connected(): Promise<Fake> {
  vi.resetModules();
  const now: ScreenSwitches = { audience: true, stage: true };
  let listener: (switches: ScreenSwitches) => void = () => undefined;
  const fake: Omit<Fake, 'store'> = { turns: [], change: (s) => listener(s), refuse: null };
  (globalThis as { window?: unknown }).window = {
    drashti: {
      screenSwitches: {
        get: () => Promise.resolve({ ...now }),
        onChanged: (l: (switches: ScreenSwitches) => void) => {
          listener = l;
          return () => undefined;
        },
        turn: (which: ScreenSwitch, on: boolean): Promise<ScreenSwitchResult> => {
          fake.turns.push([which, on]);
          if (fake.refuse) return Promise.resolve({ ok: false, message: fake.refuse.message });
          now[which] = on;
          return Promise.resolve({ ok: true, switches: { ...now } });
        },
      },
    },
  };
  const store = await import('./screen-switches-store');
  store.connectScreenSwitches();
  await vi.waitFor(() => {
    expect(store.useScreenSwitches.getState().known).toBe(true);
  });
  // The same object the bridge reads, so a test's `refuse` reaches it.
  return Object.assign(fake, { store });
}

/** This window's copy of the screens: a hall screen and a stage screen, in these states. */
async function screensAre(hall: ScreenState, stage: ScreenState): Promise<void> {
  const { useScreens } = await import('../screens/screens-store');
  const screen = (id: string, groupId: string) => ({
    id,
    groupId,
    name: id,
    displayKey: null,
    canvasWidth: 1920,
    canvasHeight: 1080,
    scaling: 'fit' as const,
    enabled: true,
    feed: null,
    nodeId: null,
  });
  const snapshot: ScreensSnapshot = {
    displays: [],
    nodes: [],
    groups: [
      { id: 'hall', name: 'Main Hall', role: 'audience', screens: [screen('hall-1', 'hall')] },
      { id: 'stage', name: 'Stage', role: 'stage', screens: [screen('stage-1', 'stage')] },
    ],
    status: [
      { screenId: 'hall-1', state: hall, displayId: 2 },
      { screenId: 'stage-1', state: stage, displayId: 3 },
    ],
  };
  useScreens.setState({ snapshot });
}

/** This window's copy of the show: nothing up, or black-out on. */
async function showIs(blackout: boolean): Promise<void> {
  const { useEngine } = await import('../engine/engine-store');
  useEngine.setState({ state: { ...initialEngineState(), blackout }, rev: 1 });
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('Audience and Stage in the operator window (Session 50)', () => {
  it('knows them from the main process, and follows each change it tells', async () => {
    const { store, change } = await connected();
    expect(store.useScreenSwitches.getState().switches).toEqual({ audience: true, stage: true });
    change({ audience: false, stage: true });
    expect(store.useScreenSwitches.getState().switches).toEqual({ audience: false, stage: true });
  });

  it('asks first while the hall’s screens show something: Cancel changes nothing, Turn off turns it off', async () => {
    const fake = await connected();
    await screensAre('showing', 'showing');
    await showIs(true);
    expect(await fake.store.toggleSwitch('audience')).toBeNull();
    expect(fake.store.useScreenSwitches.getState().asking).toBe('audience');
    expect(fake.turns).toEqual([]);
    // Asked once: pressed again while it asks, nothing more.
    await fake.store.toggleSwitch('audience');
    await fake.store.toggleSwitch('stage');
    expect(fake.turns).toEqual([]);
    fake.store.cancelAsk();
    expect(fake.store.useScreenSwitches.getState().asking).toBeNull();
    expect(fake.turns).toEqual([]);
    await fake.store.toggleSwitch('audience');
    expect(await fake.store.confirmAsk()).toBeNull();
    expect(fake.turns).toEqual([['audience', false]]);
    expect(fake.store.useScreenSwitches.getState()).toMatchObject({
      asking: null,
      switches: { audience: false, stage: true },
    });
  });

  it('turns one off at once while its screens show nothing, or none is open; on never asks', async () => {
    const fake = await connected();
    await screensAre('showing', 'missing-display');
    await showIs(false);
    await fake.store.toggleSwitch('audience');
    await fake.store.toggleSwitch('stage');
    expect(fake.store.useScreenSwitches.getState().asking).toBeNull();
    expect(fake.turns).toEqual([
      ['audience', false],
      ['stage', false],
    ]);
    await showIs(true);
    await fake.store.toggleSwitch('audience');
    expect(fake.turns.at(-1)).toEqual(['audience', true]);
  });

  it('asks before Stage goes off whenever a stage screen is open: it always shows the stage view', async () => {
    const fake = await connected();
    await screensAre('missing-display', 'showing');
    await showIs(false);
    await fake.store.toggleSwitch('stage');
    expect(fake.store.useScreenSwitches.getState().asking).toBe('stage');
    expect(fake.turns).toEqual([]);
  });

  it('Simple Mode’s key only turns one on', async () => {
    const fake = await connected();
    await screensAre('showing', 'showing');
    await showIs(false);
    expect(await fake.store.turnOnIfOff('audience')).toBeNull();
    expect(fake.turns).toEqual([]);
    fake.change({ audience: false, stage: true });
    await fake.store.turnOnIfOff('audience');
    expect(fake.turns).toEqual([['audience', true]]);
  });

  it('says why when the main process refuses', async () => {
    const fake = await connected();
    await screensAre('showing', 'showing');
    await showIs(false);
    fake.refuse = { message: 'Simple Mode only turns the screens on. Pro Mode turns them off.' };
    expect(await fake.store.toggleSwitch('audience')).toBe(
      'Simple Mode only turns the screens on. Pro Mode turns them off.',
    );
    expect(fake.store.useScreenSwitches.getState().switches.audience).toBe(true);
  });

  it('asks in the first moments, before this window has the screens, whatever is open (Session 51, S2-4)', async () => {
    const fake = await connected();
    await showIs(false);
    // Nothing up, as far as this window knows, and no screens known yet: asked, never turned off at once.
    await fake.store.toggleSwitch('audience');
    expect(fake.store.useScreenSwitches.getState().asking).toBe('audience');
    expect(fake.turns).toEqual([]);
    fake.store.cancelAsk();
    await fake.store.toggleSwitch('stage');
    expect(fake.store.useScreenSwitches.getState().asking).toBe('stage');
    expect(fake.turns).toEqual([]);
  });
});
