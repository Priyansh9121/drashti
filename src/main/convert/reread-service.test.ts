import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversionJob } from '../../shared/convert';
import { type Db, openDatabase } from '../db/database';
import { ConvertService } from './convert-service';
import { parseFfmpegInfo } from './plan';

/*
 * The idle sweep in the conversions' service (alpha.20, "Plays anything"): from once the start is over (resumeWaiting)
 * and only at idle moments (nothing up, off air and not recording, no conversion waiting), a file FFmpeg never read is
 * read; one it finds cannot play is converted by itself. FFmpeg's reading is a stand-in (FFmpeg 9.0.2's words for an
 * 8K clip); there is no FFmpeg to convert with, so a conversion that starts fails at once, as the other tests see it.
 */

const H264_8K = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/media/8k.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 96824 kb/s
  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 7680x4320 [SAR 1:1 DAR 16:9], 96745 kb/s, 10 fps, 10 tbr, 10240 tbn (default)`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(100);
  }
}

let dir = '';
let db: Db | null = null;
const services: ConvertService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.close();
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('the idle sweep, as the conversions’ service runs it', () => {
  it('reads only once the start is over and the show is idle; converts by itself what cannot play', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-reread-'));
    const mediaDir = join(dir, 'Media');
    mkdirSync(mediaDir);
    const library = openDatabase(join(dir, 'drashti.sqlite'));
    db = library;
    library
      .prepare(
        "INSERT INTO media (id, kind, name, path, playable, format) VALUES ('v8k', 'video', 'Placeholder 8K.mp4', 'in/v8k.mp4', 1, 'H.264 video (MP4)')",
      )
      .run();
    const read: string[] = [];
    const show = { up: false };
    const air: { busy: string | null } = { busy: null };
    const seen: { jobs: ConversionJob[] } = { jobs: [] };
    const service = new ConvertService({
      db: library,
      mediaDir,
      ffmpegPath: () => join(dir, 'no-ffmpeg-here'),
      busy: () => air.busy,
      showBusy: () => show.up,
      freeBytes: () => 100 * 1024 ** 3,
      changed: (jobs) => {
        seen.jobs = jobs;
      },
      libraryChanged: () => undefined,
      log: () => undefined,
      limits: { afterStartMs: 0, afterImportMs: 0 },
      reread: {
        read: (_ffmpeg, file) => {
          read.push(file);
          return Promise.resolve(parseFfmpegInfo(H264_8K));
        },
        everyMs: 0,
      },
    });
    services.push(service);
    // The start is not over yet: nothing is read, idle or not.
    await sleep(1500);
    expect(read).toEqual([]);
    // Something up, then on air: still nothing.
    show.up = true;
    service.resumeWaiting();
    await sleep(1500);
    show.up = false;
    air.busy = 'Waits while the stream is on air or recording, then carries on by itself.';
    await sleep(1500);
    expect(read).toEqual([]);
    // Idle: read once, marked as one that cannot play, and converted by itself.
    air.busy = null;
    await until(() => read.length > 0);
    expect(read).toEqual([join(mediaDir, 'in/v8k.mp4')]);
    await until(() => seen.jobs.some((j) => j.mediaId === 'v8k'));
    expect(seen.jobs.find((j) => j.mediaId === 'v8k')).toMatchObject({ byItself: true });
    expect(library.prepare("SELECT read_by, playable, format FROM media WHERE id = 'v8k'").get()).toEqual({
      read_by: 'ffmpeg',
      playable: 0,
      format: 'H.264 (7680 × 4320) video (MP4)',
    });
    await sleep(1500);
    expect(read).toHaveLength(1);
  });
});
