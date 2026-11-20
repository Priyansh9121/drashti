import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ConversionJob } from '../../shared/convert';
import type { DisplayResult } from '../media/display-copies';
import { readPictureHeader } from '../media/picture-header';
import { openDatabase } from '../db/database';
import { testFfmpeg } from '../testing/ffmpeg-here';
import { ConvertService } from './convert-service';

it('does not publish or relink an oversized converted picture until its display copy is ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-converted-display-'));
  const mediaDir = join(root, 'Media');
  mkdirSync(join(mediaDir, 'in'), { recursive: true });
  const ffmpeg = testFfmpeg({ linux: true });
  const input = join(mediaDir, 'in', 'Placeholder large.tiff');
  const made = spawnSync(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=6144x3456',
    '-frames:v',
    '1',
    input,
  ]);
  if (made.status !== 0)
    throw new Error('The generated large TIFF could not be made: ' + made.stderr.toString());
  const db = openDatabase(join(root, 'drashti.sqlite'));
  let service: ConvertService | null = null;
  let release: (result: DisplayResult) => void = () => undefined;
  const ready = new Promise<DisplayResult>((done) => {
    release = done;
  });
  const prepareDisplay = vi.fn(async (candidate: { path: string; sha256: string }) => {
    expect(db.inTransaction).toBe(false);
    const header = await readPictureHeader(join(mediaDir, candidate.path));
    expect(header?.size.width).toBeGreaterThan(1920);
    return await ready;
  });
  try {
    db.prepare(
      "INSERT INTO media(id,kind,name,path,playable) VALUES('original','image','Placeholder large.tiff','in/Placeholder large.tiff',0)",
    ).run();
    let jobs: ConversionJob[] = [];
    service = new ConvertService({
      db,
      mediaDir,
      ffmpegPath: () => ffmpeg,
      busy: () => null,
      freeBytes: () => 1e12,
      changed: (j) => {
        jobs = j;
      },
      libraryChanged: () => undefined,
      log: () => undefined,
      prepareDisplay,
    });
    expect(service.convert(['original'])).toMatchObject({ ok: true });
    await vi.waitFor(
      () =>
        expect(
          prepareDisplay.mock.calls.length > 0 ||
            jobs.some((j) => j.state === 'done' || j.state === 'failed'),
        ).toBe(true),
      { timeout: 20_000 },
    );
    expect(jobs[0]?.state, jobs[0]?.message ?? 'conversion state').not.toBe('failed');
    expect(prepareDisplay).toHaveBeenCalledOnce();
    expect(jobs[0]?.state).toBe('converting');
    expect(db.prepare('SELECT COUNT(*) AS n FROM media').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM media_conversions').get()).toEqual({ n: 0 });
    release({
      ok: true,
      copy: {
        key: 'placeholder-copy',
        width: 1920,
        height: 1080,
        path: 'display/placeholder.jpg',
        hash: 'a'.repeat(64),
        bytes: 42,
        ext: 'jpg',
      },
    });
    await vi.waitFor(() => expect(jobs[0]?.state).toBe('done'), { timeout: 20_000 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM media_conversions').get()).toEqual({ n: 1 });
  } finally {
    release({ ok: false, message: 'Test finished.' });
    service?.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
