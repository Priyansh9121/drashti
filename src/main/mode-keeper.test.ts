import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessMode } from '../shared/access-protocol';
import { IPC, type InvokeChannel } from '../shared/ipc';
import {
  SIMPLE_ACCESS_REFUSAL,
  SIMPLE_MODE_REFUSAL,
  SIMPLE_MODE_REFUSED_COMMANDS,
  simpleModeRefuses,
  simpleRefusalText,
} from '../shared/mode';
import type { EngineCommand } from '../shared/engine/commands';
import { lockChannels, refusalFor, refusedNow } from './ipc/handle';
import { ModeKeeper, type ModeKeeperOptions } from './mode-keeper';
import { SIMPLE_MODE_BOUNDED, SIMPLE_MODE_LOCKED, simpleModeBounds, simpleModeRefusals } from './simple-mode';

/*
 * Access by mode (Session 55, Part 19, the owner's decision of 29 Oct 2026), in the main process: with Simple access
 * (the list's answer), Drashti is held in Simple Mode. Leaving it is refused whoever asks (the window, with the word or
 * not; the View menu; a key or a MIDI pad, which only ever reach the window's request or the engine), and so is every
 * action Simple Mode refuses (simple-mode.ts's channels: the window's and the phones' and Companion's API alike, which
 * asks refusedNow; and the engine's commands, wherever they come from). Pro access again brings Pro Mode back by
 * itself when the access put it in Simple Mode, never when the operator chose it.
 */

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

/** A keeper as index.ts makes it, the list's access a test sets. */
function keeper(o: Omit<Partial<ModeKeeperOptions>, 'access'> & { access?: AccessMode } = {}) {
  let access: AccessMode = o.access ?? 'pro';
  const saved: { mode: string; byAccess: boolean }[] = [];
  const changes: string[] = [];
  const menus = { count: 0 };
  const logs: string[] = [];
  const k = new ModeKeeper({
    saved: o.saved ?? { mode: undefined, byAccess: undefined },
    recentStop: o.recentStop ?? false,
    access: () => access,
    save: (mode, byAccess) => saved.push({ mode, byAccess }),
    changed: (mode) => changes.push(mode),
    menu: () => {
      menus.count += 1;
    },
    log: (line) => logs.push(line),
  });
  return {
    k,
    saved,
    changes,
    menus,
    logs,
    set: (a: AccessMode) => {
      access = a;
      k.accessChanged();
    },
  };
}

describe('Simple access holds Simple Mode', () => {
  it('a start with Simple access is in Simple Mode, whatever it was in before', () => {
    for (const saved of [
      { mode: 'pro', byAccess: false },
      { mode: 'simple', byAccess: false },
      { mode: undefined, byAccess: undefined },
    ]) {
      const { k } = keeper({ access: 'simple', saved });
      expect(k.mode, String(saved.mode)).toBe('simple');
      expect(k.simpleOnly()).toBe(true);
    }
  });

  it('refuses Pro Mode from the window and from the View menu, saying why', () => {
    const { k, changes } = keeper({ access: 'simple' });
    expect(k.request('pro')).toEqual({ ok: false, message: SIMPLE_ACCESS_REFUSAL });
    expect(k.menuSwitch()).toBe('refused');
    expect(k.mode).toBe('simple');
    expect(changes).toEqual([]);
    expect(SIMPLE_ACCESS_REFUSAL).toContain('Simple Mode only');
  });

  it('drops a computer in Pro Mode to Simple Mode at the answer that says Simple; Pro access again brings Pro Mode back by itself', () => {
    const { k, changes, saved, set } = keeper();
    expect(k.mode).toBe('pro');
    set('simple');
    expect(k.mode).toBe('simple');
    expect(changes).toEqual(['simple']);
    expect(saved.at(-1)).toEqual({ mode: 'simple', byAccess: true });
    set('pro');
    expect(k.mode).toBe('pro');
    expect(changes).toEqual(['simple', 'pro']);
    expect(saved.at(-1)).toEqual({ mode: 'pro', byAccess: false });
  });

  it('Simple Mode the operator chose stays Simple Mode through Simple access and back to Pro access', () => {
    const { k, set, menus } = keeper();
    expect(k.request('simple')).toEqual({ ok: true, mode: 'simple' });
    const menusBefore = menus.count;
    set('simple');
    // Its way back goes from the menu at once.
    expect(menus.count).toBeGreaterThan(menusBefore);
    expect(k.request('pro')).toMatchObject({ ok: false });
    set('pro');
    expect(k.mode).toBe('simple');
    // With Pro access, the way back is there again: a double-click on Pro Mode (Session 55, Part 18), nothing typed.
    expect(k.request('pro')).toEqual({ ok: true, mode: 'pro' });
  });

  it('remembers across a restart whether the access put it in Simple Mode', () => {
    // Stopped unexpectedly in Simple Mode that Simple access put it in: back in it, and Pro access brings Pro back.
    const after = keeper({ access: 'simple', recentStop: true, saved: { mode: 'simple', byAccess: true } });
    expect(after.k.mode).toBe('simple');
    after.set('pro');
    expect(after.k.mode).toBe('pro');
    // A clean quit, Simple access: Simple Mode by the access (a clean start is Pro Mode's), so Pro access brings Pro.
    const clean = keeper({ access: 'simple', saved: { mode: 'simple', byAccess: false } });
    clean.set('pro');
    expect(clean.k.mode).toBe('pro');
    // Stopped unexpectedly in Simple Mode the operator chose: it stays when Pro access comes.
    const chosen = keeper({ access: 'simple', recentStop: true, saved: { mode: 'simple', byAccess: false } });
    chosen.set('pro');
    expect(chosen.k.mode).toBe('simple');
  });

  it('with Pro access: Simple at once, and Pro at once with nothing typed (Session 55, Part 18: the owner’s answer to question 12, changed on 29 Oct 2026)', () => {
    const { k, changes } = keeper();
    expect(k.menuSwitch()).toBe('switched');
    expect(k.mode).toBe('simple');
    // The window's way: Pro Mode's double-click asks for Pro Mode, and gets it, with no word.
    expect(k.request('pro')).toEqual({ ok: true, mode: 'pro' });
    expect(k.request('simple')).toEqual({ ok: true, mode: 'simple' });
    // The View menu's Switch to Pro Mode switches at once too: no question in the window any more.
    expect(k.menuSwitch()).toBe('switched');
    expect(k.mode).toBe('pro');
    expect(changes).toEqual(['simple', 'pro', 'simple', 'pro']);
  });
});

describe('every way in, refused in the main process while Simple access holds Simple Mode', () => {
  afterEach(() => {
    lockChannels(() => false, new Map());
  });

  it('the window’s and the phones’ (and Companion’s) requests: every channel Simple Mode locks is refused, said truly', () => {
    const { k } = keeper({ access: 'simple' });
    lockChannels(
      () => k.mode === 'simple',
      simpleModeRefusals(
        () => ({ device: null, devices: [], ok: true }) as never,
        () => simpleRefusalText(k.simpleOnly()),
      ),
    );
    for (const channel of SIMPLE_MODE_LOCKED) {
      // The phone's API and Companion's ask the same (network-service.ts's refused).
      expect(refusedNow(channel), channel).toBe(true);
      const refusal = refusalFor(channel)?.();
      if (refusal && typeof refusal === 'object' && 'message' in refusal)
        expect((refusal as { message: string }).message, channel).toBe(simpleRefusalText(true));
    }
    // The words never offer a way to Pro Mode with Simple access; with Pro access they say the way.
    expect(simpleRefusalText(true)).not.toContain('Switch to Pro Mode');
    expect(simpleRefusalText(false)).toBe(SIMPLE_MODE_REFUSAL);
    // A channel that is not Simple Mode's to lock still runs.
    expect(refusedNow(IPC.app.getMode as InvokeChannel)).toBe(false);
  });

  it('what Simple Mode offers (Session 55, Part 18) runs only within its bounds, the same with Simple access; a phone’s request, which has none of its arguments, is refused', () => {
    const { k } = keeper({ access: 'simple' });
    const scope = {
      playlistId: 'one',
      playlistOf: (itemId: string) => (itemId === 'i-one' ? 'one' : itemId === 'i-other' ? 'other' : null),
      holdsMedia: (mediaId: string) => mediaId === 'm-in',
      holdsPresentation: () => false,
    };
    lockChannels(
      () => k.mode === 'simple',
      simpleModeRefusals(
        () => ({ device: null, devices: [], ok: true }) as never,
        () => simpleRefusalText(k.simpleOnly()),
      ),
      simpleModeBounds(() => scope),
    );
    const refused = { ok: false, message: simpleRefusalText(true) };
    expect(
      refusalFor(IPC.playlists.addItems, ['one', null, [{ kind: 'media', mediaId: 'x' }]]),
    ).toBeUndefined();
    expect(
      refusalFor(IPC.playlists.addItems, ['other', null, [{ kind: 'media', mediaId: 'x' }]])?.(),
    ).toEqual(refused);
    expect(refusalFor(IPC.playlists.removeItems, [['i-one']])).toBeUndefined();
    expect(refusalFor(IPC.playlists.removeItems, [['i-other']])?.()).toEqual(refused);
    expect(refusalFor(IPC.media.rename, ['m-in', 'Placeholder'])).toBeUndefined();
    expect(refusalFor(IPC.media.rename, ['m-out', 'Placeholder'])?.()).toEqual(refused);
    expect(refusalFor(IPC.library.importPaths, [['/placeholder/x.png']])).toBeUndefined();
    // The phones' API and Companion's ask with no arguments: refused, as before Part 18 (fail closed).
    for (const channel of SIMPLE_MODE_BOUNDED.keys()) expect(refusedNow(channel), channel).toBe(true);
  });

  it('fails closed: a lock set up without the bounds refuses Simple Mode’s offers too', () => {
    lockChannels(
      () => true,
      simpleModeRefusals(() => ({ device: null, devices: [], ok: true }) as never),
    );
    expect(refusalFor(IPC.playlists.addItems, ['one', null, [{ kind: 'media', mediaId: 'x' }]])?.()).toEqual({
      ok: false,
      message: SIMPLE_MODE_REFUSAL,
    });
    expect(refusalFor(IPC.library.importPaths, [['/placeholder/x.png']])).toBeDefined();
  });

  it('the engine’s commands Simple Mode refuses (the window, keys, MIDI, phones, Companion, nodes all reach it): refused', () => {
    const { k } = keeper({ access: 'simple' });
    for (const type of SIMPLE_MODE_REFUSED_COMMANDS) {
      const command = { type } as unknown as EngineCommand;
      expect(k.mode === 'simple' && simpleModeRefuses(command, null), type).toBe(true);
    }
  });
});
