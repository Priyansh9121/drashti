import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessState } from './gate';

/*
 * View › Access List… put together (Session 54, E4): the menu item and the window follow the gate. Only the owner's
 * computer, let in, is offered it and opens it; once it is not, the window closes at once; and while this computer
 * is not let in at all, the lock's own menu stands (the menu is never built again from here). Electron, the
 * window and the channels are stood in for; the gate is the real one, afresh for each test.
 */

const windows = vi.hoisted(() => ({ opened: 0, closed: 0 }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/placeholder' },
  dialog: {},
  net: {},
}));
vi.mock('../ipc/handle', () => ({ handle: () => undefined }));
vi.mock('./access-list-window', () => ({
  AccessListWindow: class {
    open() {
      windows.opened++;
    }
    close() {
      windows.closed++;
    }
    isPage() {
      return false;
    }
    send() {
      return undefined;
    }
    window() {
      return null;
    }
  },
}));

const state = (o: Partial<AccessState>): AccessState => ({
  phase: 'checking',
  gmail: null,
  owner: false,
  reason: null,
  stopsAt: null,
  ...o,
});

beforeEach(() => {
  vi.resetModules();
  windows.opened = 0;
  windows.closed = 0;
});

/** The gate and the Access List, loaded afresh: no listener of another test's is left on the gate. */
async function start() {
  const { setAccessState } = await import('./gate');
  const { startAccessList } = await import('./access-list-main');
  const menu = { built: 0 };
  const control = startAccessList({
    userData: '/placeholder/data',
    version: '1.0.0-alpha.13',
    workArea: () => ({ x: 0, y: 0, width: 1024, height: 645 }),
    background: () => '#000000',
    track: () => undefined,
    ownerChanged: () => {
      menu.built++;
    },
    log: () => undefined,
  });
  const set = (o: Partial<AccessState>) => {
    setAccessState(state(o));
  };
  return { control, menu, set };
}

describe('View › Access List… follows the gate', () => {
  it('is offered and opens only on the owner’s computer, let in', async () => {
    const { control, menu, set } = await start();
    expect(control.offered()).toBe(false);
    control.open();
    expect(windows.opened).toBe(0);

    set({ phase: 'in', gmail: 'placeholder.user@example.com', owner: false });
    expect(control.offered()).toBe(false);
    control.open();
    expect(windows.opened).toBe(0);
    expect(menu.built).toBe(0);

    set({ phase: 'in', gmail: 'owner.placeholder@example.com', owner: true });
    expect(control.offered()).toBe(true);
    expect(menu.built).toBe(1);
    control.open();
    expect(windows.opened).toBe(1);
    // A countdown with no answer yet is still let in: it stays open.
    const closed = windows.closed;
    set({ phase: 'warning', gmail: 'owner.placeholder@example.com', owner: true, stopsAt: 1 });
    expect(control.offered()).toBe(true);
    expect(windows.closed).toBe(closed);
    expect(menu.built).toBe(1);
  });

  it('closes the window at once when this computer stops, and leaves the menu to the lock', async () => {
    const { control, menu, set } = await start();
    set({ phase: 'in', gmail: 'owner.placeholder@example.com', owner: true });
    control.open();
    const built = menu.built;
    set({ phase: 'stopped', gmail: 'owner.placeholder@example.com', reason: 'revoked' });
    expect(control.offered()).toBe(false);
    expect(windows.closed).toBeGreaterThan(0);
    expect(menu.built).toBe(built);
    control.open();
    expect(windows.opened).toBe(1);
  });

  it('builds the menu again without it when still let in, but no longer as the owner', async () => {
    const { control, menu, set } = await start();
    set({ phase: 'in', gmail: 'owner.placeholder@example.com', owner: true });
    control.open();
    set({ phase: 'in', gmail: 'owner.placeholder@example.com', owner: false });
    expect(control.offered()).toBe(false);
    expect(windows.closed).toBeGreaterThan(0);
    expect(menu.built).toBe(2);
  });
});
