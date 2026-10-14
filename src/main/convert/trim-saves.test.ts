import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SaveJob } from '../../shared/trim';
import type { CopyOptions, FitResult } from './convert-service';
import type { MediaInfo } from './plan';
import { TrimSaves } from './trim-saves';

/*
 * Save as MP4… (Session 26e), with stand-ins for the dialog, the conversions
 * and the import: a part saved where chosen, never over a file already
 * there, stopped, failed, and added to the library when ticked.
 */

let work = '';
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'drashti-trim-saves-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const H264: MediaInfo = {
  durationMs: 10_000,
  video: { codec: 'h264', pixFmt: 'yuv420p', width: 320, height: 180, still: false },
  audio: { codec: 'aac' },
};

function setup(info: MediaInfo = H264) {
  const copies: { source: string; dest: string; copy: CopyOptions; finish: (r: FitResult) => void }[] = [];
  const imported: string[] = [];
  const changes: SaveJob[][] = [];
  let chosen: string | null = join(work, 'Placeholder Katha (0m 04s).mp4');
  const saves = new TrimSaves({
    video: (id) => (id === 'v1' ? { path: '/library/v1.mp4', name: 'Placeholder Katha.mp4' } : null),
    // No real FFmpeg here: a start of 0 needs no keyframe looked for.
    ffmpegPath: () => '/no/ffmpeg',
    readInfo: () => Promise.resolve(info),
    pickDest: (name) => {
      expect(name).toBe('Placeholder Katha (0m 04s).mp4');
      return Promise.resolve(chosen);
    },
    saveCopy: (source, dest, _info, copy) => {
      let finish: (r: FitResult) => void = () => undefined;
      const done = new Promise<FitResult>((resolve) => {
        finish = resolve;
      });
      copies.push({ source, dest, copy, finish });
      // It starts at once, and says so before saveCopy has returned (as the conversions do).
      copy.progress?.(0);
      return { id: `job-${String(copies.length)}`, done };
    },
    cancelFile: (id) => id === 'job-1',
    importFile: (path) => {
      imported.push(path);
      return Promise.resolve(true);
    },
    changed: (jobs) => changes.push(jobs),
    log: () => undefined,
  });
  return {
    saves,
    copies,
    imported,
    changes,
    choose: (path: string | null) => {
      chosen = path;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Save as MP4', () => {
  it('saves the part where chosen, copied from its start, and says how it goes', async () => {
    const { saves, copies } = setup();
    const result = await saves.save({ mediaId: 'v1', startMs: null, endMs: 4000, addToLibrary: false });
    expect(result).toMatchObject({
      ok: true,
      job: { id: 'job-1', state: 'saving', name: 'Placeholder Katha (0m 04s).mp4' },
    });
    expect(copies[0]?.source).toBe('/library/v1.mp4');
    expect(copies[0]?.copy.lengthMs).toBe(4000);
    expect(copies[0]?.copy.args('/tmp/.part.mp4')).toEqual(
      expect.arrayContaining(['-ss', '0.000', '-t', '4.000', '/tmp/.part.mp4']),
    );
    copies[0]?.copy.progress?.(0.5);
    expect(saves.list()[0]).toMatchObject({ state: 'saving', progress: 0.5 });
    copies[0]?.finish({ ok: true, copy: copies[0].dest });
    await settle();
    expect(saves.list()[0]).toMatchObject({ state: 'done', path: copies[0]?.dest, added: false });
  });

  it('never saves over a file already there: the next free name', async () => {
    const { saves, copies } = setup();
    writeFileSync(join(work, 'Placeholder Katha (0m 04s).mp4'), 'placeholder');
    await saves.save({ mediaId: 'v1', startMs: 0, endMs: 4000, addToLibrary: false });
    expect(copies[0]?.dest).toBe(join(work, 'Placeholder Katha (0m 04s) (2).mp4'));
  });

  it('adds it to the library when ticked; a stop or a failure says so', async () => {
    const { saves, copies, imported } = setup();
    await saves.save({ mediaId: 'v1', startMs: 0, endMs: 4000, addToLibrary: true });
    copies[0]?.finish({ ok: true, copy: copies[0].dest });
    await settle();
    await settle();
    expect(imported).toEqual([copies[0]?.dest]);
    expect(saves.list().at(-1)).toMatchObject({ state: 'done', added: true });
    await saves.save({ mediaId: 'v1', startMs: 0, endMs: 4000, addToLibrary: false });
    copies[1]?.finish({ ok: false, message: 'Stopped.', stopped: true });
    await saves.save({ mediaId: 'v1', startMs: 0, endMs: 4000, addToLibrary: false });
    copies[2]?.finish({ ok: false, message: 'FFmpeg could not save it as an MP4.' });
    await settle();
    expect(
      saves
        .list()
        .slice(-2)
        .map((j) => [j.state, j.message]),
    ).toEqual([
      ['stopped', 'Stopped.'],
      ['failed', 'FFmpeg could not save it as an MP4.'],
    ]);
    expect(saves.stop('job-1')).toBe(true);
  });

  it('refuses plainly what it cannot save, and saves nothing when the dialog is closed', async () => {
    const vp8 = setup({
      ...H264,
      video: { codec: 'vp8', pixFmt: 'yuv420p', width: 320, height: 180, still: false },
    });
    const refused = await vp8.saves.save({ mediaId: 'v1', startMs: 0, endMs: 4000, addToLibrary: false });
    expect(refused.ok ? '' : refused.message).toMatch(/^Its picture is VP8/u);
    const { saves, copies, choose } = setup();
    expect(await saves.save({ mediaId: 'gone', startMs: 0, endMs: 4000, addToLibrary: false })).toMatchObject(
      { ok: false },
    );
    expect(await saves.save({ mediaId: 'v1', startMs: 5000, endMs: 4000, addToLibrary: false })).toEqual({
      ok: false,
      message: 'Its end must come after its start.',
    });
    choose(null);
    expect(await saves.save({ mediaId: 'v1', startMs: 0, endMs: 4000, addToLibrary: false })).toEqual({
      ok: true,
      job: null,
    });
    expect(copies).toHaveLength(0);
  });
});
