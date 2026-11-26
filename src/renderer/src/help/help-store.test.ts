import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Help on demand (alpha.24, the owner's "too congusted all around"): one Help switch, off to begin with and remembered
 * on this computer, shows every ? and the keys beside the buttons' words; Alt (Option on a Mac) held down on its own
 * shows the keys while it is. Unit tests run without a page: the window's storage and its events are stand-ins.
 */

/** The window's own storage, as ui/persist.ts reads it. */
function storage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** The store as a new start of the operator window meets it, on a computer with this storage. */
async function freshStore(local: Storage) {
  vi.resetModules();
  vi.stubGlobal('window', { localStorage: local, sessionStorage: storage() });
  return import('./help-store');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The keys held with it. */
interface Held {
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

/** A key's parts and the keys held with it, as a key or pointer event carries them. */
const keyParts = (key: string, mods: Held = {}) => ({
  key,
  altKey: mods.alt ?? false,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
});

/** A key or pointer event's parts, as the window's listeners get them. */
const press = (type: string, key: string, mods: Held = {}) => ({ type, ...keyParts(key, mods) });

describe('the Help switch', () => {
  it('is off at a first start, and remembered on this computer once turned on or off', async () => {
    const local = storage();
    const first = await freshStore(local);
    expect(first.useHelp.getState().on).toBe(false);
    first.setHelp(true);
    expect(first.useHelp.getState().on).toBe(true);
    expect(local.getItem('drashti.ui.help.on')).toBe('true');
    // Drashti started again on this computer: still on.
    const again = await freshStore(local);
    expect(again.useHelp.getState().on).toBe(true);
    again.toggleHelp();
    expect(again.useHelp.getState().on).toBe(false);
    expect((await freshStore(local)).useHelp.getState().on).toBe(false);
    // Another computer (nothing kept) starts with it off; so does one whose storage cannot be read.
    expect((await freshStore(storage())).useHelp.getState().on).toBe(false);
    const broken = storage();
    broken.setItem('drashti.ui.help.on', 'not a yes or no');
    expect((await freshStore(broken)).useHelp.getState().on).toBe(false);
  });

  it('counts each time it is turned on, so a ? card left open does not come back open with it', async () => {
    const help = await freshStore(storage());
    const round = () => help.useHelp.getState().round;
    const before = round();
    help.setHelp(true);
    expect(round()).toBe(before + 1);
    help.setHelp(true);
    expect(round()).toBe(before + 1);
    help.setHelp(false);
    help.setHelp(true);
    expect(round()).toBe(before + 2);
  });

  it('shows the buttons’ keys while Help is on or Alt is held, and only then', async () => {
    const { keysShown } = await freshStore(storage());
    expect(keysShown({ on: false, alt: false, round: 0 })).toBe(false);
    expect(keysShown({ on: true, alt: false, round: 1 })).toBe(true);
    expect(keysShown({ on: false, alt: true, round: 0 })).toBe(true);
    expect(keysShown({ on: true, alt: true, round: 1 })).toBe(true);
  });
});

describe('Alt held on its own', () => {
  it('starts with Alt’s own press, with no other key held, and ends when it is let go', async () => {
    const { altAfter } = await freshStore(storage());
    expect(altAfter(false, press('keydown', 'Alt', { alt: true }))).toBe(true);
    // A held Alt says so again and again on Windows: still held.
    expect(altAfter(true, press('keydown', 'Alt', { alt: true }))).toBe(true);
    expect(altAfter(true, press('keyup', 'Alt'))).toBe(false);
  });

  it('is not Alt on its own with Ctrl, Cmd or Shift, or once another key is pressed with it (a shortcut such as Alt+1)', async () => {
    const { altAfter } = await freshStore(storage());
    expect(altAfter(false, press('keydown', 'Alt', { alt: true, ctrl: true }))).toBe(false);
    expect(altAfter(false, press('keydown', 'Alt', { alt: true, meta: true }))).toBe(false);
    expect(altAfter(false, press('keydown', 'Alt', { alt: true, shift: true }))).toBe(false);
    expect(altAfter(true, press('keydown', '1', { alt: true }))).toBe(false);
    expect(altAfter(true, press('keydown', 'Shift', { alt: true, shift: true }))).toBe(false);
    // AltGr (Ctrl+Alt on Windows) types a letter: never the keys.
    expect(altAfter(false, press('keydown', 'AltGraph', { alt: true, ctrl: true }))).toBe(false);
    // Another key let go changes nothing.
    expect(altAfter(true, press('keyup', 'Shift', { alt: true }))).toBe(true);
    expect(altAfter(false, press('keyup', '1', { alt: true }))).toBe(false);
  });

  it('ends when a pointer moves or presses without Alt (Alt was let go in another window), never starts from one', async () => {
    const { altAfter } = await freshStore(storage());
    expect(altAfter(true, press('pointermove', '', { alt: true }))).toBe(true);
    expect(altAfter(true, press('pointermove', ''))).toBe(false);
    expect(altAfter(true, press('pointerdown', ''))).toBe(false);
    expect(altAfter(false, press('pointerdown', '', { alt: true }))).toBe(false);
  });
});

/** The operator window as connectKeyHints sees it: its events, and its root's attributes. */
function windowStandIn() {
  const target = new EventTarget();
  const dataset: Record<string, string> = {};
  const win = Object.assign(target, { document: { documentElement: { dataset } } });
  const send = (type: string, parts: Record<string, unknown> = {}) => {
    target.dispatchEvent(Object.assign(new Event(type), parts));
  };
  return { win: win as unknown as Window, dataset, send };
}

describe('the window’s root says when the buttons’ keys are hidden', () => {
  it('hidden at rest; shown while Alt is held on its own or Help is on; as before once it stops', async () => {
    const help = await freshStore(storage());
    const { win, dataset, send } = windowStandIn();
    const stop = help.connectKeyHints(win);
    const hidden = () => 'keysHidden' in dataset;
    expect(hidden()).toBe(true);
    send('keydown', keyParts('Alt', { alt: true }));
    expect(hidden()).toBe(false);
    send('keyup', keyParts('Alt'));
    expect(hidden()).toBe(true);
    // The window losing the keyboard while Alt is held (Alt+Tab to another program): hidden again.
    send('keydown', keyParts('Alt', { alt: true }));
    expect(hidden()).toBe(false);
    send('blur');
    expect(hidden()).toBe(true);
    help.setHelp(true);
    expect(hidden()).toBe(false);
    help.setHelp(false);
    expect(hidden()).toBe(true);
    stop();
    // Stopped (the status bar gone): the keys show as they did before alpha.24, and Alt is no longer followed.
    expect(hidden()).toBe(false);
    send('keydown', keyParts('Alt', { alt: true }));
    expect(help.useHelp.getState().alt).toBe(false);
    help.setHelp(false);
    expect(hidden()).toBe(false);
  });
});
