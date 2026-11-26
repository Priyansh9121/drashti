import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import { ConvertService } from './convert-service';

vi.mock(import('node:child_process'), async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: vi.fn(),
}));

vi.mock('./read-info', () => ({
  PROBE_MS: 30_000,
  readInfo: () =>
    Promise.resolve({
      durationMs: 1000,
      video: null,
      audio: { codec: 'wmav2' },
    }),
}));

function fakeEncoders() {
  const children: { child: EventEmitter; part: string; kill: ReturnType<typeof vi.fn> }[] = [];
  vi.mocked(spawn).mockImplementation((_command, args) => {
    const part: unknown = Array.isArray(args) ? args.at(-1) : undefined;
    if (typeof part !== 'string') throw new Error('The encoder was not given a part-file.');
    const kill = vi.fn(() => true);
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      kill,
    });
    writeFileSync(part, 'Placeholder encoded bytes');
    children.push({ child, part, kill });
    return child as unknown as ReturnType<typeof spawn>;
  });
  return children;
}

it('puts an automatic conversion back in the queue if a show starts as its encoder finishes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-live-'));
  const mediaDir = join(dir, 'Media');
  mkdirSync(mediaDir);
  writeFileSync(join(mediaDir, 'sound.wma'), 'Placeholder source bytes');
  const db = openDatabase(join(dir, 'library.sqlite'));
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable) VALUES ('m', 'audio', 'Placeholder sound.wma', 'sound.wma', 0)",
  ).run();

  let busy: string | null = null;
  const children = fakeEncoders();
  const service = new ConvertService({
    db,
    mediaDir,
    ffmpegPath: () => 'placeholder-ffmpeg',
    busy: () => busy,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
    limits: { afterImportMs: 0 },
  });

  try {
    expect(
      service.convertImported({
        items: [
          {
            issues: [
              {
                severity: 'info',
                code: 'converting-media',
                message: 'Placeholder conversion.',
                fix: { kind: 'convert-media', mediaId: 'm', advice: 'Placeholder advice.' },
              },
            ],
          },
        ],
      }),
    ).toBe(1);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const [first] = children;
    if (!first) throw new Error('The encoder did not start.');
    busy = 'Waits while the show is on, then carries on by itself.';
    // As a real child: its exit, then 'close' once its output has ended (the conversion reads its words then: a21).
    first.child.emit('exit', 0);
    first.child.emit('close', 0);

    await vi.waitFor(() => expect(service.list()[0]?.state).not.toBe('converting'));
    expect(service.list()[0]).toMatchObject({ state: 'waiting', note: busy, convertedId: null });
    expect(existsSync(first.part)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) FROM media_conversions').pluck().get()).toBe(0);
  } finally {
    service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('lets a saved copy opt into the show gate while legacy saves still run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-copy-live-'));
  const db = openDatabase(join(dir, 'library.sqlite'));
  const source = join(dir, 'Placeholder source.mp4');
  const gatedPath = join(dir, 'Placeholder trimmed.mp4');
  const legacyPath = join(dir, 'Placeholder legacy.mp4');
  writeFileSync(source, 'Placeholder source bytes');

  let showBusy = true;
  const children = fakeEncoders();
  const service = new ConvertService({
    db,
    mediaDir: dir,
    ffmpegPath: () => 'placeholder-ffmpeg',
    busy: () => null,
    showBusy: () => showBusy,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
  });

  const info = { durationMs: 1000, video: null, audio: null };
  const copy = { args: (tmp: string) => [tmp], lengthMs: 1000 };
  const waiting = vi.fn();
  const gated = { ...copy, waiting, waitForShow: true };
  const current = async (count: number) => {
    await vi.waitFor(() => expect(children).toHaveLength(count), { timeout: 2500 });
    const child = children[count - 1];
    if (!child) throw new Error('The encoder did not start.');
    return child;
  };

  try {
    const trim = service.saveCopy(source, gatedPath, info, gated);
    expect(children).toHaveLength(0);
    expect(waiting).toHaveBeenCalledWith('Waits while the show is on, then carries on by itself.');

    const legacy = service.saveCopy(source, legacyPath, info, copy);
    (await current(1)).child.emit('close', 0);
    await expect(legacy.done).resolves.toEqual({ ok: true, copy: legacyPath });

    showBusy = false;
    const interrupted = await current(2);
    showBusy = true;
    service.activityChanged();
    expect(interrupted.kill).toHaveBeenCalledOnce();
    interrupted.child.emit('close', 0);
    await vi.waitFor(() => expect(existsSync(interrupted.part)).toBe(false));
    expect(existsSync(gatedPath)).toBe(false);

    showBusy = false;
    const finishing = await current(3);
    showBusy = true;
    finishing.child.emit('close', 0);
    await vi.waitFor(() => expect(existsSync(finishing.part)).toBe(false));
    expect(existsSync(gatedPath)).toBe(false);

    showBusy = false;
    (await current(4)).child.emit('close', 0);
    await expect(trim.done).resolves.toEqual({ ok: true, copy: gatedPath });
  } finally {
    service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

it('holds a save the operator asked for only while saveBusy says why, never for a still up (alpha.22)', async () => {
  // The owner's "Trim on a row": a still slide, a picture or the Wallpaper up (showBusy) no longer holds it; what plays,
  // the stream or a recording does (shared/save-waits.ts), stopping it as it starts, and its words reach the save.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-copy-playing-'));
  const db = openDatabase(join(dir, 'library.sqlite'));
  const source = join(dir, 'Placeholder source.mp4');
  const dest = join(dir, 'Placeholder trimmed.mp4');
  writeFileSync(source, 'Placeholder source bytes');
  let saveBusy: string | null = 'Waiting: a video is playing';
  const children = fakeEncoders();
  const service = new ConvertService({
    db,
    mediaDir: dir,
    ffmpegPath: () => 'placeholder-ffmpeg',
    busy: () => null,
    showBusy: () => true,
    saveBusy: () => saveBusy,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
  });
  const info = { durationMs: 1000, video: null, audio: null };
  const waiting = vi.fn();
  try {
    const save = service.saveCopy(source, dest, info, {
      args: (tmp: string) => [tmp],
      lengthMs: 1000,
      waitForPlaying: true,
      waiting,
    });
    expect(children).toHaveLength(0);
    expect(waiting).toHaveBeenLastCalledWith('Waiting: a video is playing');
    // Paused: a still is up, yet it goes on.
    saveBusy = null;
    await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 2500 });
    expect(waiting).toHaveBeenLastCalledWith(null);
    // On air: it stops, and says so.
    saveBusy = 'Waiting: the stream is on air';
    service.activityChanged();
    const first = children[0];
    if (!first) throw new Error('The encoder did not start.');
    expect(first.kill).toHaveBeenCalledOnce();
    first.child.emit('close', 0);
    await vi.waitFor(() => expect(waiting).toHaveBeenLastCalledWith('Waiting: the stream is on air'), {
      timeout: 2500,
    });
    expect(existsSync(dest)).toBe(false);
    saveBusy = null;
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 2500 });
    children[1]?.child.emit('close', 0);
    await expect(save.done).resolves.toEqual({ ok: true, copy: dest });
  } finally {
    service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

it('still holds a save the operator asked for whatever the stream check says, when saveBusy says nothing (the save-trim review SHOULD-5)', async () => {
  // A save that waits only for what plays (waitForPlaying) skipped busy() altogether: a reason busy() gained later
  // would never hold it. Both are asked; the save's own words when both say why.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-copy-busy-'));
  const db = openDatabase(join(dir, 'library.sqlite'));
  const source = join(dir, 'Placeholder source.mp4');
  const dest = join(dir, 'Placeholder trimmed.mp4');
  writeFileSync(source, 'Placeholder source bytes');
  const streamWords = 'Waits while the stream is on air or recording, then carries on by itself.';
  let busy: string | null = streamWords;
  let saveBusy: string | null = null;
  const children = fakeEncoders();
  const service = new ConvertService({
    db,
    mediaDir: dir,
    ffmpegPath: () => 'placeholder-ffmpeg',
    busy: () => busy,
    showBusy: () => false,
    saveBusy: () => saveBusy,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
  });
  const info = { durationMs: 1000, video: null, audio: null };
  const waiting = vi.fn();
  try {
    const save = service.saveCopy(source, dest, info, {
      args: (tmp: string) => [tmp],
      lengthMs: 1000,
      waitForPlaying: true,
      waiting,
    });
    expect(children).toHaveLength(0);
    expect(waiting).toHaveBeenLastCalledWith(streamWords);
    // Both say why: the save's own words.
    saveBusy = 'Waiting: the stream is on air';
    await vi.waitFor(() => expect(waiting).toHaveBeenLastCalledWith('Waiting: the stream is on air'), {
      timeout: 2500,
    });
    expect(children).toHaveLength(0);
    // The save's own reason gone, the stream check's still there: it still waits.
    saveBusy = null;
    await vi.waitFor(() => expect(waiting).toHaveBeenLastCalledWith(streamWords), { timeout: 2500 });
    expect(children).toHaveLength(0);
    // Running, it stops when the stream check says why, though saveBusy says nothing.
    busy = null;
    await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 2500 });
    busy = streamWords;
    service.activityChanged();
    const first = children[0];
    if (!first) throw new Error('The encoder did not start.');
    expect(first.kill).toHaveBeenCalledOnce();
    first.child.emit('close', 0);
    await vi.waitFor(() => expect(waiting).toHaveBeenLastCalledWith(streamWords), { timeout: 2500 });
    expect(existsSync(dest)).toBe(false);
    busy = null;
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 2500 });
    children[1]?.child.emit('close', 0);
    await expect(save.done).resolves.toEqual({ ok: true, copy: dest });
  } finally {
    service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
