import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../db/database';
import { MediaRepo } from '../db/media';
import { withSceneMarkers } from './scene-marker-save';
let dir = '';
let db: Db;
let media: MediaRepo;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-scene-save-'));
  db = openDatabase(join(dir, 'library.sqlite'));
  media = new MediaRepo(db);
  db.prepare(
    "INSERT INTO media(id,kind,name,path,duration_ms,playable) VALUES ('m','video','Placeholder clip','placeholder.mp4',10000,1)",
  ).run();
  media.setMarkers('m', {
    startMs: 100,
    endMs: 9000,
    markers: [{ id: 'own', name: 'Placeholder point', atMs: 200 }],
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
it('appends selected scenes with the recipe and retains current named markers and trim points', () => {
  const result = withSceneMarkers(db, media, 'm', [2500, 2500, 200], () => {
    db.prepare("INSERT INTO app_meta(key,value) VALUES('placeholder-recipe','kept')").run();
    return { ok: true as const, revision: 2 };
  });
  expect(result).toEqual({ ok: true, revision: 2 });
  const points = media.markersOf('m');
  expect(points).toMatchObject({ startMs: 100, endMs: 9000 });
  expect(points?.markers).toHaveLength(2);
  expect(points?.markers[0]).toEqual({ id: 'own', name: 'Placeholder point', atMs: 200 });
  expect(points?.markers[1]).toMatchObject({ name: 'Scene 0:02.5', atMs: 2500 });
  expect(points?.markers[1]?.id).not.toBe('own');
});
it('rolls back both stores when recipe Save refuses', () => {
  const result = withSceneMarkers(db, media, 'm', [2500], () => {
    db.prepare("INSERT INTO app_meta(key,value) VALUES('placeholder-recipe','not-kept')").run();
    return { ok: false as const, message: 'Placeholder refused. Open the editor again.' };
  });
  expect(result.ok).toBe(false);
  expect(db.prepare("SELECT value FROM app_meta WHERE key='placeholder-recipe'").get()).toBeUndefined();
  expect(media.markersOf('m')?.markers).toHaveLength(1);
});
it('refuses before recipe Save when all 50 marker places are occupied', () => {
  media.setMarkers('m', {
    startMs: 100,
    endMs: 9000,
    markers: Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: 'Placeholder', atMs: 100 + i })),
  });
  const save = vi.fn(() => ({ ok: true as const }));
  expect(withSceneMarkers(db, media, 'm', [2500], save).ok).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(media.markersOf('m')?.markers).toHaveLength(50);
});

it('keeps a first suggested marker on a video that has never had marker settings', () => {
  media.setMarkers('m', null);
  const save = vi.fn(() => ({ ok: true as const }));
  expect(withSceneMarkers(db, media, 'm', [2500], save)).toEqual({ ok: true });
  expect(save).toHaveBeenCalledOnce();
  expect(media.markersOf('m')).toMatchObject({ startMs: null, endMs: null, markers: [{ atMs: 2500 }] });
});
