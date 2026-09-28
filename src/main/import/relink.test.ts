import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import { MediaStore } from './media-store';
import { runRelink } from './relink';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-relink-'));
  const mediaDir = join(dir, 'Media');
  const found = join(dir, 'Found media');
  mkdirSync(mediaDir);
  mkdirSync(join(found, 'deep'), { recursive: true });
  const db = openDatabase(join(dir, 'drashti.sqlite'));
  const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
  return { db, media, found, dir };
}

describe('runRelink', () => {
  it('fills in missing media found by name in the chosen folder, and reports the rest', async () => {
    const { db, media, found } = setup();
    const loop = media.addMissing('C:\\Media\\Loop.mov', 'video', {
      kind: 'pp7',
      path: 'C:\\Media\\Loop.mov',
    });
    const bg = media.addMissing('/Volumes/Old/Backgrounds/bg.jpg', 'image', { kind: 'pp6', path: '/x' });
    const gone = media.addMissing('/Volumes/Old/gone.mp3', 'audio', { kind: 'pp6', path: '/y' });
    writeFileSync(join(found, 'deep', 'Loop.mov'), 'loop bytes');
    writeFileSync(join(found, 'bg.jpg'), 'bg bytes');

    const run = await runRelink({ db, media, runId: randomUUID(), folder: found });
    expect(run.totals).toMatchObject({ imported: 2, failed: 1, media: 2 });
    const report = new ImportRepo(db).report(run.id);
    expect(report?.items.map((i) => [i.name, i.outcome, i.target?.id])).toEqual([
      ['bg.jpg', 'imported', bg],
      ['gone.mp3', 'failed', gone],
      ['Loop.mov', 'imported', loop],
    ]);
    expect(report?.items[1]?.issues[0]?.fix).toEqual({ kind: 'relink-media', mediaId: gone });
    expect(media.missing().map((m) => m.id)).toEqual([gone]);
  });

  it('only looks for the items asked for', async () => {
    const { db, media, found } = setup();
    const a = media.addMissing('/old/a.png', 'image', { kind: 'pp6', path: '/p' });
    media.addMissing('/old/b.png', 'image', { kind: 'pp6', path: '/p' });
    writeFileSync(join(found, 'a.png'), 'a');
    writeFileSync(join(found, 'b.png'), 'b');
    const run = await runRelink({ db, media, runId: randomUUID(), folder: found, mediaIds: [a] });
    expect(run.totals).toMatchObject({ imported: 1 });
    expect(media.missing().map((m) => m.name)).toEqual(['b.png']);
  });

  it('moves slides over when the found file is already in the media library', async () => {
    const { db, media, found } = setup();
    writeFileSync(join(found, 'same.png'), 'same bytes');
    const stored = await media.importFile(join(found, 'same.png'), {
      kind: 'media',
      path: join(found, 'same.png'),
    });
    const storedId = stored.outcome === 'failed' ? '' : stored.mediaId;
    const missingId = media.addMissing('/old/same.png', 'image', { kind: 'pp6', path: '/p' });
    const repo = new PresentationRepo(db);
    const presentationId = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Uses media',
      groups: [],
    });
    db.prepare("INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g', ?, 'G', 0)").run(
      presentationId,
    );
    db.prepare("INSERT INTO slides (id, group_id, position) VALUES ('s', 'g', 0)").run();
    db.prepare(
      "INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES ('e', 's', 0, 'image', 0, 0, 1, 1, ?)",
    ).run(JSON.stringify({ mediaId: missingId }));

    const run = await runRelink({ db, media, runId: randomUUID(), folder: found });
    expect(run.totals).toMatchObject({ imported: 1 });
    expect(db.prepare("SELECT json_extract(props, '$.mediaId') AS id FROM elements").get()).toEqual({
      id: storedId,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM media').get()).toEqual({ n: 1 });
  });

  it('says when nothing is missing', async () => {
    const { db, media, found } = setup();
    const run = await runRelink({ db, media, runId: randomUUID(), folder: found });
    expect(run.message).toBe('No media is missing.');
  });
});
