import type * as ChildProcesses from 'node:child_process';
import { type ChildProcess, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversionJob } from '../../shared/convert';
import { type Db, openDatabase } from '../db/database';
import { CONVERTING_DIR } from '../import/media-store';
import { ffmpegHere, testFfmpeg } from '../testing/ffmpeg-here';
import { ConvertService } from './convert-service';
import { keyframeOf } from './trim-saves';

/*
 * What FFmpeg says, read on a busy computer (a21, after x58's read-info.test.ts): every FFmpeg started here tells of
 * its exit before anything it wrote has been read (testing/words-after-exit.ts), as a busy computer may. Trim's
 * keyframe (trim-saves.ts keyframeOf) and a failed conversion's reason (convert-service.ts) are read all the same.
 * Videos and sounds made by FFmpeg here; nothing real.
 */

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcesses>();
  const { wordsAfterExit } = await import('../testing/words-after-exit');
  const spawn = ((...args: unknown[]) =>
    wordsAfterExit((actual.spawn as (...a: unknown[]) => ChildProcess)(...args))) as typeof actual.spawn;
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const ffmpeg = testFfmpeg({ linux: true });

function make(args: string[]) {
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  expect(made.status, made.stderr.toString()).toBe(0);
}

async function until(check: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!ffmpegHere(ffmpeg))('FFmpeg’s words when its exit is told first (a busy computer)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-ffmpeg-words-'));
  let service: ConvertService | null = null;
  let db: Db | null = null;
  afterEach(() => {
    service?.close();
    service = null;
    db?.close();
    db = null;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('Trim finds the keyframe a part begins at', async () => {
    const video = join(dir, 'Placeholder keyframes.mp4');
    // A keyframe every second.
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=25',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '25',
      '-keyint_min',
      '25',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      video,
    ]);
    expect(await keyframeOf(ffmpeg, video, 2400)).toBe(2000);
  });

  it('a failed conversion says FFmpeg’s reason', async () => {
    const mediaDir = join(dir, 'Media');
    mkdirSync(join(mediaDir, 'in'), { recursive: true });
    make(['-f', 'lavfi', '-i', 'sine=r=44100', '-t', '1', join(mediaDir, 'in', 'sound.aiff')]);
    db = openDatabase(join(dir, 'drashti.sqlite'));
    db.prepare(
      "INSERT INTO media (id, kind, name, path, playable) VALUES ('m-aiff', 'audio', 'Placeholder sound.aiff', 'in/sound.aiff', 0)",
    ).run();
    let jobs: ConversionJob[] = [];
    let busy: string | null = 'On air: conversions wait for the stream to end.';
    service = new ConvertService({
      db,
      mediaDir,
      ffmpegPath: () => ffmpeg,
      busy: () => busy,
      freeBytes: () => 100 * 1024 ** 3,
      changed: (j) => {
        jobs = j;
      },
      libraryChanged: () => undefined,
      log: () => undefined,
    });
    expect(service.convert(['m-aiff'])).toMatchObject({ ok: true });
    await until(() => jobs.length === 1 && jobs[0]?.note?.startsWith('On air') === true);
    const id = jobs[0]?.id ?? '';
    // A folder where FFmpeg is to write the converted sound: FFmpeg cannot open it, and says why.
    mkdirSync(join(mediaDir, CONVERTING_DIR, `${id}.m4a`), { recursive: true });
    busy = null;
    await until(() => jobs[0]?.state === 'failed' || jobs[0]?.state === 'done');
    expect(jobs[0]?.state).toBe('failed');
    expect(jobs[0]?.message).toMatch(/^FFmpeg could not convert it \(\S.*\)\. Check the original/u);
  });
});
