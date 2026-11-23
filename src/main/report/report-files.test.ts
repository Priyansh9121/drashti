import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_LIMITS, REPORT_PICTURE_BYTES } from '../../shared/report';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { diagnosticsText, libraryNames, redactNames } from '../diagnostics';
import { scrub } from '../log';
import type { DiagnosticsWho } from '../log-who';
import {
  fitDiagnostics,
  makeDiagnosticsText,
  makeReportFiles,
  recentErrors,
  type ReportDiagnosticsInput,
} from './report-files';

/*
 * A report's files (x49, Help › Report a Problem…), as the report worker makes them off Main's thread: the diagnostics
 * file exactly as Save Diagnostics writes its own (no library name in it), its newest error lines, the picture of the
 * window a PNG of at most 1,920 pixels a side and 1.5 MB, the crash files newest first within the 7 MB (the rest named),
 * and data.json, each file's base64 by its SHA-256. Placeholder names, words and generated files only.
 */

const MB = 1024 * 1024;
const NOW = new Date(Date.UTC(2026, 10, 20, 9, 0, 0));
/** Who made the file (alpha.21, logs (b)): made-up ids. */
const WHO: DiagnosticsWho = {
  computer: 'Placeholder Hall Mac',
  computerId: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
  installId: '7K3P-Q2XM-4H9A',
  grantId: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
  role: { mode: 'pro', owner: false },
  made: 'pro',
  period: 'Today, 2026-11-20',
};

function library(dir: string): string {
  const file = join(dir, 'library.db');
  const db = openDatabase(file);
  const repo = new PresentationRepo(db);
  repo.insert({
    libraryId: repo.ensureLibrary('Kirtans'),
    name: 'Placeholder Report Secret',
    groups: [{ name: 'Verse', slides: [{ elements: [] }] }],
  });
  db.close();
  return file;
}

function inputFor(dir: string): ReportDiagnosticsInput {
  const log = join(dir, 'drashti.log');
  writeFileSync(
    log,
    [
      '2026-11-18T09:00:00.000Z [error] Placeholder: an old error, two days ago',
      '2026-11-20T08:00:00.000Z [info] Opened Placeholder Report Secret',
      '2026-11-20T08:30:00.000Z [warn] Placeholder: a warning',
      '2026-11-20T08:59:00.000Z [error] Placeholder: an error in Placeholder Report Secret',
      '',
    ].join('\n'),
  );
  return {
    app: {
      version: '1.0.0-alpha.20',
      electron: '44',
      chrome: '152',
      node: '24',
      platform: 'darwin',
      arch: 'arm64',
    },
    displays: [],
    screens: { displays: [], groups: [], status: [], nodes: [], uses: [] },
    sound: { chosen: null, devices: [], state: 'default', checked: true },
    watchdog: [],
    crashJournal: [],
    crashFiles: { files: [], included: false },
    logFiles: [log],
    now: NOW,
    graphics: { featureStatus: { gpu_compositing: 'enabled' }, info: { gpuDevice: [] } },
    who: WHO,
  };
}

/** A generated picture of the size asked, flat panels as a window has, as Main captures one (blue first). */
function picture(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4);
  const shades = [30, 90, 160, 230];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const panel = ((x >> 7) + (y >> 6)) % 4;
      pixels[i] = shades[panel] ?? 0;
      pixels[i + 1] = shades[(panel + 1) % 4] ?? 0;
      pixels[i + 2] = shades[(panel + 2) % 4] ?? 0;
      pixels[i + 3] = 255;
    }
  return { width, height, pixels, order: 'bgra' as const };
}

const dump = (dir: string, n: number, bytes: number) => {
  const path = join(dir, `0f1e2d3c-placeholder-${String(n)}.dmp`);
  writeFileSync(path, Buffer.alloc(bytes, n));
  return { path, name: `0f1e2d3c-placeholder-${String(n)}.dmp`, bytes };
};

describe('a report’s files', () => {
  it('are the diagnostics as Save Diagnostics writes them, the window’s PNG, and data.json by SHA-256', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-report-files-'));
    const dbFile = library(dir);
    const input = inputFor(dir);
    const db = openDatabase(dbFile);
    const expected = scrub(redactNames(diagnosticsText({ ...input, db }), libraryNames(db)));
    db.close();
    const folder = join(dir, 'report');
    mkdirSync(folder);
    const made = await makeReportFiles(
      {
        dir: folder,
        stamp: '2026-11-20 20-00',
        diagnostics: { input, dbFile },
        picture: picture(2400, 1500),
        crash: [],
      },
      { openDb: (file) => openDatabase(file) },
    );
    if (!made.ok) throw new Error(made.message);
    expect(made.files.map((f) => [f.kind, f.name, f.type])).toEqual([
      ['diagnostics', 'Drashti diagnostics 2026-11-20 20-00.txt', 'text/plain'],
      ['picture', 'Drashti window 2026-11-20 20-00.png', 'image/png'],
    ]);
    const text = readFileSync(join(folder, 'files', 'Drashti diagnostics 2026-11-20 20-00.txt'), 'utf8');
    expect(text).toBe(expected);
    expect(text).toContain('== Graphics ==');
    expect(text).not.toContain('Placeholder Report Secret');
    const png = readFileSync(join(folder, 'files', 'Drashti window 2026-11-20 20-00.png'));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1920, 1200]);
    expect(png.length).toBeLessThanOrEqual(REPORT_PICTURE_BYTES);
    const data = JSON.parse(readFileSync(join(folder, 'data.json'), 'utf8')) as Record<string, string>;
    for (const f of made.files) {
      const bytes = readFileSync(join(folder, 'files', f.name));
      expect(f.bytes).toBe(bytes.length);
      expect(f.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(data[f.sha256]).toBe(bytes.toString('base64'));
    }
    expect(Object.keys(data)).toHaveLength(2);
    // The day's error and warning lines, for the email's text: names blanked as in the file.
    expect(made.errors).toEqual([
      '2026-11-20T08:30:00.000Z [warn] Placeholder: a warning',
      '2026-11-20T08:59:00.000Z [error] Placeholder: an error in [library name]',
    ]);
    expect(made.kept).toEqual([]);
  });

  it('take crash files newest first, whole, within the 7 MB; any left out is named', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-report-crash-'));
    const folder = join(dir, 'report');
    mkdirSync(folder);
    const crash = [dump(dir, 1, 3 * MB), dump(dir, 2, 3 * MB), dump(dir, 3, 2 * MB), dump(dir, 4, MB / 2)];
    const made = await makeReportFiles(
      { dir: folder, stamp: '2026-11-20 20-00', diagnostics: null, picture: null, crash },
      { openDb: (file) => openDatabase(file) },
    );
    if (!made.ok) throw new Error(made.message);
    expect(made.files.map((f) => f.name)).toEqual([crash[0]?.name, crash[1]?.name, crash[3]?.name]);
    expect(made.files.reduce((n, f) => n + f.bytes, 0)).toBeLessThanOrEqual(REPORT_LIMITS.filesBytes);
    expect(made.kept).toEqual([{ name: crash[2]?.name, bytes: 2 * MB }]);
    expect(made.files.every((f) => f.type === 'application/octet-stream' && f.kind === 'crash')).toBe(true);
    expect(made.errors).toEqual([]);
  });
});

describe('the diagnostics in a report', () => {
  it('keep within their size by leaving out the log’s oldest lines first', () => {
    const lines = Array.from(
      { length: 2000 },
      (_, i) => `2026-11-20T08:00:00.000Z [info] Placeholder line ${String(i)}`,
    );
    const text = `== Drashti diagnostics ==\nSaved\n== Log ==\n${lines.join('\n')}\n`;
    const fitted = fitDiagnostics(text, 20_000);
    expect(Buffer.byteLength(fitted)).toBeLessThanOrEqual(20_000);
    expect(fitted.startsWith('== Drashti diagnostics ==\nSaved\n== Log ==\n…\n')).toBe(true);
    expect(fitted.trimEnd().endsWith('Placeholder line 1999')).toBe(true);
    expect(fitDiagnostics(text, 10 * MB)).toBe(text);
  });

  it('give the last day’s error and warning lines for the email, 30 at most, each 300 letters at most', () => {
    const now = NOW.getTime();
    const line = (n: number, level: string) =>
      `${new Date(now - 60_000 * (100 - n)).toISOString()} [${level}] Placeholder ${String(n)} ${'x'.repeat(n === 99 ? 400 : 1)}`;
    const text = `== Log ==\n${Array.from({ length: 100 }, (_, n) => line(n, n % 2 ? 'error' : 'info')).join('\n')}\n`;
    const errors = recentErrors(text, now);
    expect(errors).toHaveLength(30);
    expect(errors.every((e) => e.includes('[error]'))).toBe(true);
    expect(errors.at(-1)?.length).toBeLessThanOrEqual(REPORT_LIMITS.errorLetters);
    expect(recentErrors('no log here', now)).toEqual([]);
  });
});

describe('a chosen period’s diagnostics (alpha.21, logs for 100+ installs (c))', () => {
  it('give the email the error and warning lines within the period’s days, not only the last day’s', () => {
    const day = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
    const text = [
      '== Log ==',
      `${day(18, 9)} [error] Placeholder: the 18th's error`,
      `${day(19, 9)} [error] Placeholder: the 19th's error`,
      `${day(19, 10)} [info] Placeholder: the 19th's info`,
      `${day(19, 23)} [warn] Placeholder: the 19th's late warning`,
      `${day(20, 8)} [error] Placeholder: today's error`,
      '',
    ].join('\n');
    const now = new Date(2026, 10, 20, 9).getTime();
    const yesterday = { from: new Date(2026, 10, 19).getTime(), to: new Date(2026, 10, 20).getTime() };
    expect(recentErrors(text, now, yesterday).map((l) => l.slice(l.indexOf(' ') + 1))).toEqual([
      "[error] Placeholder: the 19th's error",
      "[warn] Placeholder: the 19th's late warning",
    ]);
  });

  it('Save Diagnostics’ file is made as a report’s, off Main’s thread: names blanked, who and what, the period’s log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-diagnostics-text-'));
    const dbFile = library(dir);
    const input = inputFor(dir);
    const made = makeDiagnosticsText(
      { kind: 'diagnostics-text', main: { input, dbFile }, node: null },
      { openDb: (file) => openDatabase(file) },
    );
    if (!made.ok) throw new Error(made.message);
    const db = openDatabase(dbFile);
    expect(made.text).toBe(scrub(redactNames(diagnosticsText({ ...input, db }), libraryNames(db))));
    db.close();
    expect(made.text).toContain('Install id: 7K3P-Q2XM-4H9A');
    expect(made.text).toContain('Log: Today, 2026-11-20');
    expect(made.text).toContain('Placeholder: a warning');
    expect(made.text).not.toContain('Placeholder Report Secret');
  });

  it('a node’s too (it has no library)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-diagnostics-text-'));
    const input = inputFor(dir);
    const made = makeDiagnosticsText(
      {
        kind: 'diagnostics-text',
        main: null,
        node: {
          app: input.app,
          displays: [],
          screens: [],
          main: null,
          link: { state: 'offline', why: null, since: NOW.getTime() },
          clock: null,
          rev: 0,
          fromSaved: false,
          media: {
            wanted: 0,
            ready: 0,
            bytesWanted: 0,
            bytesReady: 0,
            copying: null,
            missingNow: 0,
            problem: null,
          },
          watchdog: [],
          crashJournal: [],
          crashFiles: { files: [], included: false },
          logFiles: input.logFiles,
          now: NOW,
          who: { ...WHO, computerId: null, grantId: null, role: null, made: 'node', main: null },
        },
      },
      {
        openDb: () => {
          throw new Error('a node has no library');
        },
      },
    );
    if (!made.ok) throw new Error(made.message);
    expect(made.text).toContain('== Drashti diagnostics (node) ==');
    expect(made.text).toContain('Access-list entry: none: a node, not paired');
    expect(made.text).toContain('Placeholder: a warning');
  });
});
