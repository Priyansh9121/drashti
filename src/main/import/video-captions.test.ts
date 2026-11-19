import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/database';
import { openDatabase } from '../db/database';
import { VideoCaptionsRepo } from '../db/video-captions';
import { MediaStore } from './media-store';
import { readCaptionFile } from './video-captions';

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-video-captions-'));
  db = openDatabase(join(dir, 'library.sqlite'));
});
afterEach(() => {
  if (db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const TEXT = '1\n00:00:01,000 --> 00:00:02,000\nFirst placeholder\n';
function fixture() {
  const mediaDir = join(dir, 'Media');
  mkdirSync(mediaDir);
  const path = join(dir, 'Sample.mp4');
  writeFileSync(path, 'generated placeholder video bytes');
  return { path, store: new MediaStore(db, { dir: mediaDir, freeBytes: () => 100 * 1024 ** 3 }) };
}

describe('video caption files in the library', () => {
  it('imports named sidecars, keeps captions off and survives source removal and a library restart', async () => {
    const { store, path } = fixture();
    const sidecar = join(dir, 'Sample.gu.auto.srt');
    writeFileSync(sidecar, TEXT.replace('First placeholder', 'નમૂનો એક'));
    writeFileSync(join(dir, 'Sample.en.vtt'), 'WEBVTT\n\n00:01.000 --> 00:02.000\nFirst placeholder\n');
    writeFileSync(join(dir, 'Other.en.srt'), TEXT);
    const imported = await store.importFile(path, { kind: 'media', path });
    if (!('mediaId' in imported)) throw new Error('Video not imported');
    const repo = new VideoCaptionsRepo(db);
    const view = repo.view(imported.mediaId);
    expect(view.selected).toBeNull();
    expect(view.tracks.map((t) => [t.language, t.automatic])).toEqual([
      ['en', false],
      ['gu', true],
    ]);
    const gu = view.tracks.find((t) => t.language === 'gu');
    if (!gu) throw new Error('Gujarati track missing');
    expect(repo.select(imported.mediaId, gu.id)).toBe(true);
    rmSync(sidecar);
    db.close();
    db = openDatabase(join(dir, 'library.sqlite'));
    expect(new VideoCaptionsRepo(db).chosen(imported.mediaId)?.cues[0]?.text).toBe('નમૂનો એક');
    expect(new VideoCaptionsRepo(db).view(imported.mediaId).selected).toBe(gu.id);
  });

  it('reports a bad or huge sidecar while the video is imported normally', async () => {
    const { store, path } = fixture();
    writeFileSync(join(dir, 'Sample.en.srt'), 'broken captions');
    writeFileSync(join(dir, 'Sample.gu.srt'), 'x'.repeat(2 * 1024 * 1024 + 1));
    const imported = await store.importFile(path, { kind: 'media', path });
    expect(imported.outcome).toBe('imported');
    expect('captionIssues' in imported && imported.captionIssues).toHaveLength(2);
    if ('mediaId' in imported) expect(new VideoCaptionsRepo(db).view(imported.mediaId).tracks).toEqual([]);
  });

  it('imports new tracks on an existing video without changing its chosen language', async () => {
    const { store, path } = fixture();
    writeFileSync(join(dir, 'Sample.en.srt'), TEXT);
    const imported = await store.importFile(path, { kind: 'media', path });
    if (!('mediaId' in imported)) throw new Error('Video not imported');
    const repo = new VideoCaptionsRepo(db);
    const en = repo.view(imported.mediaId).tracks[0];
    if (!en) throw new Error('English track missing');
    repo.select(imported.mediaId, en.id);
    writeFileSync(join(dir, 'Sample.hi.srt'), TEXT.replace('First placeholder', 'नमूना एक'));
    await store.importFile(path, { kind: 'media', path });
    expect(repo.view(imported.mediaId).tracks).toHaveLength(2);
    expect(repo.view(imported.mediaId).selected).toBe(en.id);
    expect(repo.select(imported.mediaId, 'unknown-track')).toBe(false);
    expect(repo.view(imported.mediaId).selected).toBe(en.id);
    expect(repo.select(imported.mediaId, null)).toBe(true);
    expect(repo.chosen(imported.mediaId)).toBeNull();
  });

  it('allows a separately chosen file, including a UTF-16 SRT saved on Windows', async () => {
    const { store, path } = fixture();
    const imported = await store.importFile(path, { kind: 'media', path });
    if (!('mediaId' in imported)) throw new Error('Video not imported');
    const file = join(dir, 'Other.hi.srt');
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TEXT, 'utf16le')]));
    const read = await readCaptionFile(file);
    expect(read.problem).toBeNull();
    if (!read.track) throw new Error('Track unreadable');
    const repo = new VideoCaptionsRepo(db);
    expect(repo.put(imported.mediaId, [read.track])).toBe(true);
    expect(repo.view(imported.mediaId).tracks[0]?.language).toBe('hi');
  });

  it('refuses missing and non-regular files with a notice, and leaves unrelated media alone', async () => {
    expect((await readCaptionFile(join(dir, 'missing.srt'))).problem).toBeTruthy();
    expect((await readCaptionFile(dir)).problem).toBeTruthy();
    db.prepare(
      "INSERT INTO media (id, kind, name, path) VALUES ('image', 'image', 'Placeholder', 'image.png')",
    ).run();
    expect(new VideoCaptionsRepo(db).put('image', [])).toBe(false);
    expect(new VideoCaptionsRepo(db).select('image', null)).toBe(false);
  });
});
