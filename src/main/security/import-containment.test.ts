import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanPaths } from '../import/scan';
import { isInside } from '../media/contained';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { MediaStore } from '../import/media-store';
import { runImport } from '../import/pipeline';
import { pp6Playlist, pp6Presentation, cocoaRtf } from '../import/testing/pp6-fixtures';

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

describe('alpha.24 selected-folder links reached through document references', () => {
  it('does not copy a rejected outside media link when an imported document names it', async () => {
    const { selected, outside } = await fixture();
    const target = join(outside, 'private-placeholder.png');
    const link = join(selected, 'picture.png');
    await writeFile(target, 'Placeholder image bytes.');
    await symlink(target, link, 'file');
    await writeFile(
      join(selected, 'Chosen.pro6'),
      pp6Presentation({
        groups: [{ name: 'Verse', slides: [{ background: { path: link, kind: 'image' } }] }],
      }),
    );
    const db = openDatabase(':memory:');
    const media = new MediaStore(db, { dir: join(outside, 'media'), freeBytes: () => 1024 ** 4 });
    const stage = vi.spyOn(media, 'stage');
    try {
      await runImport({ db, media, runId: randomUUID(), paths: [selected], options: {} });
      expect(stage).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('does not reintroduce a rejected document link through an imported playlist', async () => {
    const { selected, outside } = await fixture();
    const target = join(outside, 'private-placeholder.pro6');
    const link = join(selected, 'alias.pro6');
    await writeFile(
      target,
      pp6Presentation({
        groups: [
          {
            name: 'Verse',
            slides: [{ text: [{ rtf: cocoaRtf([['Private placeholder text.', 72, [255, 255, 255]]]) }] }],
          },
        ],
      }),
    );
    await symlink(target, link, 'file');
    await writeFile(
      join(selected, 'Chosen.pro6pl'),
      pp6Playlist([{ name: 'Chosen', entries: [{ document: link, name: 'Alias' }] }]),
    );
    const db = openDatabase(':memory:');
    const media = new MediaStore(db, { dir: join(outside, 'media'), freeBytes: () => 1024 ** 4 });
    try {
      await runImport({ db, media, runId: randomUUID(), paths: [selected], options: {} });
      expect(db.prepare('SELECT id FROM presentations').all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('honours an explicitly chosen file link even when its parent folder is also selected', async () => {
    const { selected, outside } = await fixture();
    const target = join(outside, 'chosen-placeholder.txt');
    const link = join(selected, 'chosen.txt');
    await writeFile(target, 'Chosen placeholder text.');
    await symlink(target, link, 'file');
    const scan = await scanPaths([selected, link]);
    expect(scan.files.map((file) => file.path)).toEqual([link]);
    expect(scan.skipped).toEqual([]);
  });
});
