import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ClipExports } from './clip-export-service';
import type { ClipExportRequest } from '../../shared/video-copies';
import { sha256File } from '../import/media-store';
import { copyFf, copyFixture, copyFfmpeg } from './video-copy-fixtures';
import { readTrimInfo } from './trim-copy';
import { registerProxyFile } from './video-copy-files';

let fixture: Awaited<ReturnType<typeof copyFixture>>;
let clips: ClipExports;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function service(destination: string) {
  let kept: unknown = [];
  const deps = {
    conversions: fixture.conversions,
    resolve: (request: ClipExportRequest) => ({
      ok: true as const,
      source: {
        mediaId: 'source',
        sha256: fixture.sha,
        path: fixture.source,
        name: 'Placeholder source',
        identity: fixture.sha,
        durationMs: fixture.info.durationMs,
        startMs: request.startMs,
        endMs: request.endMs,
      },
    }),
    current: () => true,
    pickDest: () => Promise.resolve(destination),
    kept: {
      load: () => kept,
      save: (value: unknown) => {
        kept = value;
      },
    },
    prepareImport: (file: string, info: typeof fixture.info, name: string, signal: AbortSignal) =>
      registerProxyFile({
        db: fixture.db,
        mediaDir: fixture.dir,
        file,
        info,
        name,
        signal,
        idle: () => fixture.idle(),
        freeBytes: () => 100 * 1024 ** 3,
      }),
    publishImport: (id: string) =>
      Promise.resolve(fixture.db.prepare('UPDATE media SET listed=1 WHERE id=?').run(id).changes > 0),
  };
  clips = new ClipExports(deps);
  cleanup.push(() => clips.close());
  return deps;
}
const request: ClipExportRequest = {
  mediaId: 'source',
  startMs: 350,
  endMs: 1750,
  frame: 'original',
  shape: 'source',
  container: 'mp4',
  addToLibrary: false,
  revision: null,
};
async function done() {
  await vi.waitFor(
    () => {
      const job = clips.list().at(-1);
      if (job?.state === 'failed') throw new Error(job.message ?? 'Export failed.');
      expect(job?.state).toBe('done');
    },
    { timeout: 10_000 },
  );
  const job = clips.list().at(-1);
  if (!job?.path) throw new Error('The export path is missing.');
  return job;
}
function pixels(file: string, at: string) {
  return copyFf([
    '-ss',
    at,
    '-i',
    file,
    '-an',
    '-frames:v',
    '1',
    '-vf',
    'scale=16:9',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
}
it('exports a non-keyframe cut accurately without overwriting the source, through one worker', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  service(fixture.source);
  expect(await clips.start(request)).toMatchObject({ ok: true });
  const job = await done();
  expect(job.path).not.toBe(fixture.source);
  const info = await readTrimInfo(copyFfmpeg, job.path ?? '');
  expect(Math.abs((info.durationMs ?? 0) - 1400)).toBeLessThanOrEqual(80);
  const expected = pixels(fixture.source, '0.350');
  const actual = pixels(job.path ?? '', '0');
  expect(actual.length).toBe(expected.length);
  const error =
    expected.reduce((sum, value, i) => sum + Math.abs(value - (actual[i] ?? 0)), 0) / expected.length;
  expect(error).toBeLessThan(4);
  expect((await sha256File(fixture.source)).sha256).toBe(fixture.sha);
  expect(fixture.maxActive()).toBe(1);
}, 15_000);
it('saves a 1080 by 1920 vertical clip and registers it only after validation', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  service(join(fixture.dir, 'vertical.mp4'));
  await clips.start({ ...request, shape: 'vertical', addToLibrary: true });
  const job = await done();
  const info = await readTrimInfo(copyFfmpeg, job.path ?? '');
  expect(info.video).toMatchObject({ width: 1080, height: 1920 });
  expect(job.added).toBe(true);
  expect(fixture.media.list()).toHaveLength(2);
  expect((await sha256File(fixture.source)).sha256).toBe(fixture.sha);
}, 15_000);
it('keeps a queued request across a close and resumes it only when idle; Stop removes its partial output', async () => {
  fixture = await copyFixture();
  cleanup.push(() => fixture.cleanup());
  fixture.activity.stream = true;
  const dest = join(fixture.dir, 'queued.mp4');
  const deps = service(dest);
  const result = await clips.start(request);
  expect(result).toMatchObject({ ok: true, job: { state: 'waiting' } });
  expect(existsSync(dest)).toBe(false);
  clips.close();
  clips = new ClipExports(deps);
  clips.resume();
  clips.resume();
  expect(clips.list()).toHaveLength(1);
  expect(clips.list()[0]?.state).toBe('waiting');
  fixture.activity.stream = false;
  await done();
  expect(existsSync(dest)).toBe(true);
  fixture.activity.stream = true;
  const stopped = join(fixture.dir, 'stopped.mp4');
  clips.close();
  service(stopped);
  await clips.start(request);
  const pending = clips.list().at(-1);
  expect(clips.stop(pending?.id ?? '')).toBe(true);
  expect(clips.list().at(-1)?.state).toBe('stopped');
  expect(existsSync(stopped)).toBe(false);
}, 15_000);

it('keeps real WebM transparency in the exported file without replacing the source', async () => {
  fixture = await copyFixture({ alpha: true });
  cleanup.push(() => fixture.cleanup());
  service(join(fixture.dir, 'transparent clip.webm'));
  await clips.start({ ...request, startMs: 80, endMs: 320, container: 'webm' });
  const job = await done();
  const rgba = copyFf([
    '-c:V:0',
    'libvpx-vp9',
    '-i',
    job.path ?? '',
    '-frames:v',
    '1',
    '-vf',
    'scale=2:2,format=rgba',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  expect(rgba).toHaveLength(16);
  for (const at of [3, 7, 11, 15]) expect(rgba[at]).toBeGreaterThan(110);
  for (const at of [3, 7, 11, 15]) expect(rgba[at]).toBeLessThan(145);
  expect((await sha256File(fixture.source)).sha256).toBe(fixture.sha);
}, 15_000);
