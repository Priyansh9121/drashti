import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { MediaRemoval } from '../library/media-removal';
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
  it('lists only what was imported as media: a page Drashti drew is not, until the same picture is dropped in on its own (Session 26a)', async () => {
    const { db, store, file } = setup();
    const page = file('page-0001.png', 'placeholder page bytes');
    const stage = await store.stage(page);
    if (!stage.ok) throw new Error('not staged');
    const drawn = store.addStaged(stage.staged, { kind: 'drashti', path: '/decks/Katha.pdf#page=1' });
    const listed = () => new MediaRepo(db).list().map((m) => m.id);
    expect(listed()).toEqual([]);
    // The same bytes dropped in as a picture: the shared row is listed from then on.
    const same = file('Placeholder same picture.png', 'placeholder page bytes');
    const again = await store.importFile(same, { kind: 'media', path: same });
    expect(again).toMatchObject({ outcome: 'skipped', mediaId: drawn.mediaId });
    expect(listed()).toEqual([drawn.mediaId]);
    // And a deck drawing a page already listed leaves it listed.
    const other = file('Placeholder photo.png', 'placeholder photo bytes');
    const photo = await store.importFile(other, { kind: 'media', path: other });
    const stage2 = await store.stage(other);
    if (!stage2.ok || !('mediaId' in photo)) throw new Error('not staged');
    store.addStaged(stage2.staged, { kind: 'drashti', path: '/decks/Other.pdf#page=4' });
    expect(listed().sort()).toEqual([drawn.mediaId, photo.mediaId].sort());
  });

  it('brings deleted media back to life when the same file is imported again, even once its file has gone (Session 26a)', async () => {
    const { db, store, mediaDir, file } = setup();
    const path = file('Placeholder darshan.png', 'placeholder picture bytes');
    const first = await store.importFile(path, { kind: 'media', path });
    if (!('mediaId' in first)) throw new Error('not imported');
    const removal = new MediaRemoval(db, { idlePictures: () => [], onScreens: () => new Set() });
    removal.remove([first.mediaId]);
    // Imported again before the next start: the same item, no longer deleted.
    const again = await store.importFile(path, { kind: 'media', path });
    expect(again).toMatchObject({ outcome: 'imported', mediaId: first.mediaId });
    expect(db.prepare('SELECT deleted_at FROM media').get()).toEqual({ deleted_at: null });
    // Deleted, gone for good at a start (its file removed), then imported again: back with a file.
    removal.remove([first.mediaId]);
    expect(await removal.purge(mediaDir, new Set())).toBe(1);
    expect(storedFiles(mediaDir)).toEqual([]);
    const third = await store.importFile(path, { kind: 'media', path });
    expect(third).toMatchObject({ outcome: 'imported', mediaId: first.mediaId });
    expect(db.prepare("SELECT path <> '' AS has, missing, deleted_at FROM media").get()).toEqual({
      has: 1,
      missing: 0,
      deleted_at: null,
    });
    expect(storedFiles(mediaDir)).toHaveLength(1);
    // Imported once more, nothing deleted: as before, skipped.
    expect(await store.importFile(path, { kind: 'media', path })).toMatchObject({ outcome: 'skipped' });
  });

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
