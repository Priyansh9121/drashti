import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_MARKERS } from '../../shared/markers';
import type { Db } from '../db/database';
import { openDatabase } from '../db/database';
import { sha256File } from '../import/media-store';
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

async function setup(frameAt = (_path: string, atMs: number) => Promise.resolve<number | null>(atMs)) {
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
  let resolveCopy: (value: FitResult) => void = () => undefined;
  const pendingChanged = vi.fn();
  const cancel = vi.fn(() => true);
  const rowChanged = vi.fn();
  const notice = vi.fn();
  let liveMedia: string | null = null;
  const isLive = vi.fn((item: string, media: string) => item === itemId && media === liveMedia);
  // Nothing up on LIVE (and no stream or recording): background work may go on.
  const quiet = vi.fn(() => liveMedia === null);
  const hash = vi.fn((file: string, _signal: AbortSignal) => sha256File(file));
  let stored: KeptTrim[] = [];
  const kept = {
    load: () => stored,
    save: (cuts: KeptTrim[]) => {
      stored = cuts;
    },
  };
  let beforePublish: ((tmp: string, dest: string) => void) | undefined;
  const queue = vi.fn((_input: TrimCopyInput, publish?: (tmp: string, dest: string) => void) => {
    beforePublish = publish;
    const done = new Promise<FitResult>((resolve) => {
      resolveCopy = resolve;
    });
    return { id: 'copy', done };
  });
  const publish = (tmp = output, dest = output) => {
    beforePublish?.(tmp, dest);
    beforePublish = undefined;
  };
  const finish = (value: FitResult) => {
    if (value.ok && value.copy) publish(value.copy, value.copy);
    resolveCopy(value);
  };
  let storedCopies: { path: string; identity: string }[] = [];
  const copies = {
    load: () => storedCopies,
    save: (next: typeof storedCopies) => {
      storedCopies = next;
    },
  };
  const trashDir = join(dir, 'Trash');
  await mkdir(trashDir);
  const trash = vi.fn((file: string) => rename(file, join(trashDir, basename(file))));
  const spaceProblem = vi.fn<() => string | null>(() => null);
  const deps = {
    repo,
    mediaDir: dir,
    readInfo: (path: string) =>
      Promise.resolve({ ...info, durationMs: path === output ? 2000 : info.durationMs }),
    queue,
    spaceProblem,
    frameAt,
    cancel,
    pendingChanged,
    rowChanged,
    markersChanged: vi.fn(),
    notice,
    isLive,
    quiet,
    hash,
    kept,
    copies,
    trash,
  };
  const restart = () => new PlaylistTrims(deps);
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
    spaceProblem,
    finish,
    publish,
    copies,
    trash,
    cancel,
    pendingChanged,
    rowChanged,
    notice,
    isLive,
    quiet,
    hash,
    kept,
    show: (media: string | null) => {
      liveMedia = media;
      service.activityChanged();
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

/** The next start after Drashti closed with the row's cut accepted but not made: the cut waits to carry on. */
async function waitingAfterRestart(x: Awaited<ReturnType<typeof setup>>) {
  expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
  x.service.close();
  x.finish({ ok: false, stopped: true, message: 'Stopped.' });
  x.pendingChanged.mockClear();
  return x.restart();
}

/** A second original video in Media, at the end of the playlist: its row. */
async function secondOriginal(x: Awaited<ReturnType<typeof setup>>) {
  db.prepare(
    "INSERT INTO media (id, kind, name, path) VALUES ('second', 'video', 'Placeholder second.mp4', 'second.mp4')",
  ).run();
  await writeFile(join(dir, 'second.mp4'), 'placeholder second original');
  const [row = ''] = x.playlists.addItems(x.playlist, null, [{ kind: 'media', mediaId: 'second' }]);
  return row;
}

describe('trimming a playlist video', () => {
  it('offers Reset for old file playback points and clears them only for that row', async () => {
    const x = await setup();
    x.media.setMarkers('original', request.points);
    expect(x.repo.view(x.itemId)?.canReset).toBe(true);
    expect(
      await x.service.apply(x.itemId, {
        mediaId: 'original',
        points: { ...request.points, startMs: null, endMs: null },
      }),
    ).toEqual({ ok: true });
    expect(x.queue).not.toHaveBeenCalled();
    expect(x.repo.view(x.itemId)?.markers).toMatchObject({ startMs: null, endMs: null });
    expect(x.media.markersOf('original')).toEqual(request.points);
  });

  it('keeps the marker edits made while resetting a cut in the same save', async () => {
    const x = await setup();
    const removed = { id: 'remove', name: 'Placeholder to remove', atMs: 1500 };
    const untouched = { id: 'keep', name: 'Placeholder to keep', atMs: 1800 };
    const added = { id: 'new', name: 'Placeholder new cue', atMs: 800 };
    const original = { startMs: 100, endMs: 3000, markers: [removed, untouched] };
    x.media.setMarkers('original', original);
    expect(
      await x.service.apply(x.itemId, {
        ...request,
        points: { ...request.points, markers: [...request.points.markers, removed, untouched] },
      }),
    ).toEqual({ ok: true });
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => {
      expect(x.repo.view(x.itemId)?.mediaId).not.toBe('original');
    });

    const cut = x.repo.view(x.itemId);
    if (!cut) throw new Error('The cut is missing.');
    expect(
      await x.service.apply(x.itemId, {
        mediaId: cut.mediaId,
        points: {
          ...NO_MARKERS,
          markers: [...cut.markers.markers.filter((m) => m.id !== removed.id), added],
        },
      }),
    ).toEqual({ ok: true });
    expect(x.repo.view(x.itemId)).toMatchObject({
      mediaId: 'original',
      markers: { ...NO_MARKERS, markers: [added, untouched] },
    });
    expect(x.media.markersOf('original')).toEqual({ ...original, markers: [added, untouched] });
  });

  it('refuses Save before queueing a cut when its estimated size will not fit', async () => {
    const x = await setup();
    const message = 'Drashti keeps 2 GB free. Free up some space, then save it again.';
    x.spaceProblem.mockReturnValue(message);
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: false, message });
    expect(x.spaceProblem).toHaveBeenCalledWith(x.original, info.durationMs, 2000);
    expect(x.queue).not.toHaveBeenCalled();
    expect(x.service.list()).toEqual([]);
    expect(x.kept.load()).toEqual([]);
  });

  it('uses the requested start when the preceding frame could not be read', async () => {
    const x = await setup(() => Promise.resolve(null));
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    expect(x.queue.mock.calls[0]?.[0]).toMatchObject({ startMs: request.points.startMs });
  });

  it('keeps the original when Start snaps to its first frame and End is empty', async () => {
    const x = await setup(() => Promise.resolve(0));
    const points = { ...NO_MARKERS, startMs: 10, markers: request.points.markers };
    expect(await x.service.apply(x.itemId, { mediaId: 'original', points })).toEqual({ ok: true });
    expect(x.queue).not.toHaveBeenCalled();
    expect(x.media.markersOf('original')).toEqual({ ...points, startMs: null });
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
    expect(x.queue.mock.calls[0]?.[0]).toMatchObject({ startMs: 500, endMs: 2500 });
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
    const asked = x.quiet.mock.calls.length;
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => {
      // The file finished. It waits for a quiet moment (its row's video is up) or the row was already changed.
      expect(x.quiet.mock.calls.length - asked + x.rowChanged.mock.calls.length).toBeGreaterThan(0);
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

  it('stops the first cut while its row is live and never adopts a late copy', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.show('original');
    x.publish();
    expect(x.service.stop(x.itemId, 'different-media')).toMatchObject({ ok: false });
    expect(x.service.list()).toEqual([x.itemId]);
    expect(x.service.stop(x.itemId, 'original')).toEqual({ ok: true });
    expect(x.cancel).toHaveBeenCalledExactlyOnceWith('copy');
    expect(x.service.list()).toEqual([]);
    expect(x.kept.load()).toEqual([]);

    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(async () => {
      await expect(stat(x.output)).rejects.toMatchObject({ code: 'ENOENT' });
    });
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');
    expect(x.rowChanged).not.toHaveBeenCalled();
    expect(await readFile(x.original, 'utf8')).toBe('placeholder original');
  });

  it('shows black-and-silence points from the copy in original time', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(x.repo.row(x.itemId)?.mediaId).not.toBe('original'));
    const cutId = x.repo.row(x.itemId)?.mediaId ?? '';
    x.media.setMarkers(cutId, { ...NO_MARKERS, startMs: 250, endMs: 1550 });

    expect(x.repo.view(x.itemId)?.markers).toMatchObject({ startMs: 750, endMs: 2050 });
  });

  it.each([
    ['End moved out, Start left', { startMs: 750, endMs: 3000 }, { cutStartMs: 720, cutEndMs: 3000 }, 30],
    ['Start moved out, End left', { startMs: 200, endMs: 2050 }, { cutStartMs: 200, cutEndMs: 2050 }, null],
    ['both moved out', { startMs: 200, endMs: 3000 }, { cutStartMs: 200, cutEndMs: 3000 }, null],
  ] as const)(
    'plays a wider cut as saved, keeping a black-and-silence point only where its handle was left (%s)',
    async (_name, asked, cut, carriedStart) => {
      // The frame at or before 0:00.750 starts at 0:00.720.
      const x = await setup((_path, atMs) => Promise.resolve(atMs === 750 ? 720 : atMs));
      expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
      x.finish({ ok: true, copy: x.output });
      await vi.waitFor(() => expect(x.repo.row(x.itemId)?.mediaId).not.toBe('original'));
      const firstId = x.repo.row(x.itemId)?.mediaId ?? '';
      // Trim black and silence on the cut (500 to 2500): Trim shows 0:00.750 to 0:02.050.
      x.media.setMarkers(firstId, { ...NO_MARKERS, startMs: 250, endMs: 1550 });
      expect(x.repo.view(x.itemId)?.markers).toMatchObject({ startMs: 750, endMs: 2050 });

      const wider = join(dir, 'Placeholder wider.mp4');
      await writeFile(wider, 'placeholder wider trim');
      expect(
        await x.service.apply(x.itemId, { mediaId: firstId, points: { ...NO_MARKERS, ...asked } }),
      ).toEqual({ ok: true });
      x.finish({ ok: true, copy: wider });
      await vi.waitFor(() => expect(x.repo.row(x.itemId)?.mediaId).not.toBe(firstId));
      expect(x.repo.row(x.itemId)).toMatchObject(cut);
      // A handle left where Trim showed it keeps its point (to the millisecond, inside the frame the cut starts
      // on); a handle the operator moved stands as saved.
      expect(x.media.markersOf(x.repo.row(x.itemId)?.mediaId ?? '')).toMatchObject({
        startMs: carriedStart,
        endMs: null,
      });
      expect(x.repo.view(x.itemId)?.markers).toMatchObject(asked);
    },
  );

  it('restores the playlist reset when the operator undoes black-and-silence points', async () => {
    const x = await setup();
    const original = { ...NO_MARKERS, endMs: 3400 };
    const detected = { startMs: 800, endMs: null };
    x.media.setMarkers('original', original);
    expect(x.service.reset(x.itemId, 'original')).toEqual({ ok: true });
    expect(x.repo.view(x.itemId)?.markers).toEqual(NO_MARKERS);

    expect(x.repo.setSoundEdges('original', detected)).toEqual({ startMs: null, endMs: 3400 });
    expect(x.repo.view(x.itemId)?.markers).toMatchObject(detected);
    const marker = { id: 'new', name: 'Placeholder cue', atMs: 2200 };
    x.media.setMarkers('original', { ...detected, markers: [marker] });

    // The Sound Undo uses the ordinary marker setter and preserves any intervening cue edits.
    x.media.setMarkers('original', { ...original, markers: [marker] });
    expect(x.repo.view(x.itemId)?.markers).toEqual({ ...NO_MARKERS, markers: [marker] });
    const otherRowId = x.playlists.itemsOf(x.another)[0]?.id ?? '';
    expect(x.repo.view(otherRowId)?.markers).toEqual({ ...original, markers: [marker] });

    // A later manual change, even back to the same detection, consumes the reset normally.
    x.media.setMarkers('original', { ...detected, markers: [marker] });
    x.media.setMarkers('original', { ...original, markers: [marker] });
    expect(x.repo.view(x.itemId)?.markers).toEqual({ ...original, markers: [marker] });
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

  it('records a cut before publishing it and trashes the unadopted file after a restart', async () => {
    const x = await setup();
    const tmp = join(dir, 'Placeholder temporary cut.mp4');
    await rename(x.output, tmp);
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.publish(tmp, x.output);
    expect(x.copies.load().map((copy) => copy.path)).toEqual([basename(x.output)]);
    await expect(stat(x.output)).rejects.toMatchObject({ code: 'ENOENT' });
    await rename(tmp, x.output);

    x.trash.mockRejectedValueOnce(new Error('Trash temporarily unavailable'));
    await x.restart().cleanupCopies();
    expect(x.copies.load()).toHaveLength(1);
    await x.restart().cleanupCopies();
    expect(x.trash).toHaveBeenLastCalledWith(x.output);
    expect(x.copies.load()).toEqual([]);
    expect(await readFile(join(dir, 'Trash', basename(x.output)), 'utf8')).toBe('placeholder trim');
    expect(await readFile(x.original, 'utf8')).toBe('placeholder original');
  });

  it('cleans the recorded hidden Trim part after a crash before the rename', async () => {
    const x = await setup();
    const part = join(dir, '.11111111-1111-4111-8111-111111111111.mp4');
    const unrelated = join(dir, '.22222222-2222-4222-8222-222222222222.mp4');
    await rename(x.output, part);
    await writeFile(unrelated, 'placeholder unrelated part');
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.publish(part, x.output);
    expect(x.copies.load()).toHaveLength(1);
    await x.service.cleanupCopies();
    expect(x.trash).not.toHaveBeenCalled();

    await x.restart().cleanupCopies();
    expect(x.trash).toHaveBeenCalledTimes(1);
    expect(x.trash).toHaveBeenCalledWith(part);
    expect(x.copies.load()).toEqual([]);
    expect(await readFile(join(dir, 'Trash', basename(part)), 'utf8')).toBe('placeholder trim');
    expect(await readFile(unrelated, 'utf8')).toBe('placeholder unrelated part');
  });

  it.each(['referenced', 'replaced'] as const)('keeps a %s file at the saved path', async (kind) => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.publish();
    expect(x.copies.load()).toHaveLength(1);
    if (kind === 'referenced') {
      db.prepare("INSERT INTO media (id, kind, name, path) VALUES ('cut', 'video', 'Cut', ?)").run(x.output);
    } else {
      await rename(x.output, join(dir, 'Placeholder original cut.mp4'));
      await writeFile(x.output, 'placeholder replacement');
    }
    await x.restart().cleanupCopies();
    expect(x.trash).not.toHaveBeenCalled();
    expect(x.copies.load()).toEqual([]);
    expect(await readFile(x.output, 'utf8')).toBe(
      kind === 'referenced' ? 'placeholder trim' : 'placeholder replacement',
    );
  });

  it('queues a waiting cut again with its accepted points after restart', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    expect(x.kept.load()).toMatchObject([
      { itemId: x.itemId, mediaId: 'original', request: { points: request.points } },
    ]);
    x.service.close();
    x.finish({ ok: false, stopped: true, message: 'Stopped.' });

    const restarted = x.restart();
    restarted.resumeWhenQuiet();
    await vi.waitFor(() => expect(x.queue).toHaveBeenCalledTimes(2));
    expect(x.queue.mock.calls[1]?.[0]).toMatchObject({ startMs: 500, endMs: 2500 });
    expect(restarted.list()).toEqual([x.itemId]);
    expect(restarted.reportInterrupted()).toBeNull();
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');

    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(restarted.list()).toEqual([]));
    expect(x.repo.view(x.itemId)?.markers).toEqual(request.points);
  });

  it('resumes a completed cut without encoding again and keeps the live video in place', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.show('original');
    const asked = x.quiet.mock.calls.length;
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(x.quiet.mock.calls.length).toBeGreaterThan(asked));
    x.service.close();

    // Recovery put the row's video back on LIVE: the finished cut waits, kept, for nothing to be up.
    const restarted = x.restart();
    expect(restarted.reportInterrupted()).toBeNull();
    restarted.resumeWhenQuiet();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(x.queue).toHaveBeenCalledOnce();
    expect(x.hash).not.toHaveBeenCalled();
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');
    expect(await readFile(x.output, 'utf8')).toBe('placeholder trim');
    expect(x.trash).not.toHaveBeenCalled();

    x.show(null);
    restarted.activityChanged();
    await vi.waitFor(() => expect(restarted.list()).toEqual([]));
    expect(x.repo.view(x.itemId)?.markers).toEqual(request.points);
    expect(x.kept.load()).toEqual([]);
    expect(x.copies.load()).toEqual([]);
  });

  it('names at once only the cuts that cannot carry on; the rest carry on once the start is known and nothing is up', async () => {
    const x = await setup();
    const secondRow = await secondOriginal(x);
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    expect(await x.service.apply(secondRow, { ...request, mediaId: 'second' })).toEqual({ ok: true });
    x.service.close();
    // The second original changed while Drashti was closed: its cut cannot carry on.
    await writeFile(join(dir, 'second.mp4'), 'placeholder replacement of the second original');

    const restarted = x.restart();
    // Both rows say Preparing from the start (TM-1).
    expect(restarted.list()).toEqual([x.itemId, secondRow]);
    // The start notice waits for no FFmpeg: it names the cut that cannot carry on, and only that one, with why
    // (TM-3); that row stops saying Preparing.
    expect(restarted.reportInterrupted()).toBe(
      'The cut of “Placeholder second.mp4” wasn’t made because its original video changed while Drashti was closed. Open Trim and save it again.',
    );
    expect(restarted.list()).toEqual([x.itemId]);
    expect(x.pendingChanged).toHaveBeenLastCalledWith([x.itemId]);
    expect(restarted.reportInterrupted()).toBeNull();
    expect(x.queue).toHaveBeenCalledTimes(2);
    // Recovery put a video back on LIVE: the cut waits for the start to be known, then for nothing to be up, its row
    // saying Preparing all the while.
    x.show('original');
    restarted.resumeWhenQuiet();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(x.queue).toHaveBeenCalledTimes(2);
    expect(restarted.list()).toEqual([x.itemId]);
    x.show(null);
    restarted.activityChanged();
    await vi.waitFor(() => expect(x.queue).toHaveBeenCalledTimes(3));
    expect(x.queue.mock.calls[2]?.[0]).toMatchObject({ path: x.original, startMs: 500, endMs: 2500 });
    expect(restarted.list()).toEqual([x.itemId]);
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(restarted.list()).toEqual([]));
    expect(x.repo.view(x.itemId)?.markers).toEqual(request.points);
  });

  /*
   * A cut waiting to carry on after a restart (TM-1; review LOW-1 of afdcf0ed): its row says Preparing from the start,
   * as any cut being made does, and the cut is let go only once the operator's Stop or Reset is accepted.
   */

  it('shows a cut waiting to carry on after a restart as Preparing from the start, until it is taken in', async () => {
    const x = await setup();
    const restarted = await waitingAfterRestart(x);
    expect(restarted.list()).toEqual([x.itemId]);
    expect(restarted.reportInterrupted()).toBeNull();
    expect(restarted.list()).toEqual([x.itemId]);
    restarted.resumeWhenQuiet();
    await vi.waitFor(() => expect(x.queue).toHaveBeenCalledTimes(2));
    expect(restarted.list()).toEqual([x.itemId]);
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(restarted.list()).toEqual([]));
    expect(x.pendingChanged).toHaveBeenLastCalledWith([]);
    expect(x.repo.view(x.itemId)?.markers).toEqual(request.points);
  });

  it('stops saying Preparing when a waiting cut cannot be made after all, and says why', async () => {
    const x = await setup();
    const restarted = await waitingAfterRestart(x);
    x.spaceProblem.mockReturnValue(
      'This disk has less than 2 GB free. Free up some space, then save it again.',
    );
    restarted.resumeWhenQuiet();
    await vi.waitFor(() => {
      expect(x.notice).toHaveBeenCalledWith(
        'Drashti couldn’t make the cut of “Placeholder.mp4”. Free up some disk space, then open Trim and save it again.',
      );
    });
    expect(restarted.list()).toEqual([]);
    expect(x.pendingChanged).toHaveBeenLastCalledWith([]);
    expect(x.kept.load()).toEqual([]);
  });

  it.each<[string, (x: Awaited<ReturnType<typeof setup>>, restarted: PlaylistTrims) => Promise<void>]>([
    [
      'a Reset refused while its row’s video is up',
      async (x, restarted) => {
        x.show('original');
        expect(restarted.reset(x.itemId, 'original')).toEqual({
          ok: false,
          message: 'Take the video off before resetting this row.',
        });
        x.show(null);
      },
    ],
    [
      'a Trim saved while it waits (refused, as while any cut is being made)',
      async (x, restarted) => {
        expect(
          await restarted.apply(x.itemId, { ...request, points: { ...request.points, endMs: 3000 } }),
        ).toEqual({
          ok: false,
          message:
            'This video is already being trimmed. Wait for Preparing to clear, or open Trim again and press Stop.',
        });
      },
    ],
    [
      'a save of markers alone while it waits',
      async (x, restarted) => {
        const points = { ...NO_MARKERS, markers: [{ id: 'cue', name: 'Placeholder cue', atMs: 900 }] };
        expect(await restarted.apply(x.itemId, { mediaId: 'original', points })).toMatchObject({ ok: false });
        // Nothing saved: the cut, once taken in, carries the markers it was accepted with.
        expect(x.media.markersOf('original')).toBeNull();
      },
    ],
  ])('keeps a cut waiting to carry on through %s', async (_name, act) => {
    const x = await setup();
    const restarted = await waitingAfterRestart(x);
    await act(x, restarted);
    expect(restarted.list()).toEqual([x.itemId]);
    expect(x.kept.load()).toMatchObject([{ itemId: x.itemId, request: { points: request.points } }]);
    restarted.resumeWhenQuiet();
    await vi.waitFor(() => expect(x.queue).toHaveBeenCalledTimes(2));
    expect(x.queue.mock.calls[1]?.[0]).toMatchObject({ startMs: 500, endMs: 2500 });
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(restarted.list()).toEqual([]));
    expect(x.repo.view(x.itemId)?.markers).toEqual(request.points);
  });

  it('lets a cut waiting to carry on go once Stop is accepted', async () => {
    const x = await setup();
    const restarted = await waitingAfterRestart(x);
    expect(restarted.stop(x.itemId, 'original')).toEqual({ ok: true });
    expect(restarted.list()).toEqual([]);
    expect(x.pendingChanged).toHaveBeenLastCalledWith([]);
    expect(x.kept.load()).toEqual([]);
    expect(restarted.stop(x.itemId, 'original')).toMatchObject({ ok: false });
    restarted.resumeWhenQuiet();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(x.queue).toHaveBeenCalledOnce();
    expect(x.repo.row(x.itemId)?.mediaId).toBe('original');
  });

  it('lets a cut waiting to carry on go once a Reset is accepted', async () => {
    const x = await setup();
    // Points of the file's own (Media's): Reset to original is offered on the row.
    x.media.setMarkers('original', { ...NO_MARKERS, startMs: 100, endMs: 3000 });
    const restarted = await waitingAfterRestart(x);
    expect(restarted.reset(x.itemId, 'original')).toEqual({ ok: true });
    expect(restarted.list()).toEqual([]);
    expect(x.pendingChanged).toHaveBeenLastCalledWith([]);
    expect(x.kept.load()).toEqual([]);
    restarted.resumeWhenQuiet();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(x.queue).toHaveBeenCalledOnce();
    expect(x.repo.view(x.itemId)?.markers).toMatchObject({ startMs: null, endMs: null });
  });

  /* The start notice says why a cut cannot carry on (TM-3; review LOW-6 of d487b875, LOW-4 of afdcf0ed). */

  it('says why cuts cannot carry on: Drashti closed before they were made, or their original video changed', async () => {
    const x = await setup();
    const secondRow = await secondOriginal(x);
    expect(await x.service.apply(secondRow, { ...request, mediaId: 'second' })).toEqual({ ok: true });
    x.service.close();
    await writeFile(join(dir, 'second.mp4'), 'placeholder replacement of the second original');
    // The first row's record is from before cuts carried on: Drashti closed before it was made.
    x.kept.save([{ itemId: x.itemId, mediaId: 'original', name: 'Placeholder.mp4' }, ...x.kept.load()]);
    expect(x.restart().reportInterrupted()).toBe(
      'The cut of “Placeholder.mp4” wasn’t made because Drashti closed. The cut of “Placeholder second.mp4” wasn’t made because its original video changed while Drashti was closed. Open Trim and save them again.',
    );
  });

  it('names several cuts whose original videos changed in one sentence', async () => {
    const x = await setup();
    const secondRow = await secondOriginal(x);
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    expect(await x.service.apply(secondRow, { ...request, mediaId: 'second' })).toEqual({ ok: true });
    x.service.close();
    await writeFile(x.original, 'placeholder replacement of the original');
    await writeFile(join(dir, 'second.mp4'), 'placeholder replacement of the second original');
    expect(x.restart().reportInterrupted()).toBe(
      'The cuts of “Placeholder.mp4” and “Placeholder second.mp4” weren’t made because their original videos changed while Drashti was closed. Open Trim and save them again.',
    );
  });

  it('checks a finished cut off Main’s thread, and only while nothing is up', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    // Another video is up on LIVE (not this row's).
    x.show('another');
    const asked = x.quiet.mock.calls.length;
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(x.quiet.mock.calls.length).toBeGreaterThan(asked));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(x.hash).not.toHaveBeenCalled();
    expect(x.rowChanged).not.toHaveBeenCalled();
    expect(x.service.list()).toEqual([x.itemId]);

    x.show(null);
    await vi.waitFor(() => expect(x.rowChanged).toHaveBeenCalledOnce());
    expect(x.hash).toHaveBeenCalledExactlyOnceWith(x.output, expect.any(AbortSignal));
  });

  it('stops checking a finished cut when the show starts, and checks it again once nothing is up', async () => {
    const x = await setup();
    let checking: AbortSignal | undefined;
    x.hash.mockImplementationOnce(
      (_file, signal) =>
        new Promise((_resolve, reject) => {
          checking = signal;
          signal.addEventListener('abort', () => reject(new Error('Stopped.')), { once: true });
        }),
    );
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.finish({ ok: true, copy: x.output });
    await vi.waitFor(() => expect(x.hash).toHaveBeenCalledOnce());
    x.show('another');
    expect(checking?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(x.hash).toHaveBeenCalledOnce();
    expect(x.rowChanged).not.toHaveBeenCalled();

    x.show(null);
    await vi.waitFor(() => expect(x.rowChanged).toHaveBeenCalledOnce());
    expect(x.hash).toHaveBeenCalledTimes(2);
    expect(x.notice).not.toHaveBeenCalled();
  });

  it('reports an old interruption record once and preserves a changed source', async () => {
    const x = await setup();
    x.kept.save([{ itemId: x.itemId, mediaId: 'original', name: 'Placeholder.mp4' }]);
    const legacy = x.restart();
    legacy.resumeWhenQuiet();
    expect(legacy.reportInterrupted()).toBe(
      'The cut of “Placeholder.mp4” wasn’t made because Drashti closed. Open Trim and save it again.',
    );
    expect(legacy.reportInterrupted()).toBeNull();

    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.service.close();
    x.finish({ ok: false, stopped: true, message: 'Stopped.' });
    await writeFile(x.original, 'placeholder replacement of the original');
    const restarted = x.restart();
    restarted.resumeWhenQuiet();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(x.queue).toHaveBeenCalledOnce();
    expect(restarted.reportInterrupted()).toContain('Open Trim and save it again.');
    expect(await readFile(x.original, 'utf8')).toBe('placeholder replacement of the original');
  });

  it.each([
    ['Drashti’s copy of FFmpeg is missing. Install Drashti again.', 'Install Drashti again.'],
    [
      'Stopped: saving it took longer than 13 minutes (four times its length, and 5 minutes more), so FFmpeg may be stuck.',
      'It took too long. Choose a shorter part and save it again.',
    ],
  ])('keeps the next step when making a cut fails: %s', async (message, help) => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.finish({ ok: false, message });
    await vi.waitFor(() => {
      expect(x.notice).toHaveBeenCalledWith(`Drashti couldn’t make the cut of “Placeholder.mp4”. ${help}`);
    });
  });

  it('names a failed cut and keeps the free-space instruction', async () => {
    const x = await setup();
    expect(await x.service.apply(x.itemId, request)).toEqual({ ok: true });
    x.finish({
      ok: false,
      message: 'This disk has less than 2 GB free. Free up some space, then save it again.',
    });
    await vi.waitFor(() => {
      expect(x.notice).toHaveBeenCalledWith(
        'Drashti couldn’t make the cut of “Placeholder.mp4”. Free up some disk space, then open Trim and save it again.',
      );
    });
    expect(x.kept.load()).toEqual([]);
  });
});
