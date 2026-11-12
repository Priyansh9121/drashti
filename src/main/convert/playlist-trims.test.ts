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
  const queue = vi.fn((_input: TrimCopyInput) => ({ id: 'copy', done }));
  const service = new PlaylistTrims({
    repo,
    mediaDir: dir,
    readInfo: (path) => Promise.resolve({ ...info, durationMs: path === output ? 2000 : info.durationMs }),
    queue,
    cancel: () => true,
    pendingChanged,
    rowChanged,
    markersChanged: vi.fn(),
    notice: vi.fn(),
  });
  return {
    service,
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
});
