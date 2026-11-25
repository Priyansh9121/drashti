import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState } from '../../../../shared/engine/state';
import type { NetworkChange } from '../../../../shared/network';
import type { RemoteSimple } from '../../../../shared/network-phone';
import type { PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import type * as RemoteStore from './remote-store';

const feed = vi.hoisted(() => ({
  changed: [] as ((what: NetworkChange) => void)[],
  online: [] as (() => void)[],
}));
vi.mock('../feed', () => ({
  onOnline: (listener: () => void) => {
    feed.online.push(listener);
    return () => undefined;
  },
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
/** The feed connected (its welcome): each new connection, the first and every one after a drop. */
const online = () => {
  for (const listener of feed.online) listener();
};
const reply = (at: number, mode: RemoteSimple | null, groupId?: string) => {
  const resolve = replies[at];
  if (!resolve) throw new Error('No pending hall read');
  resolve(answer(mode, groupId));
};

/** A row of a PDF, as Drashti marks it for a phone. */
const DECK_ROW: PlaylistItemInfo = {
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

/** What the page has asked for so far, by path. */
const askedPaths = () => fetcher.mock.calls.map(([url]) => (typeof url === 'string' ? url : 'not a path'));

/** A moment for what an answer sets going (its microtasks and a timer turn). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

/** The hall answered once, in Pro Mode: what a phone waits for before it reads a playlist (a23-review-phoneui MUST-1). */
async function proHall(): Promise<void> {
  changed('mode');
  const resolve = replies.at(-1);
  if (!resolve) throw new Error('No pending hall read');
  resolve(answer(null));
  await vi.waitFor(() => expect(remote.useRemote.getState().hall).not.toBeNull());
}

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
  feed.online = [];
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
    await proHall();
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
    // What Pro Mode had read, hours old by the time Simple Mode ends (a23-review-phoneui S4): let go on entering it.
    remote.useRemote.setState({ playlists: lists, items: [header('old')] });
    changed('mode');
    reply(0, simple);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple).toEqual(simple));
    expect(remote.useRemote.getState()).toMatchObject({ playlists: null, items: null, doc: null });
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

  it('keeps the phone’s own playlist until it is gone, then the live one, else the first (Pro Mode; a23-review-phoneui S3)', async () => {
    const lists = [playlist('one'), playlist('two'), playlist('three')];
    listsFromComputer(lists);
    await proHall();
    await remote.showPlaylist('two');
    await remote.loadPlaylists();
    expect(remote.useRemote.getState().playlistId).toBe('two');
    // Its own choice gone: the live playlist.
    const { useEngine } = await import('../../engine/engine-store');
    const state = initialEngineState();
    useEngine.setState({
      state: { ...state, live: { ...state.live, playlist: { playlistId: 'three', itemId: 'i-three' } } },
    });
    lists.splice(1, 1);
    await remote.loadPlaylists();
    expect(remote.useRemote.getState().playlistId).toBe('three');
    // The live one gone too: the first.
    lists.splice(1, 1);
    await remote.loadPlaylists();
    expect(remote.useRemote.getState().playlistId).toBe('one');
  });

  it('reads no presentation or playlist on a new connection until its hall answers: in Simple Mode none, in Pro Mode the live one once (a23-review-phoneui MUST-1)', async () => {
    const asked = () => fetcher.mock.calls.map(([url]) => (typeof url === 'string' ? url : 'not a path'));
    const read = () => asked().filter((url) => url !== '/api/v1/hall');
    // A phone opens /remote: the feed's welcome, then its snapshot with a kirtan live, before the hall has answered.
    online();
    const { useEngine } = await import('../../engine/engine-store');
    const state = initialEngineState();
    useEngine.setState({ state: { ...state, live: { ...state.live, presentationId: 'kirtan' } } });
    expect(remote.useRemote.getState().viewing).toMatchObject({ presentationId: 'kirtan' });
    expect(read()).toEqual([]);
    reply(0, simple);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple).toEqual(simple));
    expect(read()).toEqual([]);
    // Locked, then back after the computer went into Pro Mode: nothing until this connection's hall says so.
    online();
    expect(read()).toEqual([]);
    reply(1, null);
    await vi.waitFor(() =>
      expect(read().filter((url) => url.startsWith('/api/v1/presentations/'))).toEqual([
        '/api/v1/presentations/kirtan',
      ]),
    );
    expect(read().filter((url) => url === '/api/v1/playlists')).toEqual(['/api/v1/playlists']);
  });

  it('forgets the Playlist’s PDF pages on a library change and on each connection, after the hall, so they are read again (a23-review-phoneui MUST-3)', async () => {
    fetcher.mockImplementation((url) =>
      url === '/api/v1/playlists'
        ? Promise.resolve(json({ ok: true, playlists: [] }))
        : new Promise<Response>((resolve) => replies.push(resolve)),
    );
    const tools = await import('./phone-tools-store');
    const kept = () => tools.usePhoneTools.getState().docs.size;
    tools.usePhoneTools.setState({ docs: new Map([['deck', null]]) });
    changed('presentations');
    reply(0, null);
    await vi.waitFor(() => expect(kept()).toBe(0));
    tools.usePhoneTools.setState({ docs: new Map([['deck', null]]) });
    online();
    expect(kept()).toBe(1);
    reply(1, null);
    await vi.waitFor(() => expect(kept()).toBe(0));
  });

  it('a hall read that fails on a new connection forgets nothing and reads nothing (a23-review-phoneui LOW-1)', async () => {
    const tools = await import('./phone-tools-store');
    tools.usePhoneTools.setState({ docs: new Map([['deck', null]]) });
    online();
    replies[0]?.(
      new Response(JSON.stringify({ ok: false, message: 'Placeholder: not now' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await settle();
    expect(tools.usePhoneTools.getState().docs.size).toBe(1);
    expect(askedPaths()).toEqual(['/api/v1/hall']);
  });

  it('reads the Playlist rows’ decks only while this connection’s hall says Pro Mode (a23-review-phoneui LOW-1)', async () => {
    const tools = await import('./phone-tools-store');
    const deckReads = () => askedPaths().filter((url) => url === '/api/v1/presentations/deck');
    online();
    tools.readDocsFor([DECK_ROW]);
    expect(deckReads()).toEqual([]);
    reply(0, simple);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple).toEqual(simple));
    tools.readDocsFor([DECK_ROW]);
    expect(deckReads()).toEqual([]);
    online();
    reply(1, null);
    await vi.waitFor(() => expect(remote.useRemote.getState().hall?.simple).toBeNull());
    await settle();
    tools.readDocsFor([DECK_ROW]);
    expect(deckReads()).toEqual(['/api/v1/presentations/deck']);
  });

  it('a deck read still on its way when the decks are forgotten never puts its old answer back (a23-review-phoneui LOW-5)', async () => {
    const tools = await import('./phone-tools-store');
    await proHall();
    tools.readDocsFor([DECK_ROW]);
    expect(askedPaths().at(-1)).toBe('/api/v1/presentations/deck');
    const onItsWay = replies.at(-1);
    if (!onItsWay) throw new Error('no deck read on its way');
    tools.forgetDocs();
    onItsWay(json({ ok: true, presentation: { id: 'deck', name: 'Placeholder deck as it was' } }));
    await settle();
    expect(tools.usePhoneTools.getState().docs.has('deck')).toBe(false);
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
