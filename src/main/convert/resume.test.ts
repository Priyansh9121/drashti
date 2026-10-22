import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversionJob } from '../../shared/convert';
import type { ImportIssue } from '../../shared/import';
import { type Db, openDatabase } from '../db/database';
import { ConvertService, type ConvertDeps } from './convert-service';

/*
 * A conversion waiting when Drashti quits (Session 51): the conversions not finished are kept with the library as
 * they change, and at the next start they wait again, held until the stream's own start is known, then start by
 * themselves, one at a time, never while the stream is on air or recording. No FFmpeg here: a job that starts
 * fails at once, which is how these tests see it start.
 */

const ON_AIR = 'Waits while the stream is on air or recording, then carries on by itself.';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(100);
  }
}

let dir = '';
const services: ConvertService[] = [];
let db: Db | null = null;
afterEach(() => {
  for (const s of services.splice(0)) s.close();
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** A library with two files Drashti cannot play and one it plays, and the library's kept setting. */
function seeded() {
  dir = mkdtempSync(join(tmpdir(), 'drashti-convert-resume-'));
  const mediaDir = join(dir, 'Media');
  mkdirSync(join(mediaDir, 'in'), { recursive: true });
  const library = openDatabase(join(dir, 'drashti.sqlite'));
  db = library;
  const insert = library.prepare('INSERT INTO media (id, kind, name, path, playable) VALUES (?, ?, ?, ?, ?)');
  for (const [id, kind, name, playable] of [
    ['m-avi', 'video', 'Placeholder old clip.avi', 0],
    ['m-wma', 'audio', 'Placeholder bhajan.wma', 0],
    ['m-flac', 'audio', 'Placeholder dhun.flac', 1],
  ] as const) {
    writeFileSync(join(mediaDir, 'in', name), `placeholder ${name}`);
    insert.run(id, kind, name, `in/${name}`, playable);
  }
  const kept = { value: undefined as unknown, saves: 0 };
  const air = { busy: null as string | null };
  const start = (limits: ConvertDeps['limits'] = {}) => {
    const seen = { jobs: [] as ConversionJob[], logs: [] as string[] };
    const service = new ConvertService({
      db: library,
      mediaDir,
      ffmpegPath: () => join(dir, 'no-ffmpeg-here'),
      busy: () => air.busy,
      freeBytes: () => 100 * 1024 ** 3,
      changed: (j) => {
        seen.jobs = j;
      },
      libraryChanged: () => undefined,
      log: (_level, message) => seen.logs.push(message),
      kept: {
        load: () => kept.value,
        save: (ids) => {
          kept.value = ids;
          kept.saves += 1;
        },
      },
      limits,
    });
    services.push(service);
    return { service, seen };
  };
  return { kept, air, start };
}

/** An import report's line: a file Drashti converts by itself. */
const converting = (mediaId: string): { issues: ImportIssue[] } => ({
  issues: [
    {
      severity: 'info',
      code: 'converting-media',
      message: 'Placeholder line.',
      fix: { kind: 'convert-media', mediaId, advice: 'Placeholder advice.' },
    },
  ],
});

describe('a conversion waiting when Drashti quits (Session 51)', () => {
  it('keeps the conversions not finished as they change; quitting keeps what was waiting', () => {
    const { kept, air, start } = seeded();
    air.busy = ON_AIR;
    const { service } = start();
    // The operator's Convert, and one an import found: both wait while on air, and are kept.
    expect(service.convert(['m-avi'])).toMatchObject({ ok: true });
    expect(service.convertImported({ items: [converting('m-wma')] })).toBe(1);
    expect(kept.value).toEqual(['m-avi', 'm-wma']);
    // Cancelled: no longer kept.
    const wma = service.list().find((j) => j.mediaId === 'm-wma');
    service.cancel(wma?.id);
    expect(kept.value).toEqual(['m-avi']);
    // Quitting stops what waits or goes on, and keeps it for the next start: what quitting does after is not kept.
    const saves = kept.saves;
    service.close();
    service.cancel(null);
    expect(kept.value).toEqual(['m-avi']);
    expect(kept.saves).toBe(saves);
  });

  it('at the next start: waiting again at once, held until the stream’s start is known, then started by itself', async () => {
    const { kept, start } = seeded();
    // Kept when Drashti last stopped: one it cannot play, and ids that no longer need converting.
    kept.value = ['m-avi', 'm-flac', 'm-gone'];
    const { service, seen } = start({ afterStartMs: 1000 });
    // Says “Converting…” from the start: waiting, done by itself (never offered for Undo).
    expect(seen.jobs.map((j) => [j.mediaId, j.state, j.byItself])).toEqual([['m-avi', 'waiting', true]]);
    expect(kept.value).toEqual(['m-avi']);
    // Not before the stream's own start is known (the window has opened: index.ts resumes them then).
    await sleep(1500);
    expect(seen.jobs[0]?.state).toBe('waiting');
    service.resumeWaiting();
    expect(seen.logs).toContain('1 conversion waiting when Drashti last stopped starts again by itself');
    // A moment later, it starts (and, with no FFmpeg here, fails at once).
    await sleep(500);
    expect(seen.jobs[0]?.state).toBe('waiting');
    await until(() => seen.jobs[0]?.state === 'failed');
    expect(kept.value).toEqual([]);
  });

  it('never while the stream is on air or recording: it waits, then starts once it is off', async () => {
    const { kept, air, start } = seeded();
    kept.value = ['m-avi', 'm-wma'];
    // The stream went on air again by itself as Drashti started (a stop under 5 minutes before).
    air.busy = ON_AIR;
    const { service, seen } = start({ afterStartMs: 0 });
    service.resumeWaiting();
    await sleep(2500);
    expect(seen.jobs.map((j) => [j.state, j.note])).toEqual([
      ['waiting', ON_AIR],
      ['waiting', ON_AIR],
    ]);
    air.busy = null;
    await until(() => seen.jobs.every((j) => j.state === 'failed'));
  });
});
