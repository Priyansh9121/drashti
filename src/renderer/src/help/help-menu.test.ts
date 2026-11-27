import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Help › Show Help (alpha.24, helpmenu): the menu bar's item kept in step with the status bar's Help switch both ways.
 * The window says how its switch stands to the main process (which ticks the item) as it starts and at every change;
 * the item chosen turns the switch as the main process asks, remembered on this computer as the switch's own click
 * is. Unit tests run without a page: the window's storage and the main process are stand-ins.
 */

/** The window's own storage, as ui/persist.ts reads it, holding Help's switch as this computer remembers it. */
function storage(helpOn: boolean | null) {
  const items = new Map<string, string>(
    helpOn === null ? [] : [['drashti.ui.help.on', JSON.stringify(helpOn)]],
  );
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

/** The main process's side of the bridge: what it was told, and a choice of the menu's item. */
function mainProcess() {
  const told: boolean[] = [];
  let chosen: ((on: boolean) => void) | null = null;
  return {
    told,
    choose: (on: boolean) => {
      chosen?.(on);
    },
    listening: () => chosen !== null,
    bridge: {
      help: (on: boolean) => {
        told.push(on);
        return Promise.resolve(null);
      },
      onHelpChosen: (listener: (on: boolean) => void) => {
        chosen = listener;
        return () => {
          chosen = null;
        };
      },
    },
  };
}

/** A new start of the operator window, on a computer remembering Help as given (null: never turned on or off). */
async function freshWindow(helpOn: boolean | null) {
  vi.resetModules();
  const local = storage(helpOn);
  vi.stubGlobal('window', { localStorage: local, sessionStorage: storage(null) });
  const store = await import('./help-store');
  const { connectHelpMenu } = await import('./help-menu');
  return { local, store, connectHelpMenu };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Help › Show Help in step with the status bar’s Help switch', () => {
  it('says how the switch stands as the window starts: off at a first start, then as this computer remembers it', async () => {
    for (const remembered of [null, false, true] as const) {
      const { connectHelpMenu } = await freshWindow(remembered);
      const main = mainProcess();
      const stop = connectHelpMenu(main.bridge);
      expect(main.told, `remembered ${String(remembered)}`).toEqual([remembered === true]);
      stop();
    }
  });

  it('says each change of the switch once, never Alt held for a look at the keys', async () => {
    const { store, connectHelpMenu } = await freshWindow(false);
    const main = mainProcess();
    const stop = connectHelpMenu(main.bridge);
    store.toggleHelp();
    store.useHelp.setState({ alt: true });
    store.useHelp.setState({ alt: false });
    store.setHelp(true);
    store.toggleHelp();
    expect(main.told).toEqual([false, true, false]);
    stop();
    // Stopped (the status bar gone): nothing more is said, and a choice of the item no longer reaches it.
    expect(main.listening()).toBe(false);
    store.toggleHelp();
    expect(main.told).toEqual([false, true, false]);
  });

  it('chosen in the menu, turns the switch as asked and remembers it on this computer, as the switch’s click does', async () => {
    const { local, store, connectHelpMenu } = await freshWindow(false);
    const main = mainProcess();
    const stop = connectHelpMenu(main.bridge);
    main.choose(true);
    expect(store.useHelp.getState().on).toBe(true);
    expect(local.items.get('drashti.ui.help.on')).toBe('true');
    // The main process is told, so the tick follows the switch.
    expect(main.told).toEqual([false, true]);
    // Asked again for what it already is (two quick choices): nothing changes.
    main.choose(true);
    expect(main.told).toEqual([false, true]);
    main.choose(false);
    expect(store.useHelp.getState().on).toBe(false);
    expect(local.items.get('drashti.ui.help.on')).toBe('false');
    expect(main.told).toEqual([false, true, false]);
    stop();
  });
});
