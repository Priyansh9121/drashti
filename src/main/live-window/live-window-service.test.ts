import { describe, expect, it } from 'vitest';
import type { WebFrameMain } from 'electron';
import type { BackgroundLayer } from '../../shared/engine/state';
import type { LiveWindowStatus } from '../../shared/live-window';
import { ASK_MS, type ListedSource, LiveWindowService, type WindowSources } from './live-window-service';

/*
 * Show a Window… (Session 48) in the main process: what the picker may offer and put up, the notice's
 * "closed or hidden", and which pages may capture the window.
 */

const meeting: ListedSource = {
  id: 'window:4021:0',
  name: 'Placeholder meeting',
  picture: 'data:image/png;base64,',
};
const own: ListedSource = { id: 'window:12:0', name: 'Drashti', picture: null };
const display: ListedSource = { id: 'screen:0:0', name: 'Entire screen', picture: null };

function setup(options: { access?: ReturnType<WindowSources['access']>; fail?: boolean } = {}) {
  let background: BackgroundLayer | null = null;
  let open = true;
  let clock = 1000;
  const statuses: LiveWindowStatus[] = [];
  const grants: string[] = [];
  const sources: WindowSources = {
    access: () => options.access ?? 'granted',
    askAccess: () => Promise.resolve(),
    list: () =>
      options.fail ? Promise.reject(new Error('no list')) : Promise.resolve([display, own, meeting]),
    ownIds: () => new Set([own.id]),
    isOpen: () => Promise.resolve(open),
    grant: (id) => {
      grants.push(id);
      return { id, name: 'x' };
    },
  };
  const service = new LiveWindowService({
    sources,
    showWindow: (w) => {
      background = { kind: 'window', ...w, startedAt: ++clock };
      return { ok: true, changed: true, rev: 1 };
    },
    background: () => background,
    changed: (s) => statuses.push(s),
    log: () => undefined,
    now: () => clock,
    pollMs: 60_000,
  });
  return {
    service,
    statuses,
    grants,
    clear: () => {
      background = null;
    },
    setOpen: (o: boolean) => {
      open = o;
    },
    tick: (ms: number) => {
      clock += ms;
    },
    get background() {
      return background;
    },
  };
}

const frame = (processId: number, routingId: number) => ({ processId, routingId }) as WebFrameMain;

describe('Show a Window… in the main process', () => {
  it('offers only other apps’ windows, with their pictures; macOS’s permission first; a failed list says so', async () => {
    const t = setup();
    expect(await t.service.list()).toEqual({
      ok: true,
      windows: [{ id: meeting.id, name: meeting.name, picture: meeting.picture }],
    });
    expect(await setup({ access: 'denied' }).service.list()).toMatchObject({
      ok: false,
      reason: 'permission',
    });
    expect(await setup({ access: 'not-determined' }).service.list()).toMatchObject({ reason: 'permission' });
    expect(await setup({ fail: true }).service.list()).toMatchObject({ ok: false, reason: 'unlisted' });
  });

  it('puts up only a window it just offered: never a display, Drashti’s own, or one never listed', async () => {
    const t = setup();
    expect(t.service.show(meeting.id)).toMatchObject({ ok: false });
    await t.service.list();
    for (const id of [display.id, own.id, 'window:999:0'])
      expect(t.service.show(id)).toMatchObject({ ok: false });
    expect(t.background).toBeNull();
    expect(t.service.show(meeting.id)).toEqual({ ok: true });
    expect(t.background).toMatchObject({ kind: 'window', sourceId: meeting.id, name: meeting.name });
    expect(t.statuses.at(-1)).toEqual({ state: 'showing', name: meeting.name });
  });

  it('says when the window was closed or hidden, and stops saying it when it is open again or taken off', async () => {
    const t = setup();
    await t.service.list();
    t.service.show(meeting.id);
    t.setOpen(false);
    await t.service.look();
    expect(t.service.current()).toEqual({ state: 'gone', name: meeting.name });
    t.setOpen(true);
    await t.service.look();
    expect(t.service.current()).toEqual({ state: 'showing', name: meeting.name });
    t.clear();
    t.service.follow();
    expect(t.service.current()).toEqual({ state: 'off', name: null });
    expect(t.statuses.map((s) => s.state)).toEqual(['showing', 'gone', 'showing', 'off']);
    t.service.close();
  });

  it('gives the window to a page’s capture only after that page asked for the window up now, once', async () => {
    const t = setup();
    const output = frame(7, 1);
    // Nothing up: nothing to ask for, nothing given.
    expect(t.service.ask(output, meeting.id)).toBe(false);
    expect(t.service.grantFor(output)).toBeNull();
    await t.service.list();
    t.service.show(meeting.id);
    // Another window than the one up, or no frame: refused.
    expect(t.service.ask(output, 'window:5:0')).toBe(false);
    expect(t.service.ask(null, meeting.id)).toBe(false);
    expect(t.service.ask(output, meeting.id)).toBe(true);
    // Chromium's permission for it, to that page only (the grant itself is what decides what it gets).
    expect(t.service.mayCapture(output)).toBe(true);
    expect(t.service.mayCapture(frame(8, 1))).toBe(false);
    // Another page that never asked gets nothing.
    expect(t.service.grantFor(frame(8, 1))).toBeNull();
    expect(t.service.grantFor(output)).not.toBeNull();
    expect(t.service.grantFor(output)).toBeNull();
    expect(t.grants).toEqual([meeting.id]);
    // An ask too long ago is not honoured.
    t.service.ask(output, meeting.id);
    t.tick(ASK_MS + 1);
    expect(t.service.grantFor(output)).toBeNull();
    t.service.close();
  });
});
