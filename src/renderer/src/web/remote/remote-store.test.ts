import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState } from '../../../../shared/engine/state';
import type { NetworkChange } from '../../../../shared/network';
import type { RemoteSimple } from '../../../../shared/network-phone';
import type { PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import type * as RemoteStore from './remote-store';

const feed = vi.hoisted(() => ({ changed: [] as ((what: NetworkChange) => void)[] }));
vi.mock('../feed', () => ({
  onOnline: () => () => undefined,
  onListsChanged: (listener: (what: NetworkChange) => void) => {
    feed.changed.push(listener);
    return () => undefined;
  },
}));

let remote: typeof RemoteStore;
let replies: ((response: Response) => void)[];
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const simple: RemoteSimple = { playlistId: 'one', words: 'Placeholder Simple Mode explanation' };
const answer = (mode: RemoteSimple | null, groupId = 'hall') =>
  new Response(
    JSON.stringify({
      ok: true,
      groupId,
      clock: { locale: 'en-GB', timeZone: 'Europe/London' },
      simple: mode,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
const changed = (what: NetworkChange) => {
  for (const listener of feed.changed) listener(what);
};
const reply = (at: number, mode: RemoteSimple | null, groupId?: string) => {
  const resolve = replies[at];
  if (!resolve) throw new Error('No pending hall read');
  resolve(answer(mode, groupId));
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const playlist = (id: string, fields: Partial<PlaylistNode> = {}): PlaylistNode => ({
  id,
  name: `Placeholder ${id}`,
  isFolder: false,
  kind: 'normal',
  parentId: null,
  itemCount: 0,
  placeholders: 0,
  imported: false,
  template: false,
  ...fields,
});
const header = (id: string): PlaylistItemInfo => ({
  id,
  kind: 'header',
  label: `Placeholder ${id}`,
  color: null,
});

beforeEach(async () => {
  vi.resetModules();
  feed.changed = [];
  replies = [];
  fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => replies.push(resolve)));
  vi.stubGlobal('fetch', fetcher);
  remote = await import('./remote-store');
  remote.useRemote.setState({ playlistId: 'one' });
  remote.startRemote();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Simple Mode reads on a phone', () => {
  it('never lets an older hall answer overwrite a newer mode: one request at a time, then a fresh read', async () => {
    changed('mode');
    changed('mode');
    expect(fetcher).toHaveBeenCalledTimes(1);
    reply(0, null);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    reply(1, simple);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple).toEqual(simple));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/v1/hall', '/api/v1/hall']);
  });

  it('coalesces a burst of mode and screen changes while keeping the last mode', async () => {
    changed('screens');
    changed('mode');
    changed('mode');
    expect(fetcher).toHaveBeenCalledTimes(1);
    reply(0, null);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    reply(1, simple);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple).toEqual(simple));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('says why once per entry to Simple Mode, keeping a dismissed explanation away during screen changes', async () => {
    // Leaving Simple Mode reads the playlists again (QA23-PHONE-1): answered at once, apart from the hall's reads.
    fetcher.mockImplementation((url) =>
      url === '/api/v1/playlists'
        ? Promise.resolve(json({ ok: true, playlists: [] }))
        : new Promise<Response>((resolve) => replies.push(resolve)),
    );
    changed('mode');
    reply(0, simple, 'first');
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.groupId).toBe('first'));
    expect(remote.useRemote.getState().simpleSaid).toBe(false);
    remote.useRemote.setState({ simpleSaid: true });
    changed('screens');
    reply(1, simple, 'second');
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.groupId).toBe('second'));
    expect(remote.useRemote.getState().simpleSaid).toBe(true);
    changed('mode');
    reply(2, null, 'third');
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.groupId).toBe('third'));
    changed('mode');
    reply(3, simple, 'fourth');
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.groupId).toBe('fourth'));
    expect(remote.useRemote.getState().simpleSaid).toBe(false);
  });
});

describe('the phone’s open playlist', () => {
  function listsFromComputer(lists: PlaylistNode[]): void {
    fetcher.mockImplementation((url) => {
      if (url === '/api/v1/playlists') return Promise.resolve(json({ ok: true, playlists: lists }));
      if (typeof url === 'string' && url.endsWith('/items')) {
        return Promise.resolve(json({ ok: true, items: [] }));
      }
      return new Promise<Response>((resolve) => replies.push(resolve));
    });
  }

  it('lists folders and smart playlists while leaving templates out', async () => {
    const folder = playlist('folder', { isFolder: true });
    const smart = playlist('smart', { kind: 'smart', parentId: folder.id });
    const ordinary = playlist('one');
    listsFromComputer([folder, smart, ordinary, playlist('template', { template: true })]);
    await remote.loadPlaylists();
    expect(remote.useRemote.getState().playlists).toEqual([folder, smart, ordinary]);
    expect(remote.useRemote.getState().playlistId).toBe('one');
  });

  it('reads no playlist or presentation while Simple Mode is on, and reads them again on leaving it (QA23-PHONE-1)', async () => {
    // The owner: "in simple mode only show the flow, whats running in live, and chat": a Simple Mode phone asks for
    // none of what Pro Mode's playlist shows (Drashti refuses them there).
    const lists = [playlist('one'), playlist('two')];
    listsFromComputer(lists);
    const asked = () => fetcher.mock.calls.map(([url]) => (typeof url === 'string' ? url : 'not a path'));
    changed('mode');
    reply(0, simple);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple).toEqual(simple));
    await remote.loadPlaylists();
    changed('playlists');
    remote.view({ presentationId: 'deck', item: null });
    expect(asked().filter((url) => url !== '/api/v1/hall')).toEqual([]);
    expect(remote.useRemote.getState().playlists).toBeNull();

    changed('mode');
    reply(1, null);
    await vi.waitFor(() => expect(remote.useRemote.getState().playlists).toEqual(lists));
    expect(asked()).toContain('/api/v1/playlists');
    expect(asked()).toContain('/api/v1/presentations/deck');
  });

  it('reads the hall before the playlists when they change: Simple Mode coming on (its playlist adopted first) asks for none (QA23-PHONE-1, CI run 45610620870)', async () => {
    const asked = () => fetcher.mock.calls.map(([url]) => (typeof url === 'string' ? url : 'not a path'));
    changed('mode');
    reply(0, null);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall).not.toBeNull());
    // Drashti adopts Simple Mode's playlist (a 'playlists' hint) before it says the mode changed.
    changed('playlists');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(asked()).toEqual(['/api/v1/hall', '/api/v1/hall']);
    reply(1, simple);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple).toEqual(simple));
    changed('mode');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    reply(2, simple);
    await vi.waitFor(() => expect(replies).toHaveLength(3));
    expect(asked()).not.toContain('/api/v1/playlists');
  });

  it('marks the live row once its playlist’s rows are read: a phone that connects while a row is live (QA23-PHONE-1, CI run 45610620870)', async () => {
    const deckRow: PlaylistItemInfo = {
      id: 'i-deck',
      kind: 'presentation',
      label: 'Placeholder deck',
      presentationId: 'deck',
      presentationName: 'Placeholder deck',
      order: { mode: 'presentation' },
      arrangementName: null,
      timers: [],
      phonePlays: true,
    };
    fetcher.mockImplementation((url) =>
      typeof url === 'string' && url.endsWith('/items')
        ? Promise.resolve(json({ ok: true, items: [deckRow] }))
        : new Promise<Response>((resolve) => replies.push(resolve)),
    );
    const { useEngine } = await import('../../engine/engine-store');
    const state = initialEngineState();
    // The row is live before this phone has its playlist's rows: its slides shown, the row not known yet.
    useEngine.setState({
      state: {
        ...state,
        live: { ...state.live, presentationId: 'deck', playlist: { playlistId: 'one', itemId: 'i-deck' } },
      },
    });
    expect(remote.useRemote.getState().viewing).toEqual({ presentationId: 'deck', item: null });
    await remote.showPlaylist('one');
    expect(remote.useRemote.getState().viewing).toEqual({
      presentationId: 'deck',
      item: { playlistId: 'one', itemId: 'i-deck', order: { mode: 'presentation' } },
    });
  });

  it('clears the previous playlist’s rows while reading the next one', async () => {
    remote.useRemote.setState({ items: [header('old')] });
    const reading = remote.showPlaylist('two');
    const whileReading = remote.useRemote.getState();
    replies[0]?.(json({ ok: true, items: [header('new')] }));
    await reading;
    expect(whileReading).toMatchObject({ playlistId: 'two', items: null });
    expect(remote.useRemote.getState().items).toEqual([header('new')]);
  });

  it('ignores a stale rows reply after leaving and reopening the same playlist', async () => {
    const stale = remote.showPlaylist('one');
    const other = remote.showPlaylist('two');
    const latest = remote.showPlaylist('one');
    replies[2]?.(json({ ok: true, items: [header('latest')] }));
    await latest;
    replies[1]?.(json({ ok: true, items: [header('other')] }));
    replies[0]?.(json({ ok: true, items: [header('stale')] }));
    await Promise.all([other, stale]);
    expect(remote.useRemote.getState().items).toEqual([header('latest')]);
  });
});
