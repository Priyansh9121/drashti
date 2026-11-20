import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { MediaRepo } from '../db/media';
import { openDatabase, type Db } from '../db/database';
import { sha256File } from '../import/media-store';
import { testFfmpeg } from '../testing/ffmpeg-here';
import { ConvertService } from './convert-service';
import { VideoAnalysisService } from './video-analysis';

const ffmpeg = testFfmpeg({ linux: true });
let dir = '';
let db: Db;
let conversions: ConvertService;
let analysis: VideoAnalysisService;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start(silent = false) {
  dir = mkdtempSync(join(tmpdir(), 'drashti-video-analysis-'));
  const source = join(dir, 'placeholder.mp4');
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-threads',
    '1',
    '-filter_complex_threads',
    '1',
    '-f',
    'lavfi',
    '-i',
    'color=red:s=160x90:r=25:d=1',
    '-f',
    'lavfi',
    '-i',
    'color=blue:s=160x90:r=25:d=1',
    ...(silent ? [] : ['-f', 'lavfi', '-i', 'sine=f=120:r=8000:d=2']),
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map',
    '[v]',
    ...(silent ? [] : ['-map', '2:a', '-c:a', 'aac']),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '1',
    source,
  ];
  const made = spawnSync(ffmpeg, args);
  expect(made.status).toBe(0);
  const { sha256: digest } = await sha256File(source);
  db = openDatabase(join(dir, 'library.sqlite'));
  cleanup.push(() => db.close());
  db.prepare(
    "INSERT INTO media (id, kind, name, path, sha256, duration_ms, playable) VALUES ('m', 'video', 'Placeholder clip', 'placeholder.mp4', ?, 2000, 1)",
  ).run(digest);
  const row = (id: string) => new MediaRepo(db).about(id);
  conversions = new ConvertService({
    db,
    mediaDir: dir,
    ffmpegPath: () => ffmpeg,
    busy: () => null,
    showBusy: () => false,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
  });
  cleanup.push(() => conversions.close());
  analysis = new VideoAnalysisService({ mediaDir: dir, conversions, row });
  cleanup.push(() => analysis.close());
  return { source, digest, row };
}
async function ready(audio: number | null = 0) {
  await vi.waitFor(
    () => {
      const result = analysis.get('m', audio);
      if (!result.ok) throw new Error(result.message);
      if (result.analysis.state === 'failed') throw new Error(result.analysis.message ?? 'Failed analysis.');
      expect(result.analysis.state).toBe('ready');
    },
    { timeout: 10_000 },
  );
  const result = analysis.get('m', audio);
  if (!result.ok) throw new Error(result.message);
  return result.analysis;
}
it('uses bundled scene/tile/PCM filters through one idle queue and reuses a durable bounded cache', async () => {
  const { source, digest, row } = await start();
  const queued = vi.spyOn(conversions, 'saveCopy');
  expect(analysis.get('m')).toMatchObject({ ok: true, analysis: { state: 'preparing' } });
  const result = await ready();
  expect(result.scenes).toEqual([1000]);
  expect(result.waveform?.peaks.length).toBe(4096);
  expect(result.waveform?.peaks.some(([low, high]) => Math.abs(low) > 0.01 || high > 0.01)).toBe(true);
  expect(result.storyboard).toMatch(/^data:image\/jpeg;base64,/u);
  expect(queued).toHaveBeenCalledTimes(3);
  for (const call of queued.mock.calls)
    expect(call[3]).toMatchObject({ waitForShow: true, strictPriority: true });
  expect((await sha256File(source)).sha256).toBe(digest);
  analysis.close();
  analysis = new VideoAnalysisService({ mediaDir: dir, conversions, row });
  expect(analysis.get('m')).toMatchObject({ ok: true, analysis: { state: 'ready', scenes: [1000] } });
  expect(queued).toHaveBeenCalledTimes(3);
  const cache = readdirSync(join(dir, 'video-analysis')).filter(
    (name) => name.endsWith('.json') && name !== 'requests.json',
  );
  expect(cache.length).toBeLessThanOrEqual(200);
  analysis.get('m', null);
  const withoutSound = await ready(null);
  expect(withoutSound.waveform).toBeNull();
  expect(withoutSound.storyboard).toBe(result.storyboard);
  expect(queued).toHaveBeenCalledTimes(3);
  expect(readFileSync(join(dir, 'video-analysis', cache[0] ?? '')).length).toBeLessThan(2 * 1024 ** 2);
}, 15_000);
it('labels a silent source without an audio decode and never modifies its markers', async () => {
  await start(true);
  const points = {
    startMs: 100,
    endMs: 1800,
    markers: [{ id: 'own', name: 'Placeholder point', atMs: 700 }],
  };
  const repo = new MediaRepo(db);
  repo.setMarkers('m', points);
  const queued = vi.spyOn(conversions, 'saveCopy');
  analysis.get('m');
  expect((await ready()).waveform).toBeNull();
  expect(queued).toHaveBeenCalledTimes(2);
  expect(repo.markersOf('m')).toEqual(points);
}, 15_000);
