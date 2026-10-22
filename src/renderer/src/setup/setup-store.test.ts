import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayInfo, ScreenGroupConfig, ScreensSnapshot, ScreenStatus } from '../../../shared/screens';

/*
 * Set Up Screens… and Keep these screens? (Session 50): what each display shows, whether what Done or Finish set
 * was kept as the question goes, and the wizard at its displays again, the choices as made, when it went back.
 */

const display = (id: number): DisplayInfo => ({
  id,
  label: `Placeholder display ${String(id)}`,
  bounds: { x: 0, y: 0, width: 1024, height: 768 },
  workArea: { x: 0, y: 0, width: 1024, height: 768 },
  scaleFactor: 1,
  pixelWidth: 1024,
  pixelHeight: 768,
  refreshHz: 60,
  rotation: 0,
  internal: false,
  primary: id === 1,
  key: {
    id,
    label: `Placeholder display ${String(id)}`,
    pixelWidth: 1024,
    pixelHeight: 768,
    x: 0,
    y: 0,
    internal: false,
  },
});

const group = (id: string, role: ScreenGroupConfig['role'], screens: string[]): ScreenGroupConfig => ({
  id,
  name: id,
  role,
  screens: screens.map((s) => ({
    id: s,
    groupId: id,
    name: s,
    displayKey: null,
    canvasWidth: 1920,
    canvasHeight: 1080,
    scaling: 'fit',
    enabled: true,
    feed: null,
    nodeId: null,
  })),
});

const showing = (screenId: string, displayId: number): ScreenStatus => ({
  screenId,
  state: 'showing',
  displayId,
});

/** Display 1 the controls', 2 the hall's, 3 the stage's. */
const after: ScreensSnapshot = {
  displays: [display(1), display(2), display(3)],
  groups: [group('hall', 'audience', ['s2']), group('stage', 'stage', ['s3']), group('stream', 'stream', [])],
  status: [showing('s2', 2), showing('s3', 3)],
  nodes: [],
};
/** As it was before: nothing shown anywhere. */
const before: ScreensSnapshot = { ...after, groups: [group('stream', 'stream', [])], status: [] };

/** The main process, as far as the wizard asks it after going back: where the controls are now. */
function controlsNowOn(displayId: number): void {
  (globalThis as { window?: unknown }).window = {
    drashti: {
      setup: {
        state: () => Promise.resolve({ operatorDisplayId: displayId, controlsDisplayId: displayId }),
      },
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** Fresh stores (each connects once per page). */
async function fresh() {
  vi.resetModules();
  return {
    setup: await import('./setup-store'),
    screens: await import('../screens/screens-store'),
    keep: await import('../operator/keep-screens-store'),
  };
}

describe('Set Up Screens… and Keep these screens?', () => {
  it('reads what each display shows from the screens as they are', async () => {
    const { setup } = await fresh();
    expect(setup.usesOf(after)).toEqual({ 1: 'none', 2: 'audience', 3: 'stage' });
    expect(setup.usesOf(before)).toEqual({ 1: 'none', 2: 'none', 3: 'none' });
    // A key and fill pair, or a screen turned off.
    const keyfill = { ...after, groups: [group('hall', 'keyfill', ['s2'])], status: [showing('s2', 2)] };
    expect(setup.usesOf(keyfill)).toEqual({ 1: 'none', 2: 'audience', 3: 'none' });
    const off = { ...after, status: [{ screenId: 's2', state: 'disabled' as const, displayId: null }] };
    expect(setup.usesOf(off)).toEqual({ 1: 'none', 2: 'none', 3: 'none' });
  });

  it('kept: as this window answered, or else whether every display shows what was chosen', async () => {
    const { setup } = await fresh();
    const applied = { 1: 'none', 2: 'audience', 3: 'stage' } as const;
    expect(setup.screensKept(applied, setup.usesOf(after), null)).toBe(true);
    expect(setup.screensKept(applied, setup.usesOf(before), null)).toBe(false);
    // Answered here: Keep, even with an output turned off since (Uncover); Go back, whatever the screens show.
    expect(setup.screensKept(applied, setup.usesOf(before), 'kept')).toBe(true);
    expect(setup.screensKept(applied, setup.usesOf(after), 'went-back')).toBe(false);
  });

  it('gone back: the wizard is at its displays again, with the choices as made, and says why', async () => {
    const { setup, screens, keep } = await fresh();
    setup.watchKeepScreens();
    const chosen = {
      1: { use: 'audience' as const, languages: null },
      2: { use: 'audience' as const, languages: null },
      3: { use: 'stage' as const, languages: ['gu' as const] },
    };
    setup.useSetup.setState({
      open: true,
      step: setup.STEPS.indexOf('Finish'),
      operatorDisplayId: 1,
      controlsDisplayId: 1,
      outputs: chosen,
      applied: { 1: 'audience', 2: 'audience', 3: 'stage' },
      finished: { tested: 3 },
    });
    // The controls moved off the output put on their display (to display 3, free then), and stay there.
    controlsNowOn(3);
    keep.useKeepScreens.setState({ pending: { deadline: 1, coversControls: true } });
    // Nothing pressed: the main process put the screens back, then said the question went.
    screens.useScreens.setState({ snapshot: before });
    keep.useKeepScreens.setState({ pending: null });
    expect(setup.useSetup.getState()).toMatchObject({
      step: setup.STEPS.indexOf('Screens'),
      finished: null,
      wentBack: true,
      applied: null,
      outputs: chosen,
    });
    // Marked where the controls are now.
    await vi.waitFor(() => {
      expect(setup.useSetup.getState()).toMatchObject({ operatorDisplayId: 3, controlsDisplayId: 3 });
    });
    // Choosing again puts the note away.
    setup.chooseOutput(1, { use: 'none' });
    expect(setup.useSetup.getState().wentBack).toBe(false);
  });

  // Done's answer can reach the window before the main process's word that the question is waiting (two
  // messages): the wizard then asks it, and still goes back to its displays when the change goes back.
  it('Done answered before the question is heard here: asked, watched, and gone back to the displays', async () => {
    const { setup, screens, keep } = await fresh();
    (globalThis as { window?: unknown }).window = {
      drashti: {
        setup: {
          finish: () => Promise.resolve({ ok: true, snapshot: after, tested: 2 }),
          state: () => Promise.resolve({ operatorDisplayId: 1, controlsDisplayId: 1 }),
        },
        screens: { pending: () => Promise.resolve({ deadline: 5, coversControls: false }) },
      },
    };
    setup.useSetup.setState({
      open: true,
      step: setup.STEPS.indexOf('Screens'),
      displays: [display(1), display(2), display(3)],
      outputs: {
        1: { use: 'none', languages: null },
        2: { use: 'audience', languages: null },
        3: { use: 'stage', languages: null },
      },
    });
    await setup.finishScreens();
    expect(setup.useSetup.getState().applied).toEqual({ 1: 'none', 2: 'audience', 3: 'stage' });
    // The question is heard now, and goes back.
    keep.useKeepScreens.setState({ pending: { deadline: 5, coversControls: false } });
    screens.useScreens.setState({ snapshot: before });
    keep.useKeepScreens.setState({ pending: null, answered: 'went-back' });
    expect(setup.useSetup.getState()).toMatchObject({
      step: setup.STEPS.indexOf('Screens'),
      finished: null,
      wentBack: true,
    });
  });

  it('kept: Done stays done; with no question waiting, nothing is watched', async () => {
    const { setup, screens, keep } = await fresh();
    setup.watchKeepScreens();
    setup.useSetup.setState({
      open: true,
      step: setup.STEPS.indexOf('Screens'),
      applied: { 1: 'none', 2: 'audience', 3: 'stage' },
      finished: { tested: 2 },
    });
    keep.useKeepScreens.setState({ pending: { deadline: 1, coversControls: false } });
    screens.useScreens.setState({ snapshot: after });
    keep.useKeepScreens.setState({ pending: null, answered: 'kept' });
    expect(setup.useSetup.getState()).toMatchObject({
      finished: { tested: 2 },
      wentBack: false,
      applied: null,
    });
    // Another question that ends, the wizard not waiting on it: nothing changes.
    keep.useKeepScreens.setState({ pending: { deadline: 2, coversControls: false }, answered: null });
    screens.useScreens.setState({ snapshot: before });
    keep.useKeepScreens.setState({ pending: null });
    expect(setup.useSetup.getState()).toMatchObject({ finished: { tested: 2 }, wentBack: false });
  });
});
