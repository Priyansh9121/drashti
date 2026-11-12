import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_COUNTS, type ImportItemReport, type ImportOptions } from '../../shared/import';
import type { SmartPlaylistView } from '../../shared/playlists';
import { openDatabase, type Db } from '../db/database';
import { PlaylistRepo } from '../db/playlists';
import { PresentationRepo } from '../db/presentations';
import { MediaRemoval } from '../library/media-removal';
import { SmartFolders } from './smart-folders';

/*
 * A smart playlist following a folder (Session 26c): a temporary folder of made-up files, a stand-in for
 * the import (a deck is a presentation per file, replaced in place when its bytes change; media is one
 * item per content, as Drashti's media is), and a clock the test moves.
 */

let root: string;
const services: SmartFolders[] = [];
/** A scan that went wrong says so in the log, and nothing else does: none is expected. */
const warnings: string[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'drashti-smart-'));
});

afterEach(async () => {
  for (const s of services.splice(0)) s.stop();
  expect(warnings.splice(0)).toEqual([]);
  await rm(root, { recursive: true, force: true });
});

const put = async (relative: string, content: string) => {
  const path = join(root, 'Sabha', ...relative.split('/'));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const gone = (relative: string) => rm(join(root, 'Sabha', ...relative.split('/')));

function setup(db: Db = openDatabase(':memory:'), maxFiles?: number, air = { on: false }) {
  const playlists = new PlaylistRepo(db);
  const presentations = new PresentationRepo(db);
  const lib = presentations.ensureLibrary('Default');
  const reports = new Map<string, ImportItemReport[]>();
  const decks = new Map<string, { id: string; sha: string }>();
  const imports: { paths: string[]; options: ImportOptions }[] = [];
  const views: SmartPlaylistView[][] = [];
  const clock = { now: 1_000_000 };
  /** While set, an import waits for it (a look held part-way). */
  const held: { gate: Promise<void> | null } = { gate: null };
  const importFiles = async (paths: string[], options: ImportOptions) => {
    imports.push({ paths, options });
    if (held.gate) await held.gate;
    const items: ImportItemReport[] = [];
    for (const path of paths) {
      const bytes = await readFile(path).catch(() => null);
      const name = basename(path);
      const base = { id: randomUUID(), sourcePath: path, counts: NO_COUNTS, message: null, issues: [] };
      if (!bytes || bytes.toString() === 'broken') {
        items.push({ ...base, format: 'media', outcome: 'failed', name, target: null });
        continue;
      }
      const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      if (/\.(pdf|pptx|key)$/iu.test(path)) {
        const earlier = decks.get(path);
        const deck = () => ({
          libraryId: lib,
          name: name.replace(/\.\w+$/u, ''),
          groups: [{ name: sha, slides: [{ elements: [] }] }],
        });
        if (earlier?.sha === sha) {
          items.push({
            ...base,
            format: 'pictures',
            outcome: 'skipped',
            name,
            target: { kind: 'presentation', id: earlier.id },
          });
        } else if (earlier && options.onConflict === 'replace') {
          presentations.replace(earlier.id, deck());
          decks.set(path, { id: earlier.id, sha });
          items.push({
            ...base,
            format: 'pictures',
            outcome: 'replaced',
            name,
            target: { kind: 'presentation', id: earlier.id },
          });
        } else {
          const id = presentations.insert(deck());
          decks.set(path, { id, sha });
          items.push({
            ...base,
            format: 'pictures',
            outcome: 'imported',
            name,
            target: { kind: 'presentation', id },
          });
        }
        continue;
      }
      const kind = /\.(mp4|mov)$/iu.test(path) ? 'video' : /\.(mp3|wav)$/iu.test(path) ? 'audio' : 'image';
      db.prepare('INSERT OR IGNORE INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)').run(
        sha,
        kind,
        name,
        `${sha}.x`,
      );
      items.push({ ...base, format: 'media', outcome: 'imported', name, target: { kind: 'media', id: sha } });
    }
    const runId = randomUUID();
    reports.set(runId, items);
    return { ok: true as const, runId };
  };
  const importNotice = vi.fn();
  const service = new SmartFolders({
    db,
    playlists,
    importFiles,
    report: (runId) => ({ items: reports.get(runId) ?? [] }),
    importNotice,
    changed: () => undefined,
    views: (v) => views.push(v),
    log: (level, message) => {
      if (level === 'warn') warnings.push(message);
    },
    now: () => clock.now,
    scanMs: 3_600_000,
    settleMs: 3000,
    // The test looks at the folder itself, when it says; nothing looks again by itself.
    schedule: () => () => undefined,
    ...(maxFiles === undefined ? {} : { maxFiles }),
    onAir: () => air.on,
  });
  services.push(service);
  /** One look at the folder now, and one once what it found has settled. */
  const settle = async (id: string) => {
    await service.scan(id);
    clock.now += 3000;
    await service.scan(id);
  };
  const shown = (id: string) =>
    playlists
      .itemsOf(id)
      .map((i) =>
        i.kind === 'header' ? `# ${i.label}` : `${i.label}${'gone' in i && i.gone ? ' (gone)' : ''}`,
      );
  const view = (id: string) => service.views().find((v) => v.playlistId === id);
  return {
    db,
    playlists,
    presentations,
    service,
    imports,
    reports,
    importNotice,
    views,
    clock,
    held,
    settle,
    shown,
    view,
  };
}

const folder = () => join(root, 'Sabha');

describe('a smart playlist following a folder', () => {
  it('fills itself in the folder’s order, with headers, once each file has held still', async () => {
    await put('Opening.mp4', 'video one');
    await put('Welcome.pptx', 'deck one');
    await put('Week 1/Notes.pdf', 'pdf one');
    await put('Week 1/Darshan.jpg', 'picture one');
    await put('Week 1/Clip.mp4', 'video two');
    await put('Week 1/Talk.mp3', 'sound one');
    await put('Week 1/readme.txt', 'not taken: lyrics are not media');
    await put('.hidden.jpg', 'never');
    const { service, playlists, settle, shown, imports, view } = setup();
    const made = await service.create(folder());
    expect(made.ok).toBe(true);
    const id = made.ok ? made.id : '';
    expect(playlists.tree()[0]).toMatchObject({ id, name: 'Sabha', kind: 'smart' });
    // Seen once: nothing goes in before its size has held still.
    expect(imports).toEqual([]);
    expect(view(id)).toMatchObject({ state: 'following', adding: 6, missing: 0 });
    await settle(id);
    expect(imports).toHaveLength(1);
    expect(imports[0]?.options).toEqual({ onConflict: 'replace', automatic: true });
    expect(shown(id)).toEqual([
      'Opening.mp4',
      'Welcome',
      '# Week 1',
      'Clip.mp4',
      'Notes',
      'Darshan.jpg',
      'Talk.mp3',
    ]);
    expect(view(id)).toMatchObject({ adding: 0 });
  });

  it('waits while the stream is on air or recording, then adds what held still (Session 28)', async () => {
    await put('Opening.mp4', 'video one');
    const air = { on: true };
    const { service, settle, shown, imports, view } = setup(undefined, undefined, air);
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    await settle(id);
    expect(imports).toEqual([]);
    expect(view(id)).toMatchObject({ state: 'waiting', adding: 1 });
    air.on = false;
    await service.scan(id);
    expect(imports).toHaveLength(1);
    expect(shown(id)).toEqual(['Opening.mp4']);
    expect(view(id)).toMatchObject({ state: 'following', adding: 0 });
  });

  it('adds a new file at the end of its folder’s part once it holds still, an item moved by hand staying put', async () => {
    await put('Opening.mp4', 'video one');
    await put('Week 1/Clip.mp4', 'video two');
    const { service, playlists, settle, shown, clock } = setup();
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    await settle(id);
    expect(shown(id)).toEqual(['Opening.mp4', '# Week 1', 'Clip.mp4']);
    // Moved by hand: Clip first.
    const clip = playlists.itemsOf(id).find((i) => i.label === 'Clip.mp4');
    playlists.moveItems(id, [clip?.id ?? ''], 0);
    expect(shown(id)).toEqual(['Clip.mp4', 'Opening.mp4', '# Week 1']);
    // A file still being copied: its size changes between looks, so it waits.
    await put('Week 1/Big.mp4', 'part');
    await service.scan(id);
    clock.now += 3000;
    await put('Week 1/Big.mp4', 'part and more');
    await service.scan(id);
    expect(shown(id)).toEqual(['Clip.mp4', 'Opening.mp4', '# Week 1']);
    clock.now += 3000;
    await service.scan(id);
    await put('Later.jpg', 'picture');
    await put('Week 2/Next.pptx', 'deck two');
    await settle(id);
    expect(shown(id)).toEqual([
      'Clip.mp4',
      'Opening.mp4',
      'Later.jpg',
      '# Week 1',
      'Big.mp4',
      '# Week 2',
      'Next',
    ]);
  });

  it('marks a file that is gone as missing, unmarks it when it is back, and removes the missing with one call', async () => {
    await put('A.jpg', 'picture a');
    await put('Sub/B.jpg', 'picture b');
    const { service, playlists, settle, shown, view } = setup();
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    await settle(id);
    await rename(join(folder(), 'A.jpg'), join(root, 'A.jpg'));
    await gone('Sub/B.jpg');
    await service.scan(id);
    expect(shown(id)).toEqual(['A.jpg (gone)', '# Sub', 'B.jpg (gone)']);
    expect(view(id)).toMatchObject({ missing: 2 });
    // Put back as it was: no longer missing, and nothing imported again.
    await rename(join(root, 'A.jpg'), join(folder(), 'A.jpg'));
    await service.scan(id);
    expect(shown(id)).toEqual(['A.jpg', '# Sub', 'B.jpg (gone)']);
    // Taken out, and Undo brings it back, missing still.
    const removed = service.removeMissing(id);
    expect(removed).toHaveLength(1);
    expect(shown(id)).toEqual(['A.jpg', '# Sub']);
    expect(view(id)).toMatchObject({ missing: 0 });
    playlists.restoreItems(removed);
    service.itemsRestored(removed);
    expect(shown(id)).toEqual(['A.jpg', '# Sub', 'B.jpg (gone)']);
    expect(view(id)).toMatchObject({ missing: 1 });
    service.removeMissing(id);
    // A file with the old one's name later is a new one: it joins its part.
    await put('Sub/B.jpg', 'picture b again');
    await settle(id);
    expect(shown(id)).toEqual(['A.jpg', '# Sub', 'B.jpg']);
  });

  it('replaces a changed file’s item in place: a deck keeps its presentation, a picture points at the new one', async () => {
    await put('Talk.pptx', 'deck one');
    await put('Cover.jpg', 'picture one');
    await put('Last.mp4', 'video');
    const { service, playlists, settle, shown, imports } = setup();
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    await settle(id);
    const before = playlists.itemsOf(id);
    expect(shown(id)).toEqual(['Last.mp4', 'Talk', 'Cover.jpg']);
    await put('Talk.pptx', 'deck one, changed');
    await put('Cover.jpg', 'picture one, changed');
    await settle(id);
    const after = playlists.itemsOf(id);
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
    const talk = (items: typeof after) => items.find((i) => i.label === 'Talk');
    const cover = (items: typeof after) => items.find((i) => i.label === 'Cover.jpg');
    expect(talk(after)).toMatchObject({
      presentationId: (talk(before) as { presentationId: string }).presentationId,
    });
    expect((cover(after) as { mediaId: string }).mediaId).not.toBe(
      (cover(before) as { mediaId: string }).mediaId,
    );
    expect(
      imports
        .at(-1)
        ?.paths.map((p) => basename(p))
        .sort(),
    ).toEqual(['Cover.jpg', 'Talk.pptx']);
  });

  it('says when the folder is gone, keeps its items, and carries on when it is back', async () => {
    await put('A.jpg', 'picture a');
    const { service, settle, shown, view } = setup();
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    await settle(id);
    await rename(folder(), join(root, 'Away'));
    await service.scan(id);
    expect(view(id)).toMatchObject({ state: 'folder-gone' });
    expect(shown(id)).toEqual(['A.jpg']);
    await rename(join(root, 'Away'), folder());
    await put('B.jpg', 'picture b');
    await settle(id);
    expect(view(id)).toMatchObject({ state: 'following', missing: 0 });
    expect(shown(id)).toEqual(['A.jpg', 'B.jpg']);
  });

  it('a look asked for while one is going waits for it, then looks again (a file can arrive meanwhile)', async () => {
    await put('A.jpg', 'picture a');
    const { service, settle, shown, view, clock, held } = setup();
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    // A look held part-way, in its import of A.
    let open: () => void = () => undefined;
    held.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await service.scan(id);
    clock.now += 3000;
    const first = service.scan(id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // B arrives while it is going, and another look is asked for.
    await put('B.jpg', 'picture b');
    const second = service.scan(id);
    held.gate = null;
    open();
    await Promise.all([first, second]);
    // The second look began after the first had ended: it saw B, waiting to hold still.
    expect(shown(id)).toEqual(['A.jpg']);
    expect(view(id)).toMatchObject({ adding: 1 });
    clock.now += 3000;
    await settle(id);
    expect(shown(id)).toEqual(['A.jpg', 'B.jpg']);
  });

  it('a file that will not import is not tried again until it changes', async () => {
    await put('Bad.jpg', 'broken');
    await put('Good.jpg', 'fine');
    const { service, settle, shown, imports, reports, importNotice } = setup();
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    await settle(id);
    expect(shown(id)).toEqual(['Good.jpg']);
    const [runId] = reports.keys();
    expect(runId).toBeDefined();
    expect(importNotice).toHaveBeenCalledWith({ runId });
    await settle(id);
    expect(imports).toHaveLength(1);
    expect(importNotice).toHaveBeenCalledTimes(1);
    await put('Bad.jpg', 'mended now');
    await settle(id);
    expect(shown(id)).toEqual(['Good.jpg', 'Bad.jpg']);
  });

  it('refuses a folder of more than the most files, and stops adding when one grows past it', async () => {
    for (let i = 0; i < 4; i++) await put(`P${String(i)}.jpg`, `picture ${String(i)}`);
    const { service, playlists, settle, shown, view } = setup(openDatabase(':memory:'), 3);
    const refused = await service.create(folder());
    expect(refused.ok ? '' : refused.message).toContain('a smart playlist follows at most 3');
    expect(playlists.tree()).toEqual([]);
    await gone('P3.jpg');
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    await settle(id);
    expect(shown(id)).toEqual(['P0.jpg', 'P1.jpg', 'P2.jpg']);
    await put('P3.jpg', 'picture 3');
    await gone('P0.jpg');
    await put('P4.jpg', 'picture 4');
    await settle(id);
    // Past the most: nothing added, and nothing marked missing either (which files count is not known).
    expect(view(id)).toMatchObject({ state: 'too-many', adding: 0 });
    expect(shown(id)).toEqual(['P0.jpg', 'P1.jpg', 'P2.jpg']);
    await gone('P4.jpg');
    await settle(id);
    expect(view(id)).toMatchObject({ state: 'following', missing: 1 });
    expect(shown(id)).toEqual(['P0.jpg (gone)', 'P1.jpg', 'P2.jpg', 'P3.jpg']);
  });

  it('catches up when Drashti starts again: files added, changed and taken away while it was closed', async () => {
    await put('A.jpg', 'picture a');
    await put('Sub/B.jpg', 'picture b');
    const db = openDatabase(':memory:');
    const first = setup(db);
    const made = await first.service.create(folder());
    const id = made.ok ? made.id : '';
    await first.settle(id);
    first.service.stop();
    expect(first.shown(id)).toEqual(['A.jpg', '# Sub', 'B.jpg']);
    await gone('A.jpg');
    await put('Sub/B.jpg', 'picture b, changed');
    await put('Sub/C.jpg', 'picture c');
    const second = setup(db);
    await second.service.start();
    second.clock.now += 3000;
    await second.service.scan(id);
    expect(second.shown(id)).toEqual(['A.jpg (gone)', '# Sub', 'B.jpg', 'C.jpg']);
    expect(second.view(id)).toMatchObject({ missing: 1 });
    second.service.stop();
  });

  it('stops following a deleted smart playlist, and follows it again when it is brought back', async () => {
    await put('A.jpg', 'picture a');
    const { service, playlists, settle, shown } = setup();
    const made = await service.create(folder());
    const id = made.ok ? made.id : '';
    await settle(id);
    playlists.remove([id]);
    await service.refresh();
    expect(service.views()).toEqual([]);
    await put('B.jpg', 'picture b');
    playlists.restore([id]);
    await service.refresh();
    await settle(id);
    expect(shown(id)).toEqual(['A.jpg', 'B.jpg']);
  });

  it('never brings back by itself what the operator took out or deleted, however its file changes, here or at a restart; Undo lets it in again (alpha.15)', async () => {
    await put('Talk.pptx', 'deck one');
    await put('Cover.jpg', 'picture one');
    await put('Clip.mp4', 'video one');
    await put('Darshan.jpg', 'picture two');
    const db = openDatabase(':memory:');
    const first = setup(db);
    const made = await first.service.create(folder());
    const id = made.ok ? made.id : '';
    await first.settle(id);
    const item = (label: string) => first.playlists.itemsOf(id).find((i) => i.label === label);
    const talk = item('Talk') as { id: string; presentationId: string };
    const cover = item('Cover.jpg') as { id: string; mediaId: string };
    const clip = item('Clip.mp4') as { id: string };
    // The deck deleted from the library (its card stays, marked), the picture deleted from the library (its row goes
    // with it), and the video's row taken out of the playlist (the library keeps the video).
    first.presentations.remove([talk.presentationId]);
    const media = new MediaRemoval(db, { onScreens: () => new Set() });
    expect(media.remove([cover.mediaId])).toEqual([cover.mediaId]);
    first.playlists.removeItems([clip.id]);
    // Every file changes (a cloud folder fetching them again), while Drashti runs.
    for (const [name, content] of [
      ['Talk.pptx', 'deck one, fetched again'],
      ['Cover.jpg', 'picture one, fetched again'],
      ['Clip.mp4', 'video one, fetched again'],
      ['Darshan.jpg', 'picture two, fetched again'],
    ] as const)
      await put(name, content);
    const imported = first.imports.length;
    await first.settle(id);
    expect(first.imports.slice(imported).flatMap((r) => r.paths.map((p) => basename(p)))).toEqual([
      'Darshan.jpg',
    ]);
    expect(first.view(id)).toMatchObject({ adding: 0 });
    first.service.stop();
    // And at a restart, after they changed again while Drashti was closed.
    await put('Talk.pptx', 'deck one, fetched once more');
    await put('Cover.jpg', 'picture one, fetched once more');
    const second = setup(db);
    await second.service.start();
    second.clock.now += 3000;
    await second.service.scan(id);
    expect(second.imports).toEqual([]);
    expect(second.presentations.get(talk.presentationId)).toBeNull();
    expect(second.playlists.itemsOf(id).map((i) => i.id)).toEqual([talk.id, item('Darshan.jpg')?.id]);
    // Undo: each is back, and the next look takes its file as it is now, in place.
    second.presentations.restore([talk.presentationId]);
    expect(media.restore([cover.mediaId])).toEqual([cover.mediaId]);
    second.playlists.restoreItems([clip.id]);
    await second.settle(id);
    expect(second.imports.flatMap((r) => r.paths.map((p) => basename(p))).sort()).toEqual([
      'Clip.mp4',
      'Cover.jpg',
      'Talk.pptx',
    ]);
    expect(
      second.playlists
        .itemsOf(id)
        .map((i) => i.id)
        .sort(),
    ).toEqual([talk.id, cover.id, clip.id, item('Darshan.jpg')?.id].sort());
    second.service.stop();
  });
});

describe('files and folders dropped on Drashti (Session 56, the owner’s item 5)', () => {
  /** A folder of its own under the test's, with these files in it (none: an empty folder). */
  const folderWith = async (name: string, files: Record<string, string>) => {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const path = join(dir, ...relative.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    return dir;
  };

  it('makes each folder a smart playlist following it, at once, named after it; files are given back in the order dropped', async () => {
    const week = await folderWith('Placeholder Week 1', {
      'Clip.mp4': 'video one',
      'Talks/Notes.pdf': 'pdf one',
    });
    const empty = await folderWith('Placeholder Later', {});
    const loose = join(root, 'Placeholder loose.jpg');
    await writeFile(loose, 'picture one');
    const { service, playlists, settle, shown } = setup();
    const dropped = await service.fromDrop([loose, week, empty, join(root, 'Placeholder not there.mp4')]);
    expect(dropped.problems).toEqual([]);
    expect(dropped.files).toEqual([loose, join(root, 'Placeholder not there.mp4')]);
    expect(dropped.made).toHaveLength(2);
    const [weekId = '', emptyId = ''] = dropped.made;
    // Smart playlists at the top of the list (the last made first), each following its folder.
    expect(playlists.tree().slice(0, 2)).toMatchObject([
      { id: emptyId, name: 'Placeholder Later', kind: 'smart' },
      { id: weekId, name: 'Placeholder Week 1', kind: 'smart' },
    ]);
    expect(service.views().map((v) => v.folder)).toEqual([week, empty]);
    await settle(weekId);
    expect(shown(weekId)).toEqual(['Clip.mp4', '# Talks', 'Notes']);
  });

  it('gives back a Keynote deck saved as a package, and a folder of only lyrics or the other program’s files, for the import as before', async () => {
    const deck = await folderWith('Placeholder talk.key', {
      'Index.zip': 'deck inside',
      'Data/one.jpg': 'inside',
    });
    const lyrics = await folderWith('Placeholder lyrics', { 'Kirtan.txt': 'words', 'Old/Song.pro6': 'old' });
    const both = await folderWith('Placeholder both', { 'Kirtan.txt': 'words', 'Hall.jpg': 'picture' });
    const { service, playlists } = setup();
    const dropped = await service.fromDrop([deck, lyrics, both]);
    expect(dropped.files).toEqual([deck, lyrics]);
    expect(dropped.made).toHaveLength(1);
    expect(playlists.tree().map((n) => n.name)).toEqual(['Placeholder both']);
  });

  it('says why a folder too big to follow made none', async () => {
    const big = await folderWith('Placeholder big', { 'a.jpg': '1', 'b.jpg': '2', 'c.jpg': '3' });
    const { service, playlists } = setup(undefined, 2);
    const dropped = await service.fromDrop([big]);
    expect(dropped.made).toEqual([]);
    expect(dropped.files).toEqual([]);
    expect(dropped.problems).toHaveLength(1);
    expect(dropped.problems[0]).toContain('a smart playlist follows at most 2');
    expect(playlists.tree()).toEqual([]);
  });
});
