import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanPaths } from '../import/scan';
import { isInside } from '../media/contained';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { MediaStore } from '../import/media-store';
import { runImport } from '../import/pipeline';

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'drashti-secipc-import-'));
  fixtures.push(root);
  const selected = join(root, 'selected');
  const outside = join(root, 'outside');
  await Promise.all([mkdir(selected), mkdir(outside)]);
  return { selected, outside };
}

describe('alpha.24 folder import containment', () => {
  it('refuses a file symlink that escapes the folder chosen for import', async () => {
    const { selected, outside } = await fixture();
    const target = join(outside, 'private-placeholder.txt');
    const link = join(selected, 'words.txt');
    await writeFile(target, 'Private placeholder text.');
    await symlink(target, link, 'file');
    // Source evidence: the current scan includes this path, whose bytes are outside the chosen folder.
    expect(await readFile(link, 'utf8')).toBe('Private placeholder text.');
    expect(isInside(await realpath(selected), await realpath(link))).toBe(false);
    const result = await scanPaths([selected]);
    expect(result.files.map((file) => file.path)).not.toContain(link);
  });

  it('preserves file links whose targets remain inside the chosen folder', async () => {
    const { selected } = await fixture();
    const target = join(selected, 'original.txt');
    const link = join(selected, 'alias.txt');
    await writeFile(target, 'Placeholder text.');
    await symlink(target, link, 'file');
    const result = await scanPaths([selected]);
    expect(result.files.map((file) => file.path)).toEqual([link, target]);
  });

  it('preserves an explicit file choice outside any previously chosen folder', async () => {
    const { outside } = await fixture();
    const target = join(outside, 'chosen-placeholder.txt');
    await writeFile(target, 'Placeholder text.');
    expect((await scanPaths([target])).files.map((file) => file.path)).toEqual([target]);
  });
});

async function importFixture(replaceAfterScan = false) {
  const { selected, outside } = await fixture();
  const target = join(outside, 'private-placeholder.txt');
  const link = join(selected, 'words.txt');
  await writeFile(target, '[Verse]\nPrivate placeholder text.');
  if (replaceAfterScan) await writeFile(link, '[Verse]\nChosen placeholder text.');
  else await symlink(target, link, 'file');
  const db = openDatabase(':memory:');
  const media = new MediaStore(db, { dir: outside, freeBytes: () => 1024 ** 4 });
  try {
    let replaced = false;
    const summary = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths: [selected],
      options: {},
      progressEveryMs: 0,
      onProgress: (progress) => {
        if (replaceAfterScan && !replaced && progress.phase === 'importing') {
          replaced = true;
          rmSync(link);
          symlinkSync(target, link, 'file');
        }
      },
    });
    const report = new ImportRepo(db).report(summary.id);
    const presentations = db.prepare('SELECT id FROM presentations').all();
    return { link, report, presentations };
  } finally {
    db.close();
  }
}

describe('alpha.24 folder import report and read boundary', () => {
  it('names the skipped outside link in the import report without importing its contents', async () => {
    const { link, report, presentations } = await importFixture();
    expect(presentations).toEqual([]);
    expect(report?.items).toEqual([
      expect.objectContaining({
        sourcePath: link,
        name: 'words.txt',
        outcome: 'skipped',
        issues: [expect.objectContaining({ code: 'outside-import-folder', fix: null })],
      }),
    ]);
    expect(report?.items[0]?.message).toMatch(/outside.*chosen folder/u);
    expect(report?.totals.skipped).toBe(1);
  });

  it('checks again before reading a scanned file that was replaced with an outside link', async () => {
    const { link, report, presentations } = await importFixture(true);
    expect(presentations).toEqual([]);
    expect(report?.items).toEqual([expect.objectContaining({ sourcePath: link, outcome: 'skipped' })]);
  });
});
