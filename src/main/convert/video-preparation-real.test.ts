import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../db/database';
import { sha256File } from '../import/media-store';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { testFfmpeg } from '../testing/ffmpeg-here';
import { ConvertService } from './convert-service';
import type { MediaInfo } from './plan';

const ffmpeg = testFfmpeg({ linux: true });
let dir = '';
let db: Db;
let service: ConvertService;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
function start(alpha = false) {
  dir = mkdtempSync(join(tmpdir(), 'drashti-prepare-real-'));
  const source = join(dir, alpha ? 'placeholder.webm' : 'placeholder.mp4');
  const graph = alpha ? 'color=red@0.5:s=64x48:r=25:d=1,format=yuva420p' : 'testsrc2=s=64x48:r=25:d=1';
  const made = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-threads',
      '1',
      '-f',
      'lavfi',
      '-i',
      graph,
      ...(alpha
        ? ['-c:v', 'libvpx-vp9', '-auto-alt-ref', '0', '-pix_fmt', 'yuva420p']
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']),
      '-threads',
      '1',
      source,
    ],
    { env: ffmpegEnv() },
  );
  expect(made.status).toBe(0);
  db = openDatabase(join(dir, 'library.sqlite'));
  cleanup.push(() => db.close());
  const active = new Set<number>();
  let maximum = 0;
  service = new ConvertService({
    db,
    mediaDir: dir,
    ffmpegPath: () => ffmpeg,
    busy: () => null,
    showBusy: () => false,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
    children: {
      started: (pid) => {
        if (pid !== undefined) active.add(pid);
        maximum = Math.max(maximum, active.size);
      },
      ended: (pid) => {
        if (pid !== undefined) active.delete(pid);
      },
    },
  });
  cleanup.push(() => service.close());
  return { source, maximum: () => maximum };
}
const unknownInfo: MediaInfo = { durationMs: null, video: null, audio: null };
it('probes, encodes, validates and registers through the same low-priority worker without changing the source', async () => {
  const { source, maximum } = start();
  const original = await sha256File(source);
  const inspected = vi.fn<(info: MediaInfo) => void>();
  const validated = vi.fn<(info: MediaInfo) => void>();
  const registered = vi.fn<(file: string, signal: AbortSignal) => Promise<void>>(async (file, signal) => {
    expect(signal.aborted).toBe(false);
    expect(statSync(file).size).toBeGreaterThan(100);
    const hash = await sha256File(file);
    expect(hash.bytes).toBeGreaterThan(100);
  });
  const dest = join(dir, 'prepared.mp4');
  const job = service.saveCopy(source, dest, unknownInfo, {
    lengthMs: 1000,
    waitForShow: true,
    strictPriority: true,
    inspect: inspected,
    args: (tmp) => [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-threads',
      '1',
      '-protocol_whitelist',
      'file',
      '-i',
      source,
      '-map',
      '0:V:0',
      '-c:v',
      'copy',
      '-f',
      'mp4',
      tmp,
    ],
    validate: validated,
    preparePublish: registered,
  });
  await expect(job.done).resolves.toEqual({ ok: true, copy: dest });
  expect(inspected).toHaveBeenCalledOnce();
  expect(validated).toHaveBeenCalledOnce();
  expect(registered).toHaveBeenCalledOnce();
  expect(inspected.mock.calls[0]?.[0].video).toMatchObject({ width: 64, height: 48 });
  expect(validated.mock.calls[0]?.[0].durationMs).toBe(1000);
  expect(maximum()).toBe(1);
  expect((await sha256File(source)).sha256).toBe(original.sha256);
});
it('can finish an idle inspection without making a file and reads native WebM alpha metadata', async () => {
  const { source, maximum } = start(true);
  const args = vi.fn<(_: string) => string[]>(() => []);
  const inspected = vi.fn<(info: MediaInfo) => false>(() => false);
  const dest = join(dir, 'unused.webm');
  const job = service.saveCopy(source, dest, unknownInfo, {
    lengthMs: 1000,
    waitForShow: true,
    strictPriority: true,
    inspect: inspected,
    args,
  });
  await expect(job.done).resolves.toEqual({ ok: true, copy: null });
  expect(inspected.mock.calls[0]?.[0].video?.pixFmt).toBe('yuva420p');
  expect(args).not.toHaveBeenCalled();
  expect(existsSync(dest)).toBe(false);
  expect(maximum()).toBe(1);
});

it('finishes twenty short header reads without a parent priority race or a second decoder', async () => {
  const { source, maximum } = start();
  const original = await sha256File(source);
  for (let index = 0; index < 20; index++) {
    const dest = join(dir, `placeholder header ${String(index)}.mp4`);
    const job = service.saveCopy(source, dest, unknownInfo, {
      waitForShow: true,
      strictPriority: true,
      estimatedBytes: 1024,
      lengthMs: 0,
      inspect: () => false as const,
      args: () => {
        throw new Error('An inspection must not encode a video.');
      },
    });
    expect(await job.done).toEqual({ ok: true, copy: null });
    expect(existsSync(dest)).toBe(false);
  }
  expect(maximum()).toBe(1);
  expect((await sha256File(source)).sha256).toBe(original.sha256);
}, 20_000);
