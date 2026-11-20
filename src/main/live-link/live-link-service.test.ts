import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../../shared/engine/commands';
import { type EngineState, initialEngineState, type SlideLayer } from '../../shared/engine/state';
import type { StreamLinkStatus } from '../../shared/live-link';
import type { PlaylistFetch } from './fetch-playlist';
import {
  type LiveLinkDeps,
  LiveLinkService,
  type LocalProgress,
  type RelayRun,
  TEST_GUARD,
} from './live-link-service';

/*
 * Show a Stream Link…'s main-process side, with everything around it stood in for: the playlist asked for, yt-dlp's
 * look, the relay FFmpeg (its exit in the test's hands), the local stream's progress (its newest segment, as the test
 * says), the folders, and an engine that keeps LIVE to one thing at a time as the real one does for a link (a cover
 * takes it off; putting it up takes the covers off). Placeholder addresses only (127.0.0.1, example.org).
 */

const LINK = 'http://127.0.0.1:9/live/index.m3u8';
const LIVE_PLAYLIST = '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\nseg-1.ts\n#EXTINF:1.0,\nseg-2.ts\n';
const ok = (): CommandResult => ({ ok: true }) as CommandResult;

interface Relay {
  args: string[];
  stopped: boolean;
  exit(code: number | null): void;
}

function setUp(over: Partial<LiveLinkDeps> = {}) {
  let state: EngineState = initialEngineState();
  const statuses: StreamLinkStatus[] = [];
  const relays: Relay[] = [];
  const removed: string[] = [];
  const made: string[] = [];
  const progress: Omit<LocalProgress, 'segments'> = { newest: null, targetSeconds: 1 };
  /** The local playlist as the relay writes it: the newest six segments, a second each. */
  const listed = () => {
    const n = progress.newest;
    if (n === null) return [];
    return Array.from({ length: Math.min(6, n + 1) }, (_, i) => ({ n: n - Math.min(5, n) + i, seconds: 1 }));
  };
  const playlists = new Map<string, PlaylistFetch>([[LINK, { ok: true, text: LIVE_PLAYLIST, url: LINK }]]);
  const fetched: string[] = [];
  let ids = 0;
  let service: LiveLinkService | null = null;
  const change = (next: EngineState) => {
    state = next;
    service?.follow();
  };
  const deps: LiveLinkDeps = {
    startRelay: (args) => {
      let exit: (code: number | null) => void = () => undefined;
      const done = new Promise<{ code: number | null }>((resolve) => {
        exit = (code) => {
          resolve({ code });
        };
      });
      const relay: Relay = { args, stopped: false, exit: (code) => exit(code) };
      relays.push(relay);
      const run: RelayRun = {
        done,
        stop: () => {
          relay.stopped = true;
          exit(null);
        },
      };
      return run;
    },
    fetchPlaylist: (url) => {
      fetched.push(url);
      return Promise.resolve(playlists.get(url) ?? { ok: false, reason: 'network' });
    },
    lookYoutube: () => Promise.resolve({ ok: false, message: 'no look in this test' }),
    onAir: () => false,
    root: '/placeholder/Stream links',
    progress: () => Promise.resolve({ ...progress, segments: listed() }),
    readPlaylist: () =>
      Promise.resolve(
        progress.newest === null
          ? null
          : [
              '#EXTM3U',
              '#EXT-X-VERSION:6',
              '#EXT-X-TARGETDURATION:1',
              `#EXT-X-MEDIA-SEQUENCE:${String(listed()[0]?.n ?? 0)}`,
              ...listed().flatMap((seg) => ['#EXTINF:1.000000,', `seg-${String(seg.n).padStart(6, '0')}.ts`]),
              '',
            ].join('\n'),
      ),
    makeFolder: (dir) => {
      made.push(dir);
    },
    removeFolder: (dir) => {
      removed.push(dir);
      return Promise.resolve();
    },
    restartLink: (linkId) => {
      const bg = state.layers.background;
      if (bg?.kind === 'link' && bg.linkId === linkId)
        change({ ...state, layers: { ...state.layers, background: { ...bg, startedAt: Date.now() } } });
      return ok();
    },
    showLink: (link) => {
      change({
        ...state,
        blackout: false,
        wallpaper: false,
        layers: { ...state.layers, background: { kind: 'link', ...link, startedAt: Date.now() } },
      });
      return ok();
    },
    dropped: (linkId) => {
      const bg = state.layers.background;
      if (bg?.kind !== 'link' || bg.linkId !== linkId) return ok();
      change({ ...state, wallpaper: true, layers: { ...state.layers, background: null } });
      return ok();
    },
    clearLink: (linkId) => {
      const bg = state.layers.background;
      if (bg?.kind === 'link' && bg.linkId === linkId)
        change({ ...state, layers: { ...state.layers, background: null } });
      return ok();
    },
    state: () => state,
    changed: (status) => statuses.push(status),
    log: () => undefined,
    now: () => Date.now(),
    newId: () => `00000000-0000-4000-8000-00000000000${String(++ids)}`,
    guard: true,
    pollMs: 500,
    ...over,
  };
  service = new LiveLinkService(deps);
  return {
    service,
    deps,
    statuses,
    relays,
    removed,
    made,
    progress,
    playlists,
    fetched,
    engine: {
      get: () => state,
      set: change,
    },
    last: () => statuses.at(-1)?.state ?? 'off',
  };
}

/** Show the link, its local stream writing its first three segments a second apart. */
async function showUp(t: ReturnType<typeof setUp>, link = LINK) {
  const shown = t.service.show(link);
  for (const n of [0, 1, 2]) {
    await vi.advanceTimersByTimeAsync(1000);
    t.progress.newest = n;
  }
  await vi.advanceTimersByTimeAsync(600);
  return shown;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a stream link going up', () => {
  it('goes up once three of its segments are written, never before, as the background, receiving the link as it is', async () => {
    const t = setUp();
    const shown = t.service.show(LINK);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.last()).toBe('connecting');
    t.progress.newest = 1;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.engine.get().layers.background).toBeNull();
    t.progress.newest = 2;
    await vi.advanceTimersByTimeAsync(600);
    expect(await shown).toEqual({ ok: true });
    expect(t.engine.get().layers.background).toMatchObject({ kind: 'link', name: '127.0.0.1' });
    expect(t.last()).toBe('playing');
    expect(t.relays).toHaveLength(1);
    expect(t.relays[0]?.args).toContain(LINK);
    expect(t.made).toHaveLength(1);
    // Its folder is served while it is up, and no other.
    const bg = t.engine.get().layers.background;
    if (bg?.kind !== 'link') throw new Error('a link expected');
    expect(t.service.folderOf(bg.linkId)).toBe(t.made[0]);
    expect(t.service.folderOf('00000000-0000-4000-8000-000000000099')).toBeNull();
  });

  it('refuses one that cannot be received, saying why, and the screens stay as they were', async () => {
    const t = setUp();
    t.playlists.set(LINK, { ok: false, reason: 'status', status: 404 });
    const missing = await t.service.show(LINK);
    expect(missing).toMatchObject({ ok: false });
    expect(missing.ok ? '' : missing.message).toContain('not at that link');
    t.playlists.set(LINK, { ok: true, text: '<!doctype html>', url: LINK });
    const page = await t.service.show(LINK);
    expect(page.ok ? '' : page.message).toBe('That link does not give an HLS stream. Check the link.');
    t.playlists.set(LINK, { ok: true, text: `${LIVE_PLAYLIST}#EXT-X-ENDLIST\n`, url: LINK });
    const ended = await t.service.show(LINK);
    expect(ended.ok ? '' : ended.message).toBe('That stream has ended.');
    expect(t.relays).toHaveLength(0);
    expect(t.engine.get().layers.background).toBeNull();
    expect(t.last()).toBe('off');
  });

  it('gives up on one whose FFmpeg stops before any pictures, and removes its folder', async () => {
    const t = setUp();
    const shown = t.service.show(LINK);
    await vi.advanceTimersByTimeAsync(1000);
    t.relays[0]?.exit(1);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await shown;
    expect(result.ok ? '' : result.message).toContain('no pictures came');
    expect(t.removed).toEqual(t.made);
    expect(t.engine.get().layers.background).toBeNull();
  });

  it('a test run asks nothing of any address but this computer’s own', async () => {
    const t = setUp();
    expect(await t.service.show('https://media.example.org/live.m3u8')).toEqual({
      ok: false,
      message: TEST_GUARD,
    });
    expect(t.fetched).toEqual([]);
  });

  it('takes a master playlist’s H.264 variant no taller than 1080 lines, by its program', async () => {
    const t = setUp();
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160,CODECS="avc1.640033,mp4a.40.2"',
      'uhd.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      'hd.m3u8',
    ].join('\n');
    t.playlists.set(LINK, { ok: true, text: master, url: LINK });
    expect(await showUp(t)).toEqual({ ok: true });
    expect(t.relays[0]?.args).toEqual(expect.arrayContaining(['0:p:1:v:0', '0:p:1:a:0?']));
  });
});

describe('a stream link that drops', () => {
  it('says Reconnecting… within seconds, puts up the Wallpaper at 20 s (the link off), and goes up again by itself', async () => {
    const t = setUp();
    await showUp(t);
    const first = t.engine.get().layers.background;
    // Its pictures stop coming; its FFmpeg stops a little later.
    await vi.advanceTimersByTimeAsync(4000);
    expect(t.last()).toBe('playing');
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.last()).toBe('reconnecting');
    t.relays[0]?.exit(1);
    t.playlists.set(LINK, { ok: false, reason: 'network' });
    await vi.advanceTimersByTimeAsync(9000);
    // Still held: the link up, no Wallpaper yet.
    expect(t.engine.get().layers.background).toEqual(first);
    expect(t.engine.get().wallpaper).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.engine.get().wallpaper).toBe(true);
    expect(t.engine.get().layers.background).toBeNull();
    expect(t.last()).toBe('wallpaper');
    // It answers again: its FFmpeg carries the local playlist on, and once a new segment is written it is up again.
    t.playlists.set(LINK, { ok: true, text: LIVE_PLAYLIST, url: LINK });
    await vi.advanceTimersByTimeAsync(6000);
    const again = t.relays.at(-1);
    expect(again?.args.join(' ')).toContain('append_list');
    t.progress.newest = 3;
    await vi.advanceTimersByTimeAsync(600);
    expect(t.engine.get().wallpaper).toBe(false);
    expect(t.engine.get().layers.background).toMatchObject({
      kind: 'link',
      linkId: first?.kind === 'link' ? first.linkId : '',
    });
    expect(t.last()).toBe('playing');
  });

  it('back before 20 s: playing again, every page starting again together, nothing put up or taken off', async () => {
    const t = setUp();
    await showUp(t);
    const first = t.engine.get().layers.background;
    await vi.advanceTimersByTimeAsync(8000);
    expect(t.last()).toBe('reconnecting');
    t.progress.newest = 3;
    await vi.advanceTimersByTimeAsync(600);
    expect(t.last()).toBe('playing');
    const now = t.engine.get().layers.background;
    expect(now).toMatchObject({ kind: 'link', linkId: first?.kind === 'link' ? first.linkId : '' });
    expect(now?.kind === 'link' && first?.kind === 'link' && now.startedAt > first.startedAt).toBe(true);
    expect(t.engine.get().wallpaper).toBe(false);
  });

  it('never comes back when something else went up meanwhile: it stops, its folder removed', async () => {
    const t = setUp();
    await showUp(t);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(t.last()).toBe('wallpaper');
    // The operator puts a slide up: the Wallpaper comes off with it.
    const slide = {
      presentationId: 'p',
      slideIndex: 0,
      shownAt: Date.now(),
      notes: '',
    } as unknown as SlideLayer;
    t.engine.set({ ...t.engine.get(), wallpaper: false, layers: { ...t.engine.get().layers, slide } });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.last()).toBe('off');
    expect(t.relays.every((r) => r.stopped)).toBe(true);
    expect(t.removed).toHaveLength(1);
    t.progress.newest = 6;
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.engine.get().layers.background).toBeNull();
  });

  it('an ended stream is held, the Wallpaper goes up at 20 s, and it says it has ended', async () => {
    const t = setUp();
    await showUp(t);
    t.playlists.set(LINK, { ok: true, text: `${LIVE_PLAYLIST}#EXT-X-ENDLIST\n`, url: LINK });
    t.relays[0]?.exit(0);
    await vi.advanceTimersByTimeAsync(22_000);
    expect(t.engine.get().wallpaper).toBe(true);
    expect(t.statuses.at(-1)).toMatchObject({ state: 'ended', note: 'The stream link has ended.' });
    // Never received again from its start.
    expect(t.relays).toHaveLength(1);
  });
});

describe('a stream link taken off, and put back', () => {
  it('taken off (Clear background, Clear all, another background, a cover): its FFmpeg stops and its folder goes', async () => {
    const t = setUp();
    await showUp(t);
    t.engine.set({ ...t.engine.get(), layers: { ...t.engine.get().layers, background: null } });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.relays[0]?.stopped).toBe(true);
    expect(t.removed).toEqual(t.made);
    expect(t.last()).toBe('off');
  });

  it('the operator’s Stop takes the link up off', async () => {
    const t = setUp();
    await showUp(t);
    t.service.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(t.engine.get().layers.background).toBeNull();
    expect(t.relays[0]?.stopped).toBe(true);
  });

  it('put back (Put it back, Oops), the last link starts receiving again; any other link put back comes off', async () => {
    const t = setUp();
    await showUp(t);
    const was = t.engine.get().layers.background;
    t.engine.set({ ...t.engine.get(), layers: { ...t.engine.get().layers, background: null } });
    await vi.advanceTimersByTimeAsync(100);
    t.engine.set({ ...t.engine.get(), layers: { ...t.engine.get().layers, background: was } });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.relays).toHaveLength(2);
    expect(t.last()).toBe('reconnecting');
    t.progress.newest = 4;
    await vi.advanceTimersByTimeAsync(600);
    expect(t.last()).toBe('playing');
    t.engine.set({
      ...t.engine.get(),
      layers: {
        ...t.engine.get().layers,
        background: { kind: 'link', linkId: '00000000-0000-4000-8000-000000000077', name: 'x', startedAt: 1 },
      },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.engine.get().layers.background).toBeNull();
  });

  it('quitting stops its FFmpeg', async () => {
    const t = setUp();
    await showUp(t);
    await t.service.close();
    expect(t.relays[0]?.stopped).toBe(true);
    expect(t.removed).toEqual(t.made);
  });
});

describe('a YouTube live link', () => {
  const PAGE = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';
  const STREAM = 'http://127.0.0.1:9/yt/index.m3u8';
  const LOOK = JSON.stringify({
    live_status: 'is_live',
    title: 'Placeholder live',
    formats: [
      { protocol: 'm3u8_native', url: STREAM, height: 720, vcodec: 'avc1.4d401f', acodec: 'mp4a.40.2' },
    ],
  });

  it('is looked at with yt-dlp only while the stream is off air, and its stream is received', async () => {
    let onAir = true;
    const looks: string[] = [];
    const t = setUp({
      onAir: () => onAir,
      lookYoutube: (url) => {
        looks.push(url);
        return Promise.resolve({ ok: true, json: LOOK });
      },
    });
    t.playlists.set(STREAM, { ok: true, text: LIVE_PLAYLIST, url: STREAM });
    const refused = await t.service.show(PAGE);
    expect(refused.ok ? '' : refused.message).toContain('only while the stream is off air and not recording');
    expect(looks).toEqual([]);
    onAir = false;
    expect(await showUp(t, PAGE)).toEqual({ ok: true });
    expect(looks).toEqual([PAGE]);
    expect(t.relays[0]?.args).toContain(STREAM);
    expect(t.engine.get().layers.background).toMatchObject({ kind: 'link', name: 'YouTube live' });
  });

  it('says why when YouTube gives no live stream', async () => {
    const t = setUp({
      lookYoutube: () => Promise.resolve({ ok: true, json: JSON.stringify({ live_status: 'is_upcoming' }) }),
    });
    const r = await t.service.show(PAGE);
    expect(r.ok ? '' : r.message).toContain('has not started yet');
    expect(t.relays).toHaveLength(0);
  });
});

describe('every page joining a stream link at the same frame at the same moment', () => {
  it('a page joins three segments from the newest, its first frame shown at the showing’s moment for it', async () => {
    const t = setUp();
    await showUp(t);
    const bg = t.engine.get().layers.background;
    if (bg?.kind !== 'link') throw new Error('a link expected');
    expect(t.service.join('00000000-0000-4000-8000-000000000099')).toBeNull();
    const first = t.service.join(bg.linkId);
    // Three from the newest (the anchor), or the next if that one's moment is too close to load it in time.
    expect([0, 1]).toContain(first?.segment);
    // Its moment still to come: time to load it and hold its first frame.
    expect((first?.startAt ?? 0) - Date.now()).toBeGreaterThanOrEqual(300);
    // Another page joining now: the same segment and moment.
    expect(t.service.join(bg.linkId)).toEqual(first);
    // Later, three from the newest, its moment that much later by the stream's own time.
    for (const n of [3, 4, 5]) {
      t.progress.newest = n;
      await vi.advanceTimersByTimeAsync(1000);
    }
    const later = t.service.join(bg.linkId);
    expect(later?.segment).toBeGreaterThanOrEqual(3);
    expect((later?.startAt ?? 0) - (first?.startAt ?? 0)).toBe(
      ((later?.segment ?? 0) - (first?.segment ?? 0)) * 1000,
    );
  });

  it('a joined page’s playlist starts at its segment, at first only it and the two after it', async () => {
    const t = setUp();
    await showUp(t);
    const bg = t.engine.get().layers.background;
    if (bg?.kind !== 'link') throw new Error('a link expected');
    t.progress.newest = 4;
    await vi.advanceTimersByTimeAsync(100);
    const joined = t.service.join(bg.linkId);
    const segment = joined?.segment ?? -1;
    const firstList = (await t.service.playlistFor(bg.linkId, segment)) ?? '';
    expect(firstList).toContain(`#EXT-X-MEDIA-SEQUENCE:${String(segment)}`);
    const names = (text: string) => text.split('\n').filter((l) => l.startsWith('seg-'));
    expect(names(firstList)).toEqual(
      [segment, segment + 1, segment + 2]
        .filter((n) => n <= 4)
        .map((n) => `seg-${String(n).padStart(6, '0')}.ts`),
    );
    t.progress.newest = 7;
    await vi.advanceTimersByTimeAsync(2500);
    expect(names((await t.service.playlistFor(bg.linkId, segment)) ?? '').at(-1)).toBe('seg-000007.ts');
    expect(await t.service.playlistFor('00000000-0000-4000-8000-000000000099', 0)).toBeNull();
  });

  it('a page still joins long after the anchor’s segment has gone from the disk (CI x54-1120-195548-69004: none could)', async () => {
    const t = setUp();
    await showUp(t);
    const bg = t.engine.get().layers.background;
    if (bg?.kind !== 'link') throw new Error('a link expected');
    const first = t.service.join(bg.linkId);
    // Twenty segments on, a second each: the anchor's own entry long gone from the local playlist.
    for (let n = 3; n <= 22; n++) {
      t.progress.newest = n;
      await vi.advanceTimersByTimeAsync(1000);
    }
    const later = t.service.join(bg.linkId);
    expect(later).not.toBeNull();
    expect((later?.segment ?? 0) - (first?.segment ?? 0)).toBeGreaterThanOrEqual(18);
    expect((later?.startAt ?? 0) - (first?.startAt ?? 0)).toBe(
      ((later?.segment ?? 0) - (first?.segment ?? 0)) * 1000,
    );
  });

  it('a second page joining at the same segment a moment later is given its own first three too', async () => {
    const t = setUp();
    const shown = t.service.show(LINK);
    for (const n of [0, 1, 2]) {
      await vi.advanceTimersByTimeAsync(1000);
      t.progress.newest = n;
    }
    // Up within 100 ms of now: its anchor's moment is 2 s off.
    for (let i = 0; i < 10 && t.last() !== 'playing'; i++) await vi.advanceTimersByTimeAsync(100);
    expect(await shown).toEqual({ ok: true });
    const bg = t.engine.get().layers.background;
    if (bg?.kind !== 'link') throw new Error('a link expected');
    expect(t.service.join(bg.linkId)?.segment).toBe(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.service.join(bg.linkId)?.segment).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    t.progress.newest = 4;
    // 2.15 s after the first page joined, 1.85 s after the second.
    await vi.advanceTimersByTimeAsync(1250);
    const names = ((await t.service.playlistFor(bg.linkId, 0)) ?? '')
      .split('\n')
      .filter((l) => l.startsWith('seg-'));
    expect(names).toEqual(['seg-000000.ts', 'seg-000001.ts', 'seg-000002.ts']);
  });

  it('no page joins while it reconnects (each keeps its last picture: a player joining then would play the last seconds again, CI x54-1120-235843-34860), and every page joins once it is back', async () => {
    const t = setUp();
    await showUp(t);
    const bg = t.engine.get().layers.background;
    if (bg?.kind !== 'link') throw new Error('a link expected');
    expect(t.service.join(bg.linkId)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(8000);
    expect(t.last()).toBe('reconnecting');
    expect(t.service.join(bg.linkId)).toBeNull();
    t.progress.newest = 3;
    await vi.advanceTimersByTimeAsync(600);
    expect(t.last()).toBe('playing');
    expect(t.service.join(bg.linkId)).not.toBeNull();
  });

  it('no page joins while its Wallpaper is up, nor a link not up', async () => {
    const t = setUp();
    await showUp(t);
    const bg = t.engine.get().layers.background;
    if (bg?.kind !== 'link') throw new Error('a link expected');
    await vi.advanceTimersByTimeAsync(21_000);
    expect(t.last()).toBe('wallpaper');
    expect(t.service.join(bg.linkId)).toBeNull();
  });
});
