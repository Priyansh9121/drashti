import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatOf, mediaKindOf, scanPaths } from './scan';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'drashti-scan-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('formatOf', () => {
  it('knows lyrics, media and the two presentation formats by extension', () => {
    expect(formatOf('/a/Song.TXT')).toBe('text');
    expect(formatOf('/a/loop.MOV')).toBe('media');
    expect(formatOf('/a/x.pro6')).toBe('pp6');
    expect(formatOf('/a/x.pro6plx')).toBe('pp6');
    expect(formatOf('/a/x.pro')).toBe('pp7');
    expect(formatOf('/a/x.probundle')).toBe('pp7');
    expect(formatOf('/a/x.docx')).toBe('unknown');
    expect(formatOf('/ProPresenter/Themes/Clouds/Theme')).toBe('pp7');
    expect(formatOf('/ProPresenter/Playlists/Library')).toBe('pp7');
    expect(formatOf('/ProPresenter/Configuration/Screens')).toBe('unknown');
    expect(mediaKindOf('a.jpeg')).toBe('image');
    expect(mediaKindOf('a.m4a')).toBe('audio');
    expect(mediaKindOf('a.txt')).toBeNull();
  });
});

describe('scanPaths', () => {
  it('lists files under folders in path order, skipping hidden files and OS clutter', async () => {
    const root = tree({
      'b/Song 2.txt': 'x',
      'a/Song 1.txt': 'x',
      'a/bg.png': 'png',
      '.hidden.txt': 'x',
      'a/.DS_Store': 'x',
      'Thumbs.db': 'x',
      '__MACOSX/a/Song 1.txt': 'x',
      'notes.docx': 'x',
    });
    const result = await scanPaths([root]);
    expect(result.files.map((f) => [relative(root, f.path), f.format, f.size])).toEqual([
      [join('a', 'Song 1.txt'), 'text', 1],
      [join('a', 'bg.png'), 'media', 3],
      [join('b', 'Song 2.txt'), 'text', 1],
      ['notes.docx', 'unknown', 1],
    ]);
    expect([...result.mediaByName.keys()]).toEqual(['bg.png']);
    expect(result.missing).toEqual([]);
  });

  it('takes files given directly, once each, and reports paths that do not exist', async () => {
    const root = tree({ 'Song.txt': 'x' });
    const file = join(root, 'Song.txt');
    const result = await scanPaths([file, root, join(root, 'gone.txt')]);
    expect(result.files.map((f) => f.path)).toEqual([file]);
    expect(result.missing).toEqual([{ path: join(root, 'gone.txt'), message: 'Not found.' }]);
  });

  it('skips folders it is told to, and stops at the file limit', async () => {
    const root = tree({ 'keep/1.txt': 'x', 'keep/2.txt': 'x', 'keep/3.txt': 'x', 'own/x.txt': 'x' });
    const skipped = await scanPaths([root], { skip: (dir) => dir.endsWith('own') });
    expect(skipped.files).toHaveLength(3);
    const limited = await scanPaths([root], { maxFiles: 2 });
    expect(limited.files).toHaveLength(2);
    expect(limited.truncated).toBe(true);
  });

  it('does not follow links to folders (no loops)', async () => {
    const root = tree({ 'a/Song.txt': 'x' });
    try {
      symlinkSync(root, join(root, 'a', 'loop'), 'dir');
    } catch {
      return; // Creating links needs extra rights on some Windows machines.
    }
    const result = await scanPaths([root]);
    expect(result.files.map((f) => relative(root, f.path))).toEqual([join('a', 'Song.txt')]);
  });
});
