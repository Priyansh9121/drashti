import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('opens the desktop playlist on entering Simple Mode, then keeps the phone’s choice until it is gone', async () => {
    const lists = [playlist('one'), playlist('two'), playlist('three')];
    listsFromComputer(lists);
    changed('mode');
    reply(0, { ...simple, playlistId: 'two' });
    await vi.waitFor(() => expect(remote.useRemote.getState().playlistId).toBe('two'));
    await remote.showPlaylist('one');

    changed('mode');
    reply(1, { ...simple, playlistId: 'three' });
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple?.playlistId).toBe('three'));
    await remote.loadPlaylists();
    expect(remote.useRemote.getState().playlistId).toBe('one');

    lists.shift();
    await remote.loadPlaylists();
    expect(remote.useRemote.getState().playlistId).toBe('three');
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
