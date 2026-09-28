import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import { MediaStore } from './media-store';

const GiB = 1024 ** 3;

function setup(freeBytes = 100 * GiB) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-media-'));
  const mediaDir = join(dir, 'Media');
  const sourceDir = join(dir, 'source');
  mkdirSync(mediaDir);
  mkdirSync(sourceDir);
  const db = openDatabase(':memory:');
  const store = new MediaStore(db, { dir: mediaDir, freeBytes: () => freeBytes });
  const file = (name: string, content: string) => {
    const path = join(sourceDir, name);
    writeFileSync(path, content);
    return path;
  };
  return { db, store, mediaDir, file };
}

const sha = (content: string) => createHash('sha256').update(content).digest('hex');
const storedFiles = (mediaDir: string) =>
  readdirSync(mediaDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

describe('MediaStore', () => {
  it('copies a media file in under its sha256 and records where it came from', async () => {
    const { db, store, mediaDir, file } = setup();
    const path = file('Background Loop.MP4', 'placeholder video bytes');
    const result = await store.importFile(path, { kind: 'media', path });
    const hash = sha('placeholder video bytes');
    expect(result).toMatchObject({
      outcome: 'imported',
      sha256: hash,
      bytes: 23,
      name: 'Background Loop.MP4',
    });
    const stored = join(mediaDir, hash.slice(0, 2), `${hash}.mp4`);
    expect(readFileSync(stored, 'utf8')).toBe('placeholder video bytes');
    expect(readFileSync(path, 'utf8')).toBe('placeholder video bytes');
    expect(
      db.prepare('SELECT kind, name, path, bytes, missing, source_kind, source_path FROM media').get(),
    ).toEqual({
      kind: 'video',
      name: 'Background Loop.MP4',
      path: `${hash.slice(0, 2)}/${hash}.mp4`,
      bytes: 23,
      missing: 0,
      source_kind: 'media',
      source_path: path,
    });
  });

  it('stores the same bytes once, whatever the file is called', async () => {
    const { db, store, mediaDir, file } = setup();
    const a = file('a.png', 'same image');
    const b = file('b copy.png', 'same image');
    const first = await store.importFile(a, { kind: 'media', path: a });
    const second = await store.importFile(b, { kind: 'media', path: b });
    expect(second).toMatchObject({ outcome: 'skipped', name: 'a.png' });
    expect(
      second.outcome !== 'failed' && first.outcome !== 'failed' && second.mediaId === first.mediaId,
    ).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM media').get()).toEqual({ n: 1 });
    expect(storedFiles(mediaDir)).toHaveLength(1);
  });

  it('refuses to copy when the disk would drop below the reserve, and copies nothing', async () => {
    const { db, store, mediaDir, file } = setup(2 * GiB + 10);
    const path = file('big.mov', 'x'.repeat(100));
    const result = await store.importFile(path, { kind: 'media', path });
    expect(result).toMatchObject({
      outcome: 'failed',
      issue: { code: 'no-space', fix: { kind: 'free-space' } },
    });
    expect(result.outcome === 'failed' && result.issue.fix).toEqual({ kind: 'free-space', neededBytes: 90 });
    expect(storedFiles(mediaDir)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM media').get()).toEqual({ n: 0 });
  });

  it('turns down files that are not media, and files it cannot read', async () => {
    const { store, file } = setup();
    const txt = file('notes.txt', 'x');
    expect(await store.importFile(txt, { kind: 'media', path: txt })).toMatchObject({
      outcome: 'failed',
      issue: { code: 'not-media' },
    });
    const gone = join(tmpdir(), 'drashti-no-such-file.png');
    expect(await store.importFile(gone, { kind: 'media', path: gone })).toMatchObject({
      outcome: 'failed',
      issue: { code: 'unreadable', fix: { kind: 'import-again', sourcePath: gone } },
    });
  });

  it('keeps a missing file as one missing item per original path, then fills it in keeping its id', async () => {
    const { db, store, file } = setup();
    const original = 'C:\\Users\\Media\\Old Loop.mov';
    const id = store.addMissing(original, 'video', { kind: 'pp7', path: original });
    expect(store.addMissing(original, 'video', { kind: 'pp7', path: original })).toBe(id);
    expect(store.missing()).toEqual([{ id, name: 'Old Loop.mov', kind: 'video', originalPath: original }]);

    const found = file('Old Loop.mov', 'found loop');
    const filled = await store.fillMissing(id, found);
    expect(filled).toMatchObject({ outcome: 'imported', mediaId: id, sha256: sha('found loop') });
    expect(store.missing()).toEqual([]);
    expect(db.prepare('SELECT missing, bytes FROM media WHERE id = ?').get(id)).toEqual({
      missing: 0,
      bytes: 10,
    });
  });

  it('merges a missing item into one that already has the same bytes', async () => {
    const { db, store, file } = setup();
    const path = file('loop.mov', 'shared bytes');
    const existing = await store.importFile(path, { kind: 'media', path });
    const missingId = store.addMissing('/Volumes/Old/loop.mov', 'video', {
      kind: 'pp6',
      path: '/Volumes/Old/loop.mov',
    });
    const repoint = vi.fn();
    const result = await store.fillMissing(missingId, path, repoint);
    const existingId = existing.outcome === 'failed' ? '' : existing.mediaId;
    expect(result).toMatchObject({ outcome: 'skipped', mediaId: existingId });
    expect(repoint).toHaveBeenCalledWith(missingId, existingId);
    expect(db.prepare('SELECT id FROM media').all()).toEqual([{ id: existingId }]);
    expect(await store.fillMissing(missingId, path)).toMatchObject({
      outcome: 'failed',
      issue: { code: 'not-missing' },
    });
  });

  it('leaves no partial file behind when a copy fails', async () => {
    const { store, mediaDir, file } = setup();
    const path = file('clip.mp4', 'clip');
    // A file where the two-letter folder should be makes the copy fail.
    writeFileSync(join(mediaDir, sha('clip').slice(0, 2)), 'in the way');
    const result = await store.importFile(path, { kind: 'media', path });
    expect(result.outcome).toBe('failed');
    expect(existsSync(join(mediaDir, sha('clip').slice(0, 2)))).toBe(true);
    expect(storedFiles(mediaDir)).toEqual([sha('clip').slice(0, 2)]);
  });
});
