import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { MediaStore } from './media-store';
import { runImport } from './pipeline';

/*
 * Imports the ProPresenter libraries of the computer running the tests, when
 * there are any: a check against real files that the synthetic fixtures
 * cannot give. Never in CI. Everything goes into a temporary library and media
 * folder outside the repository, deleted afterwards, and the test prints
 * counts only: real libraries hold real content, which never appears in test
 * output or in the repository.
 */

const HOME = homedir();
const PP6 = [
  join(HOME, 'Documents', 'ProPresenter6'),
  join(HOME, 'Library', 'Application Support', 'RenewedVision', 'ProPresenter6'),
];
const PP7 = [join(HOME, 'Documents', 'ProPresenter')];
const present = PP6.filter((p) => existsSync(p));
const present7 = PP7.filter((p) => existsSync(p));
const enabled = !process.env['CI'] && present.length + present7.length > 0;

describe.skipIf(!enabled)("this computer's own libraries (counts only)", () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-real-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Import some folders into a fresh temporary library and print what happened, as counts. */
  const importCounts = async (label: string, paths: string[]) => {
    const sub = join(dir, label);
    mkdirSync(join(sub, 'Media'), { recursive: true });
    const db = openDatabase(join(sub, 'drashti.sqlite'));
    const media = new MediaStore(db, { dir: join(sub, 'Media') });
    const timings = { scan: 0, read: 0, lookup: 0, parse: 0, write: 0, commit: 0, media: 0, total: 0 };
    const run = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths,
      options: {},
      timings,
      tempDir: sub,
    });
    const report = new ImportRepo(db).report(run.id);
    const byOutcome: Record<string, number> = {};
    const byIssue: Record<string, number> = {};
    for (const item of report?.items ?? []) {
      byOutcome[`${item.format}:${item.outcome}`] = (byOutcome[`${item.format}:${item.outcome}`] ?? 0) + 1;
      for (const issue of item.issues) byIssue[issue.code] = (byIssue[issue.code] ?? 0) + 1;
    }
    const t = run.totals;
    const counts = {
      files: t.files,
      presentations: t.presentations,
      groups: t.groups,
      slides: t.slides,
      arrangements: t.arrangements,
      playlists: t.playlists,
      media: t.media,
      missingMedia: (db.prepare('SELECT COUNT(*) AS n FROM media WHERE missing = 1').get() as { n: number })
        .n,
      failed: t.failed,
      unsupported: t.unsupported,
      byOutcome,
      byIssue,
      ms: timings,
    };
    console.log(`real ${label} import (counts only): ${JSON.stringify(counts)}`);
    db.close();
    return run;
  };

  it.skipIf(present.length === 0)(
    'imports the ProPresenter 6 library without a failed file',
    async () => {
      const run = await importCounts('PP6', present);
      expect(run.status).toBe('done');
      expect(run.totals.failed).toBe(0);
      expect(run.totals.presentations).toBeGreaterThan(0);
    },
    300_000,
  );

  it.skipIf(present7.length === 0)(
    'imports the ProPresenter 7 library without a failed file',
    async () => {
      const run = await importCounts('PP7', present7);
      expect(run.status).toBe('done');
      expect(run.totals.failed).toBe(0);
      expect(run.totals.presentations).toBeGreaterThan(0);
    },
    300_000,
  );
});
