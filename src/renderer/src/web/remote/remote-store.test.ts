import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState } from '../../../../shared/engine/state';
import type { NetworkChange } from '../../../../shared/network';
import type { RemoteSimple } from '../../../../shared/network-phone';
import type { PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import type * as RemoteStore from './remote-store';

const feed = vi.hoisted(() => ({
  changed: [] as ((what: NetworkChange, ids?: readonly string[]) => void)[],
  online: [] as (() => void)[],
}));
vi.mock('../feed', () => ({
  onOnline: (listener: () => void) => {
    feed.online.push(listener);
    return () => undefined;
  },
  onListsChanged: (listener: (what: NetworkChange, ids?: readonly string[]) => void) => {
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
/** Drashti's hint that a list changed; for the library, the presentations it names (left out: any may have). */
const changed = (what: NetworkChange, ids?: readonly string[]) => {
  for (const listener of feed.changed) listener(what, ids);
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
    // The change is read a moment later, its hall first (LIST_REFRESH_GAP_MS: a run of changes read once).
    await vi.waitFor(() => expect(replies).toHaveLength(1));
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

  it('a run of quick library changes costs the phone a few reads, however many changes (CI Mac run 45653717757: a 429)', async () => {
    const tools = await import('./phone-tools-store');
    fetcher.mockImplementation((url) => {
      const path = typeof url === 'string' ? url : '';
      if (path === '/api/v1/hall') return Promise.resolve(answer(null));
      if (path === '/api/v1/playlists')
        return Promise.resolve(json({ ok: true, playlists: [playlist('one')] }));
      if (path.endsWith('/items')) return Promise.resolve(json({ ok: true, items: [DECK_ROW] }));
      if (path.startsWith('/api/v1/presentations/'))
        return Promise.resolve(json({ ok: true, presentation: { id: 'deck' } }));
      return new Promise<Response>((resolve) => replies.push(resolve));
    });
    // Pro Mode heard, a PDF's slides shown.
    changed('mode');
    await vi.waitFor(() => expect(remote.useRemote.getState().hall).not.toBeNull());
    remote.view({ presentationId: 'deck', item: null });
    await settle();
    // Each time the rows' decks are let go, the Playlist reads every deck of its rows again.
    let forgets = 0;
    tools.usePhoneTools.subscribe((now, before) => {
      if (now.docs !== before.docs && now.docs.size === 0) forgets += 1;
    });
    fetcher.mockClear();
    // The operator edits the library quickly: 20 changes in half a second, each telling of the playlists and the library.
    for (let i = 0; i < 20; i += 1) {
      changed('presentations');
      changed('playlists');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const count = (pick: (path: string) => boolean) => askedPaths().filter(pick).length;
    expect(
      count((u) => u === '/api/v1/hall'),
      'halls',
    ).toBeLessThanOrEqual(3);
    expect(
      count((u) => u === '/api/v1/playlists'),
      'playlists',
    ).toBeLessThanOrEqual(3);
    expect(
      count((u) => u.endsWith('/items')),
      'rows',
    ).toBeLessThanOrEqual(3);
    expect(
      count((u) => u.startsWith('/api/v1/presentations/')),
      'slides',
    ).toBeLessThanOrEqual(3);
    expect(forgets, 'the decks let go (each a read of every deck row)').toBeLessThanOrEqual(3);
    // And it does catch up: the last change read.
    expect(count((u) => u === '/api/v1/playlists')).toBeGreaterThanOrEqual(1);
  });

  it('a library change that names its presentations reads again only those of the rows and the slides shown (QA24-PHONE-C)', async () => {
    // a23-review-phonelows LOW-C: each library change let go of every deck row, so the Playlist read them all again
    // (about 2 reads a second a row while the operator edited a kirtan). Drashti names what changed when it can.
    const tools = await import('./phone-tools-store');
    const rows: PlaylistItemInfo[] = ['deck-1', 'deck-2', 'deck-3'].map((id) => ({
      ...DECK_ROW,
      id: `i-${id}`,
      presentationId: id,
      presentationName: `Placeholder ${id}`,
    }));
    fetcher.mockImplementation((url) => {
      const path = typeof url === 'string' ? url : '';
      if (path === '/api/v1/hall') return Promise.resolve(answer(null));
      if (path === '/api/v1/playlists')
        return Promise.resolve(json({ ok: true, playlists: [playlist('one')] }));
      if (path.endsWith('/items')) return Promise.resolve(json({ ok: true, items: rows }));
      const deck = /^\/api\/v1\/presentations\/([^/]+)$/.exec(path);
      if (deck?.[1])
        return Promise.resolve(json({ ok: true, presentation: { id: decodeURIComponent(deck[1]) } }));
      return new Promise<Response>((resolve) => replies.push(resolve));
    });
    changed('mode');
    await vi.waitFor(() => expect(remote.useRemote.getState().hall).not.toBeNull());
    // The Playlist tab reads its rows' decks again each time the decks change (PlaylistTab.tsx's effect).
    tools.usePhoneTools.subscribe(() => {
      tools.readDocsFor(rows);
    });
    tools.readDocsFor(rows);
    remote.view({ presentationId: 'deck-1', item: null });
    await vi.waitFor(() => expect(tools.usePhoneTools.getState().docs.size).toBe(3));
    await settle();
    const deckReads = () => askedPaths().filter((u) => u.startsWith('/api/v1/presentations/'));
    const rowsRead = () => askedPaths().filter((u) => u.endsWith('/items')).length;
    const step = async (ids?: readonly string[]) => {
      // A refresh at most each LIST_REFRESH_GAP_MS: each step its own.
      await new Promise((resolve) => setTimeout(resolve, remote.LIST_REFRESH_GAP_MS));
      fetcher.mockClear();
      changed('presentations', ids);
      await vi.waitFor(() => expect(rowsRead()).toBe(1));
      await settle();
      return deckReads().sort();
    };

    // A kirtan's words edited: no deck of the rows and not the slides shown, so no deck is read again.
    expect(await step(['kirtan'])).toEqual([]);
    expect(tools.usePhoneTools.getState().docs.size).toBe(3);
    // One PDF of the rows changed: that one read again, once.
    expect(await step(['deck-2'])).toEqual(['/api/v1/presentations/deck-2']);
    // The PDF whose slides are shown: its row and the slides shown, each read once.
    expect(await step(['deck-1'])).toEqual(['/api/v1/presentations/deck-1', '/api/v1/presentations/deck-1']);
    // A change Drashti does not name: every row and the slides shown read again, as before.
    expect(await step()).toEqual([
      '/api/v1/presentations/deck-1',
      '/api/v1/presentations/deck-1',
      '/api/v1/presentations/deck-2',
      '/api/v1/presentations/deck-3',
    ]);
    expect(tools.usePhoneTools.getState().docs.size).toBe(3);
  });

  it('a deck read on its way when that deck alone is let go never puts its old answer back (QA24-PHONE-C, as LOW-5)', async () => {
    const tools = await import('./phone-tools-store');
    await proHall();
    tools.readDocsFor([DECK_ROW]);
    expect(askedPaths().at(-1)).toBe('/api/v1/presentations/deck');
    const onItsWay = replies.at(-1);
    if (!onItsWay) throw new Error('no deck read on its way');
    tools.usePhoneTools.setState({ docs: new Map([['other', null]]) });
    tools.forgetDocs(['deck']);
    onItsWay(json({ ok: true, presentation: { id: 'deck', name: 'Placeholder deck as it was' } }));
    await settle();
    expect(tools.usePhoneTools.getState().docs.has('deck')).toBe(false);
    // Another presentation's deck is kept.
    expect(tools.usePhoneTools.getState().docs.has('other')).toBe(true);
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
