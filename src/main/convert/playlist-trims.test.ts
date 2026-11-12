import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_MARKERS } from '../../shared/markers';
import type { Db } from '../db/database';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { PlaylistRepo } from '../db/playlists';
import { TrimmedVideos } from '../db/trimmed';
import type { FitResult } from './convert-service';
import { PlaylistTrims } from './playlist-trims';
import type { TrimCopyInput } from './trim-copy';

let dir: string;
let db: Db;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'drashti-playlist-trim-')));
  db = openDatabase(':memory:');
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const info = {
  durationMs: 5000,
  video: { codec: 'h264', pixFmt: 'yuv420p', width: 64, height: 48, still: false },
  audio: null,
};

interface KeptTrim {
  itemId: string;
  mediaId: string;
  name: string;
}

interface ReviewHooks {
  activityChanged?(): void;
  reportInterrupted?(): void;
}

async function setup() {
  const media = new MediaRepo(db);
  const playlists = new PlaylistRepo(db);
  const repo = new TrimmedVideos(db, media, playlists);
  db.prepare(
    "INSERT INTO media (id, kind, name, path) VALUES ('original', 'video', 'Placeholder.mp4', 'original.mp4')",
  ).run();
  const original = join(dir, 'original.mp4');
  const output = join(dir, 'Placeholder trimmed.mp4');
  await writeFile(original, 'placeholder original');
  await writeFile(output, 'placeholder trim');
  const playlist = playlists.createAtTop('Placeholder playlist');
  const [itemId = ''] = playlists.addItems(playlist, null, [{ kind: 'media', mediaId: 'original' }]);
  const another = playlists.createAtTop('Other placeholder playlist');
  playlists.addItems(another, null, [{ kind: 'media', mediaId: 'original' }]);
  let finish: (value: FitResult) => void = () => undefined;
  const done = new Promise<FitResult>((resolve) => {
    finish = resolve;
  });
  const pendingChanged = vi.fn();
  const rowChanged = vi.fn();
  const notice = vi.fn();
  let liveMedia: string | null = null;
  const isLive = vi.fn((item: string, media: string) => item === itemId && media === liveMedia);
  let stored: KeptTrim[] = [];
  const kept = {
    load: () => stored,
    save: (cuts: KeptTrim[]) => {
      stored = cuts;
    },
  };
  const queue = vi.fn((_input: TrimCopyInput) => ({ id: 'copy', done }));
  const deps = {
    repo,
    mediaDir: dir,
    readInfo: (path: string) =>
      Promise.resolve({ ...info, durationMs: path === output ? 2000 : info.durationMs }),
    queue,
    cancel: () => true,
    pendingChanged,
    rowChanged,
    markersChanged: vi.fn(),
    notice,
    isLive,
    kept,
  };
  const restart = (): PlaylistTrims & ReviewHooks => new PlaylistTrims(deps);
  const service = restart();
  return {
    service,
    restart,
    repo,
    media,
    playlists,
    playlist,
    another,
    itemId,
    original,
    output,
    queue,
    finish,
    pendingChanged,
    rowChanged,
    notice,
    isLive,
    kept,
    show: (media: string | null) => {
      liveMedia = media;
      service.activityChanged?.();
    },
  };
}

const request = {
  mediaId: 'original',
  points: {
    startMs: 500,
    endMs: 2500,
    markers: [
      { id: 'before-cut', name: 'Placeholder before cut', atMs: 200 },
      { id: 'mark', name: 'Placeholder cue', atMs: 1400 },
    ],
  },
};

describe('trimming a playlist video', () => {
  it('offers Reset for old file playback points and clears them only for that row', async () => {
    const x = await setup();
    x.media.setMarkers('original', request.points);
    expect(x.repo.view(x.itemId)?.canReset).toBe(true);
    expect(await x.service.apply(x.itemId, { mediaId: 'original', points: NO_MARKERS })).toEqual({
      ok: true,
    });
    expect(x.queue).not.toHaveBeenCalled();
    expect(x.repo.view(x.itemId)?.markers).toMatchObject({ startMs: null, endMs: null });
    expect(x.media.markersOf('original')).toEqual(request.points);
  });

  it('saves markers alone when the playback points have not changed', async () => {
    const x = await setup();
    const old = { ...request.points, markers: [] };
    x.media.setMarkers('original', old);
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    expect(x.queue).not.toHaveBeenCalled();
    expect(x.media.markersOf('original')).toEqual(request.points);
  });

  it('leaves the original in place until ready, keeps the cut and its source, and restores that row', async () => {
    const x = await setup();
    const mtime = (await stat(x.original)).mtimeMs;
    const oldPoints = { ...NO_MARKERS, startMs: 100, endMs: 3000 };
    x.media.setMarkers('original', oldPoints);
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    expect(x.pendingChanged).toHaveBeenLastCalledWith([x.itemId]);
    expect(x.queue).toHaveBeenCalledWith(expect.objectContaining({ startMs: 500, endMs: 2500 }));
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => {
      expect(x.pendingChanged).toHaveBeenLastCalledWith([]);
      expect(x.rowChanged).toHaveBeenCalledWith(expect.any(String));
    });

    const cut = x.repo.view(x.itemId);
    expect(cut).toMatchObject({ sourceId: 'original', canReset: true, markers: request.points });
    expect(cut?.mediaId).not.toBe('original');
    expect(x.media.markersOf(cut?.mediaId ?? '')).toEqual({
      ...NO_MARKERS,
      markers: [{ id: 'mark', name: 'Placeholder cue', atMs: 900 }],
    });
    expect(x.playlists.itemsOf(x.another)[0]).toMatchObject({ mediaId: 'original' });
    expect(x.service.reset(x.itemId, cut?.mediaId ?? '')).toEqual({ ok: true });
    expect(x.repo.view(x.itemId)).toMatchObject({
      mediaId: 'original',
      canReset: false,
      markers: NO_MARKERS,
    });
    expect(x.media.markersOf('original')).toEqual(oldPoints);
    expect(x.repo.playsFull(x.itemId, 'original', oldPoints)).toBe(true);
    const editedPoints = { ...oldPoints, startMs: 150 };
    x.media.setMarkers('original', editedPoints);
    expect(x.repo.view(x.itemId)?.markers).toEqual(editedPoints);
    x.media.setMarkers('original', oldPoints);
    expect(x.repo.playsFull(x.itemId, 'original', oldPoints)).toBe(false);
    expect(await readFile(x.original, 'utf8')).toBe('placeholder original');
    expect((await stat(x.original)).mtimeMs).toBe(mtime);
  });

  it('discards a completed copy if the row was taken out while it waited', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.playlists.removeItems([x.itemId]);
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => {
      expect(x.pendingChanged).toHaveBeenLastCalledWith([]);
    });
    expect(x.rowChanged).not.toHaveBeenCalled();
    await expect(stat(x.output)).rejects.toMatchObject({ code: 'ENOENT' });
    x.playlists.restoreItems([x.itemId]);
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');
  });

  it('keeps a completed cut pending while that row’s video is up, then adopts it once taken off', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.show('original');
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => {
      // The file finished. Either the live guard has been asked or the row was already changed.
      expect(x.isLive.mock.calls.length + x.rowChanged.mock.calls.length).toBeGreaterThan(0);
    });
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');
    expect(x.service.list()).toEqual([x.itemId]);
    expect(x.rowChanged).not.toHaveBeenCalled();

    x.show(null);
    await vi.waitFor(() => {
      expect(x.rowChanged).toHaveBeenCalledOnce();
      expect(x.service.list()).toEqual([]);
    });
    expect(x.repo.row(x.itemId)?.mediaId).not.toBe('original');
  });

  it('refuses to reset a video’s row while that row is live', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(x.rowChanged).toHaveBeenCalledOnce());
    const cut = x.repo.row(x.itemId)?.mediaId;
    if (!cut || cut === 'original') throw new Error('The cut was not adopted');

    x.show(cut);
    expect(x.service.reset(x.itemId, cut)).toMatchObject({ ok: false });
    expect(x.repo.row(x.itemId)?.mediaId).toBe(cut);
    x.show(null);
    expect(x.service.reset(x.itemId, cut)).toEqual({ ok: true });
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');
  });

  it('keeps an accepted cut’s interruption marker across quit and tells the operator once at restart', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.service.close();
    x.finish({ ok: false, stopped: true, message: 'Stopped.' });
    expect(x.kept.load()).toEqual([{ itemId: x.itemId, mediaId: 'original', name: 'Placeholder.mp4' }]);

    const restarted = x.restart();
    restarted.reportInterrupted?.();
    restarted.reportInterrupted?.();
    expect(x.notice).toHaveBeenCalledExactlyOnceWith(
      'The cut of “Placeholder.mp4” wasn’t made because Drashti closed. Open Trim and save it again.',
    );
    expect(x.kept.load()).toEqual([]);
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');
  });
});
