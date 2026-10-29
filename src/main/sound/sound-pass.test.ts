import { describe, expect, it } from 'vitest';
import type { SoundFile } from '../db/sound';
import type { Loudness } from '../../shared/sound';
import type { SoundRead } from './read-sound';
import { AFTER_IMPORT_MS, AFTER_START_MS, ON_AIR_RETRY_MS, SoundPass } from './sound-pass';

/*
 * The sound pass (Session 55, Part 7): one file at a time, an import's files first, the library's once after the
 * start; a link video's points past its black and silence (waiting while the stream is on air); what it found written
 * as a later write; a file read too slowly left for the next start. FFmpeg is a stand-in here (read-sound.test.ts
 * runs the real one). Made-up ids only.
 */

function setup(files: SoundFile[], options: { reads?: Record<string, SoundRead> } = {}) {
  const rows = new Map(files.map((f) => [f.id, { ...f, measured: null as Loudness | 'failed' | null }]));
  const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
  let clock = 0;
  let busy: string | null = null;
  const order: string[] = [];
  const edgesAsked: string[] = [];
  const kept: { id: string; points: unknown }[] = [];
  const measured: { id: string; lengthMs: number | null }[] = [];
  const writes: string[] = [];
  let reading: { resolve: () => void } | null = null;
  let holdReads = false;
  const pass = new SoundPass({
    repo: {
      toMeasure: (ids) =>
        [...rows.values()]
          .filter((r) => r.measured === null && (!ids || ids.includes(r.id)))
          .map(({ measured: _m, ...f }) => f),
      file: (id) => {
        const r = rows.get(id);
        return r
          ? { id: r.id, kind: r.kind, path: r.path, sha256: r.sha256, durationMs: r.durationMs }
          : null;
      },
      saveMeasured: (id, _sha, m) => {
        const r = rows.get(id);
        if (r) r.measured = m;
        return true;
      },
      keepLength: (id, ms) => {
        const r = rows.get(id);
        if (r?.durationMs !== null) return false;
        r.durationMs = ms;
        return true;
      },
    },
    mediaDir: '/media',
    ffmpegPath: () => '/ffmpeg',
    busy: () => busy,
    write: (key, run) => {
      writes.push(key);
      run();
    },
    measured: (id, lengthMs) => measured.push({ id, lengthMs }),
    keepPoints: (id, points) => {
      kept.push({ id, points });
      return true;
    },
    log: () => undefined,
    read: async (_ffmpeg, file) => {
      const id = file.replace(/^.*[\\/]/u, '').replace('.bin', '');
      order.push(id);
      if (holdReads) await new Promise<void>((resolve) => (reading = { resolve }));
      return options.reads?.[id] ?? { lengthMs: 4000, audio: true, loudness: { lufs: -20, peak: -6 } };
    },
    info: () => Promise.resolve({ durationMs: 4000, video: null, audio: { codec: 'aac' } }),
    edges: (_ffmpeg, file) => {
      edgesAsked.push(file.replace(/^.*[\\/]/u, ''));
      return Promise.resolve({ startMs: 1500, endMs: 3500 });
    },
    schedule: (ms, run) => {
      const job = { at: clock + ms, run, cancelled: false };
      jobs.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  /** Let `ms` pass, running what comes due, and FFmpeg's answers in between. */
  const elapse = async (ms: number) => {
    const end = clock + ms;
    for (;;) {
      await new Promise((r) => setTimeout(r, 0));
      const next = jobs.filter((j) => !j.cancelled && j.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      jobs.splice(jobs.indexOf(next), 1);
      clock = Math.max(clock, next.at);
      next.run();
    }
    clock = end;
    await new Promise((r) => setTimeout(r, 0));
  };
  return {
    pass,
    rows,
    elapse,
    order,
    edgesAsked,
    kept,
    measured,
    writes,
    setBusy: (why: string | null) => {
      busy = why;
    },
    hold: (on: boolean) => {
      holdReads = on;
    },
    release: () => {
      reading?.resolve();
      reading = null;
    },
  };
}

const file = (
  id: string,
  kind: 'video' | 'audio' = 'audio',
  durationMs: number | null = null,
): SoundFile => ({
  id,
  kind,
  path: `${id}.bin`,
  sha256: `sha-${id}`,
  durationMs,
});

describe('the sound pass', () => {
  it('measures the library’s files once, a while after the start, one at a time, keeping a length none had', async () => {
    const t = setup([file('a'), file('b', 'video', 9000)]);
    t.pass.startLibrary();
    await t.elapse(AFTER_START_MS - 1);
    expect(t.order).toEqual([]);
    await t.elapse(1);
    await t.elapse(5000);
    expect(t.order).toEqual(['a', 'b']);
    expect(t.rows.get('a')?.measured).toEqual({ lufs: -20, peak: -6 });
    // The length read is kept only where none was known.
    expect(t.measured).toEqual([
      { id: 'a', lengthMs: 4000 },
      { id: 'b', lengthMs: null },
    ]);
    expect(t.writes).toEqual(['loudness:a', 'loudness:b']);
    // Nothing left to read.
    t.pass.startLibrary();
    await t.elapse(AFTER_START_MS + 5000);
    expect(t.order).toEqual(['a', 'b']);
  });

  it('reads an import’s files first, and a link video’s black and silence (never while on air)', async () => {
    const t = setup([file('old1'), file('old2'), file('clip', 'video'), file('tone')]);
    t.hold(true);
    t.pass.startLibrary();
    await t.elapse(AFTER_START_MS);
    // The library's first file is being read when a link import ends with a video and a sound.
    expect(t.order).toEqual(['old1']);
    t.setBusy('on air');
    t.pass.imported(['clip', 'tone'], true);
    await t.elapse(AFTER_IMPORT_MS);
    t.hold(false);
    t.release();
    await t.elapse(2000);
    // The import's go before the library's next.
    expect(t.order).toEqual(['old1', 'clip', 'tone', 'old2']);
    // On air: its black and silence wait, then are found once the stream is off.
    expect(t.edgesAsked).toEqual([]);
    t.setBusy(null);
    await t.elapse(ON_AIR_RETRY_MS + 2000);
    expect(t.edgesAsked).toEqual(['clip.bin']);
    expect(t.kept).toEqual([{ id: 'clip', points: { startMs: 1500, endMs: 3500 } }]);
    // Only once.
    await t.elapse(ON_AIR_RETRY_MS * 3);
    expect(t.edgesAsked).toEqual(['clip.bin']);
  });

  it('a video imported again from a link (measured already) still has its black and silence found', async () => {
    const t = setup([file('clip', 'video', 4000)]);
    const row = t.rows.get('clip');
    if (row) row.measured = { lufs: -20, peak: -6 };
    t.pass.imported(['clip'], true);
    await t.elapse(AFTER_IMPORT_MS + 1000);
    expect(t.order).toEqual([]);
    expect(t.edgesAsked).toEqual(['clip.bin']);
  });

  it('a file read too slowly is left for the next start; one that could not be read is not read again', async () => {
    const t = setup([file('slow'), file('broken')], {
      reads: {
        slow: { lengthMs: null, audio: true, loudness: null, timedOut: true },
        broken: { lengthMs: null, audio: false, loudness: null },
      },
    });
    t.pass.startLibrary();
    await t.elapse(AFTER_START_MS + 2000);
    expect(t.order).toEqual(['slow', 'broken']);
    expect(t.rows.get('slow')?.measured).toBeNull();
    expect(t.rows.get('broken')?.measured).toBe('failed');
    t.pass.imported(['slow'], false);
    await t.elapse(AFTER_IMPORT_MS + 2000);
    expect(t.order).toEqual(['slow', 'broken']);
  });

  it('a video’s menu asks at once, even on air; it says when it is not a video there to read', async () => {
    const t = setup([file('clip', 'video'), file('tone')]);
    t.setBusy('on air');
    expect(await t.pass.edgesNow('clip')).toEqual({ ok: true, points: { startMs: 1500, endMs: 3500 } });
    expect(await t.pass.edgesNow('tone')).toMatchObject({ ok: false });
    expect(await t.pass.edgesNow('nothing')).toMatchObject({ ok: false });
  });

  it('stops at once when Drashti quits', async () => {
    const t = setup([file('a'), file('b')]);
    t.pass.startLibrary();
    t.pass.close();
    await t.elapse(AFTER_START_MS + 5000);
    expect(t.order).toEqual([]);
  });
});
