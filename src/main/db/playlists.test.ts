import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';
import { PlaylistRepo } from './playlists';
import { PresentationRepo } from './presentations';

let db: Db;
let playlists: PlaylistRepo;
let presentations: PresentationRepo;
let hymn: string;
let dhun: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  playlists = new PlaylistRepo(db);
  presentations = new PresentationRepo(db);
  const lib = presentations.ensureLibrary('Kirtans');
  hymn = presentations.insert({
    libraryId: lib,
    name: 'Placeholder Hymn',
    groups: [
      { name: 'Verse', slides: [{ elements: [] }] },
      { name: 'Chorus', slides: [{ elements: [] }] },
    ],
    arrangements: [{ name: 'Usual', groups: [0, 1, 0] }],
  });
  dhun = presentations.insert({
    libraryId: lib,
    name: 'Placeholder Dhun',
    groups: [{ name: 'A', slides: [{ elements: [] }] }],
  });
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable, format) VALUES ('loop', 'video', 'Placeholder loop.mp4', 'ab/x.mp4', 1, 'H.264 video (MP4)')",
  ).run();
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable, format) VALUES ('prores', 'video', 'Placeholder old.mov', 'cd/y.mov', 0, 'ProRes 422 video (QuickTime)')",
  ).run();
});

const labels = (id: string) => playlists.itemsOf(id).map((i) => i.label);

describe('playlists the operator edits', () => {
  it('makes playlists and folders, nested, in order, and renames them', () => {
    const folder = playlists.create('Sabhas', null, true) ?? '';
    const sunday = playlists.create('Ravi Sabha', folder, false) ?? '';
    const loose = playlists.create('Loose', null, false) ?? '';
    expect(playlists.create('Nowhere', sunday, false)).toBeNull(); // a playlist is not a folder
    expect(playlists.tree().map((p) => [p.name, p.isFolder, p.parentId])).toEqual([
      ['Sabhas', true, null],
      ['Ravi Sabha', false, folder],
      ['Loose', false, null],
    ]);
    expect(playlists.rename(sunday, 'Ravi Sabha (Sunday)')).toBe(true);
    expect(playlists.tree()[1]?.name).toBe('Ravi Sabha (Sunday)');
    expect(playlists.tree().map((p) => p.id)).toEqual([folder, sunday, loose]);
  });

  it('adds presentations, media and headers where asked, named after what they are', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    playlists.addItems(id, null, [
      { kind: 'presentation', presentationId: hymn },
      { kind: 'media', mediaId: 'loop' },
    ]);
    playlists.addItems(id, 0, [{ kind: 'header', label: 'Opening' }]);
    playlists.addItems(id, 2, [{ kind: 'presentation', presentationId: dhun }]);
    expect(labels(id)).toEqual(['Opening', 'Placeholder Hymn', 'Placeholder Dhun', 'Placeholder loop.mp4']);
    // Something that does not exist: nothing is added.
    expect(
      playlists.addItems(id, null, [
        { kind: 'media', mediaId: 'loop' },
        { kind: 'presentation', presentationId: 'gone' },
      ]),
    ).toEqual([]);
    expect(labels(id)).toHaveLength(4);
    expect(playlists.tree()[0]?.itemCount).toBe(4);
  });

  it('describes each item: order, removed presentations, media that cannot play', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    const [a, b, m] = playlists.addItems(id, null, [
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: dhun },
      { kind: 'media', mediaId: 'prores' },
    ]);
    const usual = presentations.get(hymn)?.arrangements[0]?.id ?? '';
    expect(playlists.setItemOrder(a ?? '', { mode: 'arrangement', arrangementId: usual })).toBe(true);
    // Another presentation's arrangement is refused.
    expect(playlists.setItemOrder(b ?? '', { mode: 'arrangement', arrangementId: usual })).toBe(false);
    expect(playlists.setItemOrder(b ?? '', { mode: 'all' })).toBe(true);
    presentations.remove([dhun]);
    expect(playlists.itemsOf(id)).toEqual([
      {
        id: a,
        kind: 'presentation',
        label: 'Placeholder Hymn',
        presentationId: hymn,
        presentationName: 'Placeholder Hymn',
        order: { mode: 'arrangement', arrangementId: usual },
        arrangementName: 'Usual',
      },
      {
        id: b,
        kind: 'presentation',
        label: 'Placeholder Dhun',
        presentationId: dhun,
        presentationName: null,
        order: { mode: 'all' },
        arrangementName: null,
      },
      {
        id: m,
        kind: 'media',
        label: 'Placeholder old.mov',
        mediaId: 'prores',
        media: 'video',
        missing: false,
        unplayable: 'ProRes 422 video (QuickTime)',
      },
    ]);
  });

  it('moves items, and removes them so Undo puts them back where they were', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    const [h1, p1, p2, m1] = playlists.addItems(id, null, [
      { kind: 'header', label: 'Opening' },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: dhun },
      { kind: 'media', mediaId: 'loop' },
    ]);
    expect(playlists.moveItems(id, [m1 ?? ''], 1)).toBe(true);
    expect(labels(id)).toEqual(['Opening', 'Placeholder loop.mp4', 'Placeholder Hymn', 'Placeholder Dhun']);
    expect(playlists.moveItems(id, [h1 ?? '', p2 ?? ''], 99)).toBe(true);
    expect(labels(id)).toEqual(['Placeholder loop.mp4', 'Placeholder Hymn', 'Opening', 'Placeholder Dhun']);
    expect(playlists.moveItems(id, ['someone else'], 0)).toBe(false);
    expect(playlists.removeItems([p1 ?? '', 'gone'])).toEqual([p1]);
    expect(labels(id)).toEqual(['Placeholder loop.mp4', 'Opening', 'Placeholder Dhun']);
    expect(playlists.playlistOf(p1 ?? '')).toBe(id);
    expect(playlists.restoreItems([p1 ?? ''])).toEqual([p1]);
    expect(labels(id)).toEqual(['Placeholder loop.mp4', 'Placeholder Hymn', 'Opening', 'Placeholder Dhun']);
  });

  it('removes a folder with everything in it, and Undo brings it all back', () => {
    const folder = playlists.create('Sabhas', null, true) ?? '';
    const inner = playlists.create('Festivals', folder, true) ?? '';
    const list = playlists.create('Diwali', inner, false) ?? '';
    const other = playlists.create('Other', null, false) ?? '';
    const removed = playlists.remove([folder]);
    expect(removed.sort()).toEqual([folder, inner, list].sort());
    expect(playlists.tree().map((p) => p.id)).toEqual([other]);
    expect(playlists.restore(removed).sort()).toEqual(removed.sort());
    expect(playlists.tree().map((p) => p.name)).toEqual(['Sabhas', 'Festivals', 'Diwali', 'Other']);
    // Removed long enough ago: gone for good.
    playlists.remove([other]);
    expect(playlists.purgeRemoved(new Date(Date.now() + 1000).toISOString())).toBe(1);
    expect(playlists.restore([other])).toEqual([]);
  });

  it('hands the show engine what each item plays, and why the others are stepped over', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    const [header, own, all, arranged, gone, video, old] = playlists.addItems(id, null, [
      { kind: 'header', label: 'Opening' },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: hymn },
      { kind: 'presentation', presentationId: dhun },
      { kind: 'media', mediaId: 'loop' },
      { kind: 'media', mediaId: 'prores' },
    ]);
    const usual = presentations.get(hymn)?.arrangements[0]?.id ?? '';
    playlists.setItemOrder(all ?? '', { mode: 'all' });
    playlists.setItemOrder(arranged ?? '', { mode: 'arrangement', arrangementId: usual });
    presentations.remove([dhun]);
    expect(playlists.playItems(id)).toEqual([
      { id: header, kind: 'skip', why: 'A header has nothing to show' },
      { id: own, kind: 'presentation', presentationId: hymn, arrangementId: undefined },
      { id: all, kind: 'presentation', presentationId: hymn, arrangementId: null },
      { id: arranged, kind: 'presentation', presentationId: hymn, arrangementId: usual },
      { id: gone, kind: 'skip', why: '“Placeholder Dhun” is no longer in the library' },
      { id: video, kind: 'media', mediaId: 'loop', media: 'video', label: 'Placeholder loop.mp4' },
      {
        id: old,
        kind: 'skip',
        why: 'Drashti cannot play “Placeholder old.mov” (ProRes 422 video (QuickTime))',
      },
    ]);
    // A removed playlist plays nothing.
    playlists.remove([id]);
    expect(playlists.playItems(id)).toBeNull();
  });

  it('fills a placeholder with a presentation, and renames headers only', () => {
    const id = playlists.create('Ravi Sabha', null, false) ?? '';
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, label, hint) VALUES ('ph', ?, 5, 'placeholder', 'Missing Song', 'Not found when the playlist was imported.')",
    ).run(id);
    const [header] = playlists.addItems(id, 0, [{ kind: 'header', label: 'Opening' }]);
    // The playlist list counts what the import could not find.
    expect(playlists.tree()[0]).toMatchObject({ itemCount: 2, placeholders: 1 });
    expect(playlists.fillPlaceholder('ph', 'gone')).toBe(false);
    expect(playlists.fillPlaceholder('ph', hymn)).toBe(true);
    expect(playlists.tree()[0]).toMatchObject({ itemCount: 2, placeholders: 0 });
    expect(playlists.itemsOf(id)[1]).toMatchObject({
      kind: 'presentation',
      label: 'Placeholder Hymn',
      presentationId: hymn,
    });
    // Only a placeholder can be filled.
    expect(playlists.fillPlaceholder('ph', dhun)).toBe(false);
    expect(playlists.renameHeader(header ?? '', 'Welcome')).toBe(true);
    expect(playlists.renameHeader('ph', 'Not a header')).toBe(false);
    expect(labels(id)).toEqual(['Welcome', 'Placeholder Hymn']);
  });
});
