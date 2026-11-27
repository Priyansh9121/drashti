import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanPaths } from '../import/scan';
import { isInside } from '../media/contained';

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
