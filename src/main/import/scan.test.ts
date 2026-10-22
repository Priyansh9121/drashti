import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatOf, importableExtensions, mediaKindOf, scanPaths, SOUND_EXTENSIONS } from './scan';

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
    // Word lyrics (Session 26f) are read as lyrics; an old Word document (.doc) is not.
    expect(formatOf('/a/x.docx')).toBe('text');
    expect(formatOf('/a/x.DOCX')).toBe('text');
    expect(formatOf('/a/x.doc')).toBe('unknown');
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
      'old notes.doc': 'x',
    });
    const result = await scanPaths([root]);
    expect(result.files.map((f) => [relative(root, f.path), f.format, f.size])).toEqual([
      [join('a', 'Song 1.txt'), 'text', 1],
      [join('a', 'bg.png'), 'media', 3],
      [join('b', 'Song 2.txt'), 'text', 1],
      ['notes.docx', 'text', 1],
      ['old notes.doc', 'unknown', 1],
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

describe('what the Import… menu’s Files… offers (Session 26a)', () => {
  it('is every extension Drashti imports, and nothing it does not', () => {
    const offered = importableExtensions();
    expect(new Set(offered).size).toBe(offered.length);
    for (const ext of offered) expect(formatOf(`/a/x.${ext}`), ext).not.toBe('unknown');
    for (const ext of [
      'pptx',
      'key',
      'pdf',
      'png',
      'heic',
      'mp4',
      'mov',
      'mp3',
      'wav',
      'pro6',
      'pro6x',
      'pro',
      'probundle',
      'txt',
      'docx',
    ])
      expect(offered).toContain(ext);
    expect(offered).not.toContain('doc');
  });
});

/** The kinds Session 50 adds: the common videos FFmpeg reads, and every sound Priyansh named. */
const NEW_VIDEOS = [
  '3gp',
  '3g2',
  'flv',
  'f4v',
  'ogv',
  'ts',
  'm2t',
  'vob',
  'mxf',
  'dv',
  'asf',
  'divx',
  'rm',
  'rmvb',
];
const NEW_SOUNDS = [
  'mka',
  'ac3',
  'eac3',
  'dts',
  'caf',
  'amr',
  'ape',
  'wv',
  'mp2',
  'au',
  'aifc',
  'm4b',
  'weba',
  'm4r',
  'mpa',
  'ra',
];

describe('every video and every sound file (Session 50)', () => {
  it('takes the new kinds wherever Drashti takes media, by name, in any case', () => {
    for (const ext of NEW_VIDEOS) {
      expect(mediaKindOf(`/a/Placeholder clip.${ext}`), ext).toBe('video');
      expect(mediaKindOf(`/a/Placeholder clip.${ext.toUpperCase()}`), ext).toBe('video');
      // A drop, Import… and a folder playlist (which takes what formatOf calls media) alike.
      expect(formatOf(`/a/Placeholder clip.${ext}`), ext).toBe('media');
    }
    for (const ext of NEW_SOUNDS) {
      expect(mediaKindOf(`/a/Placeholder sound.${ext}`), ext).toBe('audio');
      expect(formatOf(`/a/Placeholder sound.${ext}`), ext).toBe('media');
    }
    // What was taken before still is.
    for (const ext of ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'webm', 'mts', 'm2ts', 'mpg'])
      expect(mediaKindOf(`/a/x.${ext}`), ext).toBe('video');
    for (const ext of ['mp3', 'wav', 'aiff', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'])
      expect(mediaKindOf(`/a/x.${ext}`), ext).toBe('audio');
  });

  it('offers them in Import… (Files…), and the sounds in Audio’s Import, once each', () => {
    const offered = importableExtensions();
    expect(new Set(offered).size).toBe(offered.length);
    for (const ext of [...NEW_VIDEOS, ...NEW_SOUNDS]) expect(offered, ext).toContain(ext);
    expect(new Set(SOUND_EXTENSIONS).size).toBe(SOUND_EXTENSIONS.length);
    for (const ext of NEW_SOUNDS) expect(SOUND_EXTENSIONS, ext).toContain(ext);
    // Audio's Import offers sounds only.
    for (const ext of NEW_VIDEOS) expect(SOUND_EXTENSIONS, ext).not.toContain(ext);
  });
});
