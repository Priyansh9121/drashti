import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ImportItemReport, NO_COUNTS } from '../../shared/import';
import { ADD_FILES_WORDS, type ArrivedFile, type FileKind } from '../../shared/phone-files';
import { type Db, openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { PlaylistRepo } from '../db/playlists';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { UPLOADS_DIR } from '../import/media-store';
import { compoundFile } from '../import/testing/compound-file';
import { makeZip } from '../import/testing/zip-writer';
import { ADD_FILES_SETTING, DECK_WAITS, PhoneFiles } from './phone-files';

/*
 * Files a phone added, as the main process takes them once all of one has arrived (Session 54, D4): checked
 * again, imported as a dropped file is (a stand-in import here, writing what the real one writes), named as the
 * phone named it, marked with the device's name, added to "Added from Phones", and the file sent removed; and
 * the playlists shared with phones (D3). Placeholder names and bytes only.
 */

let root = '';
let mediaDir = '';
let dir = '';
let db: Db;
let settings: SettingsRepo;
let playlists: PlaylistRepo;
let presentations: PresentationRepo;
let files: PhoneFiles;
let imported: string[] = [];
let notices: string[] = [];
let changed: string[][] = [];
let onAir = false;
let simple = false;
let letIn = true;
/** The playlist open in Pro Mode's window (Session 55, Part 8: Add photos). */
let open: { id: string; name: string } | null = null;
/** Simple Mode's one playlist (Session 55, Part 18), told only while Drashti is in Simple Mode (question 5). */
let simpleOne: string | null = null;
const reports = new Map<string, ImportItemReport[]>();

const DEVICES: Record<string, { name: string; kind: 'remote' | 'stage' }> = {
  'd-remote': { name: 'Placeholder phone', kind: 'remote' },
  'd-stage': { name: 'Placeholder stage tablet', kind: 'stage' },
};

/**
 * The import, as the real one leaves the library: a media item per picture (the same bytes again: the one already
 * there, skipped) or a presentation per deck, named after the file, and its report.
 */
function standInImport(paths: string[]): Promise<{ ok: true; runId: string }> {
  imported.push(...paths);
  const runId = randomUUID();
  const items: ImportItemReport[] = paths.map((path) => {
    const name = basename(path);
    const deck = name.endsWith('.pptx');
    const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
    const same = db.prepare('SELECT id FROM media WHERE sha256 = ?').get(sha) as { id: string } | undefined;
    let target: ImportItemReport['target'];
    if (deck) {
      const id = presentations.insert({
        libraryId: presentations.ensureLibrary('Default'),
        name: name.replace(/\.pptx$/u, ''),
        groups: [{ name: 'Pages', slides: [{ elements: [] }] }],
        source: { kind: 'pictures', path, ref: null, importedAt: null },
      });
      target = { kind: 'presentation', id };
    } else if (same) target = { kind: 'media', id: same.id };
    else {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO media (id, kind, name, path, sha256, source_kind, source_path, listed) VALUES (?, 'image', ?, ?, ?, 'media', ?, 1)",
      ).run(id, name, `ab/${id}.jpg`, sha, path);
      target = { kind: 'media', id };
    }
    return {
      id: randomUUID(),
      sourcePath: path,
      format: deck ? 'pictures' : 'media',
      outcome: same ? 'skipped' : 'imported',
      name,
      target,
      counts: NO_COUNTS,
      message: null,
      issues: [],
    };
  });
  reports.set(runId, items);
  return Promise.resolve({ ok: true, runId });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drashti-phone-files-'));
  mediaDir = join(root, 'Media');
  dir = join(mediaDir, UPLOADS_DIR);
  mkdirSync(mediaDir, { recursive: true });
  db = openDatabase(':memory:');
  settings = new SettingsRepo(db);
  playlists = new PlaylistRepo(db);
  presentations = new PresentationRepo(db);
  imported = [];
  notices = [];
  changed = [];
  onAir = false;
  simple = false;
  letIn = true;
  open = null;
  simpleOne = null;
  files = new PhoneFiles({
    db,
    settings,
    playlists,
    presentations,
    search: { update: () => undefined },
    device: (id) => DEVICES[id] ?? null,
    mediaDir,
    dir,
    importFiles: standInImport,
    report: (runId) => ({ items: reports.get(runId) ?? [] }),
    onAir: () => onAir,
    simpleMode: () => simple,
    notice: (text) => {
      notices.push(text);
    },
    changed: (ids) => {
      changed.push(ids);
    },
    log: () => undefined,
    waitMs: 10,
    letIn: () => letIn,
    openPlaylist: () => open?.id ?? null,
    simplePlaylist: () => (simple ? simpleOne : null),
  });
  files.setOn(true);
});
afterEach(() => {
  files.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 0x5a)]);

/** A file the network's worker handed over: all of it in the uploads folder, named by Drashti. */
function sent(
  bytes: Buffer | string,
  name: string,
  what: { ext: string; kind: FileKind } = { ext: 'jpg', kind: 'image' },
  deviceId = 'd-remote',
): ArrivedFile {
  const id = randomUUID();
  const file = join(dir, `${id}.${what.ext}`);
  writeFileSync(file, bytes);
  return { id, deviceId, name, file, ext: what.ext, kind: what.kind };
}

const added = () => playlists.tree().filter((n) => n.name.startsWith('Added from Phones'));

describe('a file a phone added', () => {
  it('is imported as a dropped file is, named as the phone named it, marked with the device, and in Added from Phones', async () => {
    const file = sent(JPEG, 'IMG_0001.HEIC');
    const outcome = await files.arrived(file);
    expect(outcome).toEqual({
      ok: true,
      message: 'Added to Drashti, in Media and the playlist “Added from Phones”.',
    });
    expect(imported).toEqual([file.file]);
    const media = new MediaRepo(db).list();
    expect(media.map((m) => [m.name, m.fromDevice])).toEqual([['IMG_0001.HEIC', 'Placeholder phone']]);
    const [playlist] = added();
    expect(playlist).toMatchObject({ name: 'Added from Phones', isFolder: false, itemCount: 1 });
    expect(playlists.itemsOf(playlist?.id ?? '')).toMatchObject([
      { kind: 'media', label: 'IMG_0001.HEIC', fromDevice: 'Placeholder phone' },
    ]);
    // The file sent is gone: the media folder keeps the library's own copy.
    expect(existsSync(file.file)).toBe(false);
    expect(notices).toEqual(['A picture from “Placeholder phone” is in the playlist “Added from Phones”.']);
    expect(changed).toEqual([[]]);
  });

  it('the next file joins the same playlist, the same one again once; made again when deleted; quiet in Simple Mode', async () => {
    await files.arrived(sent(JPEG, 'First.jpg'));
    await files.arrived(sent(Buffer.concat([JPEG, Buffer.from('2')]), 'Second.jpg'));
    expect(await files.arrived(sent(JPEG, 'First again.jpg'))).toEqual({
      ok: true,
      message: 'Drashti has this file already: it is in the playlist “Added from Phones”.',
    });
    expect(added().map((p) => p.itemCount)).toEqual([2]);
    expect(new MediaRepo(db).list().map((m) => m.name)).toEqual(['First.jpg', 'Second.jpg']);
    playlists.remove([added()[0]?.id ?? '']);
    simple = true;
    await files.arrived(sent(Buffer.concat([JPEG, Buffer.from('3')]), 'Third.jpg'));
    expect(added().map((p) => [p.name, p.itemCount])).toEqual([['Added from Phones', 1]]);
    expect(notices).toHaveLength(3);
  });

  it('a deck becomes a presentation named as the phone named it, without its extension, marked with the device', async () => {
    presentations.insert({
      libraryId: presentations.ensureLibrary('Default'),
      name: 'Placeholder sabha slides',
      groups: [{ name: 'A', slides: [{ elements: [] }] }],
    });
    const pptx = makeZip([{ name: 'ppt/presentation.xml', data: '<p:presentation/>' }]);
    const outcome = await files.arrived(
      sent(pptx, 'Placeholder sabha slides.pptx', { ext: 'pptx', kind: 'powerpoint' }),
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.message).toContain('in the library');
    const listed = presentations.list().map((p) => p.name);
    expect(listed).toContain('Placeholder sabha slides (2)');
    const [item] = playlists.itemsOf(added()[0]?.id ?? '');
    expect(item).toMatchObject({
      kind: 'presentation',
      label: 'Placeholder sabha slides (2)',
      fromDevice: 'Placeholder phone',
    });
    expect(changed).toHaveLength(1);
    expect(changed[0]).toHaveLength(1);
  });

  it('a deck sent while the stream is on air waits until it ends, the phone told why; a picture comes in at once', async () => {
    onAir = true;
    await files.arrived(sent(JPEG, 'Placeholder on air.jpg'));
    expect(imported).toHaveLength(1);
    const pptx = makeZip([{ name: 'ppt/presentation.xml', data: '<p:presentation/>' }]);
    const notes: string[] = [];
    let signalWaiting = (): void => undefined;
    const waiting = new Promise<'waiting'>((resolve) => {
      signalWaiting = () => resolve('waiting');
    });
    const deck = files.arrived(
      sent(pptx, 'Placeholder deck.pptx', { ext: 'pptx', kind: 'powerpoint' }),
      (m) => {
        notes.push(m);
        signalWaiting();
      },
    );
    try {
      // File inspection is asynchronous: observe the waiting note rather than guessing its duration.
      expect(await Promise.race([waiting, deck.then(() => 'finished' as const)])).toBe('waiting');
      expect(notes).toEqual([DECK_WAITS]);
      expect(imported).toHaveLength(1);
      onAir = false;
      expect(await deck).toMatchObject({ ok: true });
      expect(imported).toHaveLength(2);
    } finally {
      // A failed assertion must finish this upload before the fixture closes its database and folder.
      onAir = false;
      await Promise.allSettled([deck]);
    }
  });

  it('nothing while the switch is off: refused, never imported, and the file sent removed', async () => {
    files.setOn(false);
    expect(settings.get(ADD_FILES_SETTING)).toBe(false);
    const file = sent(JPEG, 'Placeholder.jpg');
    expect(await files.arrived(file)).toEqual({ ok: false, message: ADD_FILES_WORDS.off });
    expect(imported).toEqual([]);
    expect(existsSync(file.file)).toBe(false);
    expect(added()).toEqual([]);
  });

  it('nothing while Drashti is locked on its computer (the access lock): the worker is told, and a file refused', async () => {
    letIn = false;
    expect(files.policy().on).toBe(false);
    const file = sent(JPEG, 'Placeholder.jpg');
    expect(await files.arrived(file)).toEqual({
      ok: false,
      message: 'Drashti is locked on its computer: add the file again once it is open.',
    });
    expect(imported).toEqual([]);
    expect(existsSync(file.file)).toBe(false);
    letIn = true;
    expect(files.policy().on).toBe(true);
  });

  it('only from a Remote still paired', async () => {
    const fromStage = sent(JPEG, 'Placeholder.jpg', undefined, 'd-stage');
    expect(await files.arrived(fromStage)).toMatchObject({ ok: false });
    const removed = sent(JPEG, 'Placeholder.jpg', undefined, 'd-removed');
    expect(await files.arrived(removed)).toEqual({
      ok: false,
      message: 'This phone is no longer paired with Drashti.',
    });
    expect(imported).toEqual([]);
  });

  it('a renamed file is refused by what is inside it', async () => {
    const file = sent('Placeholder words, named as a picture.', 'Placeholder.jpg');
    expect(await files.arrived(file)).toEqual({ ok: false, message: ADD_FILES_WORDS.notTaken });
    expect(imported).toEqual([]);
    expect(existsSync(file.file)).toBe(false);
  });

  it('a PowerPoint 97–2003 file is never imported from a phone: its links could reach any file here', async () => {
    const file = sent(compoundFile('PowerPoint Document'), 'Placeholder old deck.ppt', {
      ext: 'ppt',
      kind: 'powerpoint',
    });
    expect(await files.arrived(file)).toEqual({ ok: false, message: ADD_FILES_WORDS.oldPowerPoint });
    expect(imported).toEqual([]);
    expect(existsSync(file.file)).toBe(false);
  });

  it('never a file outside the uploads folder, or not named by Drashti: never imported, never removed', async () => {
    const elsewhere = join(root, 'Elsewhere');
    mkdirSync(elsewhere);
    const outside = { ...sent(JPEG, 'Placeholder.jpg'), file: join(elsewhere, 'Placeholder.jpg') };
    writeFileSync(outside.file, JPEG);
    const named = sent(JPEG, 'Placeholder.jpg');
    const renamedInside = { ...named, file: join(dir, 'Placeholder.jpg') };
    writeFileSync(renamedInside.file, JPEG);
    const escaping = { ...named, file: join(dir, '..', '..', `${named.id}.jpg`) };
    for (const forged of [outside, renamedInside, escaping, { ...named, id: '../x' }])
      expect(await files.arrived(forged)).toMatchObject({ ok: false });
    expect(imported).toEqual([]);
    expect(existsSync(outside.file)).toBe(true);
    expect(existsSync(renamedInside.file)).toBe(true);
  });
});

describe('Add photos (Session 55, Part 8): pictures from a phone into the playlist open on Drashti', () => {
  it('a picture goes to the end of the open playlist, imported as a dropped one; Add from this Phone… still goes to Added from Phones', async () => {
    const sabha = playlists.create('Placeholder sabha', null, false) ?? '';
    open = { id: sabha, name: 'Placeholder sabha' };
    // The network is told which, for the phone's words.
    expect(files.policy()).toMatchObject({ on: true, openPlaylist: 'Placeholder sabha' });
    const photo = { ...sent(JPEG, 'IMG_0002.HEIC'), into: 'open' as const };
    expect(await files.arrived(photo)).toEqual({
      ok: true,
      message: 'Added to Drashti, in Media and the playlist “Placeholder sabha”.',
    });
    expect(imported).toEqual([photo.file]);
    expect(playlists.itemsOf(sabha)).toMatchObject([
      { kind: 'media', label: 'IMG_0002.HEIC', fromDevice: 'Placeholder phone' },
    ]);
    expect(notices).toEqual(['A picture from “Placeholder phone” is in the playlist “Placeholder sabha”.']);
    // The next after it, at the end.
    await files.arrived({ ...sent(Buffer.concat([JPEG, Buffer.from('b')]), 'IMG_0003.HEIC'), into: 'open' });
    expect(playlists.itemsOf(sabha).map((i) => i.label)).toEqual(['IMG_0002.HEIC', 'IMG_0003.HEIC']);
    expect(added()).toEqual([]);
    // Add from this Phone… (no playlist asked for): Added from Phones, as before.
    await files.arrived(sent(Buffer.concat([JPEG, Buffer.from('c')]), 'Other.jpg'));
    expect(added().map((p) => [p.name, p.itemCount])).toEqual([['Added from Phones', 1]]);
  });

  it('with no playlist open (or Simple Mode, which tells none), a picture goes to Added from Phones and says so', async () => {
    expect(files.policy()).toMatchObject({ openPlaylist: null });
    expect(await files.arrived({ ...sent(JPEG, 'IMG_0004.HEIC'), into: 'open' })).toEqual({
      ok: true,
      message: 'Added to Drashti, in Media and the playlist “Added from Phones”.',
    });
    expect(added().map((p) => p.itemCount)).toEqual([1]);
  });
});

// Question 5 (the owner's decision of 3 Nov 2026): while Drashti is in Simple Mode, a photo a phone sends goes to the end
// of Simple Mode's playlist, however it was sent, and stays in Media; in Pro Mode nothing changes.
describe('a phone’s photos in Simple Mode (question 5): at the end of Simple Mode’s playlist', () => {
  it('a picture, from Add from this Phone… or Add photos, goes to the end of Simple Mode’s playlist and into Media; the phone is told its name', async () => {
    const sabha = playlists.create('Sabha, 4 Nov 2026', null, false) ?? '';
    playlists.addItems(sabha, null, [{ kind: 'header', label: 'Placeholder start' }]);
    simpleOne = sabha;
    simple = true;
    expect(await files.arrived(sent(JPEG, 'IMG_0005.HEIC'))).toEqual({
      ok: true,
      message: 'Added to Drashti, in Media and the playlist “Sabha, 4 Nov 2026”.',
    });
    await files.arrived({ ...sent(Buffer.concat([JPEG, Buffer.from('d')]), 'IMG_0006.HEIC'), into: 'open' });
    expect(playlists.itemsOf(sabha).map((i) => i.label)).toEqual([
      'Placeholder start',
      'IMG_0005.HEIC',
      'IMG_0006.HEIC',
    ]);
    expect(new MediaRepo(db).list().map((m) => [m.name, m.fromDevice])).toEqual([
      ['IMG_0005.HEIC', 'Placeholder phone'],
      ['IMG_0006.HEIC', 'Placeholder phone'],
    ]);
    expect(added()).toEqual([]);
    // Quiet in Simple Mode, as before: its window shows the new rows.
    expect(notices).toEqual([]);
    // The phone's words name it (Add photos and Add from this Phone…).
    expect(files.policy()).toMatchObject({ simplePlaylist: 'Sabha, 4 Nov 2026', openPlaylist: null });
  });

  it('anything else from a phone goes to Added from Phones as before; in Pro Mode a picture does too', async () => {
    const sabha = playlists.create('Sabha, 4 Nov 2026', null, false) ?? '';
    simpleOne = sabha;
    simple = true;
    const pptx = makeZip([{ name: 'ppt/presentation.xml', data: '<p:presentation/>' }]);
    const deck = await files.arrived(
      sent(pptx, 'Placeholder deck.pptx', { ext: 'pptx', kind: 'powerpoint' }),
    );
    expect(deck.ok).toBe(true);
    expect(deck.message).toContain('the playlist “Added from Phones”');
    expect(playlists.itemsOf(sabha)).toEqual([]);
    expect(added().map((p) => p.itemCount)).toEqual([1]);
    // Pro Mode: Simple Mode's playlist is told to no one, and a picture goes to Added from Phones, as before.
    simple = false;
    expect(files.policy()).toMatchObject({ simplePlaylist: null });
    expect(await files.arrived(sent(JPEG, 'Placeholder Pro.jpg'))).toEqual({
      ok: true,
      message: 'Added to Drashti, in Media and the playlist “Added from Phones”.',
    });
    expect(playlists.itemsOf(sabha)).toEqual([]);
    expect(added().map((p) => p.itemCount)).toEqual([2]);
  });

  it('a Simple Mode playlist that is gone, or a folder, is never used: Added from Phones instead', async () => {
    const folder = playlists.create('Placeholder folder', null, true) ?? '';
    simpleOne = folder;
    simple = true;
    expect(files.policy()).toMatchObject({ simplePlaylist: null });
    expect(await files.arrived(sent(JPEG, 'Placeholder lost.jpg'))).toEqual({
      ok: true,
      message: 'Added to Drashti, in Media and the playlist “Added from Phones”.',
    });
  });
});

describe('what the network is told', () => {
  it('the switch, the size limit, 2 GB kept free, and slower on air; told when the stream goes on or off air', async () => {
    expect(files.policy()).toEqual({
      on: true,
      maxBytes: 2 * 1024 ** 3,
      reserveBytes: 2 * 1024 ** 3,
      slowed: false,
      // Add photos (Session 55, Part 8): no playlist open.
      openPlaylist: null,
      // Question 5: Pro Mode, so no Simple Mode's playlist.
      simplePlaylist: null,
    });
    files.setOn(false);
    expect(files.view()).toEqual({ on: false, maxBytes: 2 * 1024 ** 3 });
    let told = 0;
    files.watch(() => {
      told++;
    }, 10);
    onAir = true;
    await vi.waitFor(() => {
      expect(told).toBe(1);
    });
    expect(files.policy().slowed).toBe(true);
  });

  it('a new start clears what an earlier one left in the uploads folder', () => {
    writeFileSync(join(dir, 'left-behind.part'), 'half');
    files.close();
    files = new PhoneFiles({
      db,
      settings,
      playlists,
      presentations,
      search: { update: () => undefined },
      device: () => null,
      mediaDir,
      dir,
      importFiles: standInImport,
      report: () => null,
      onAir: () => false,
      simpleMode: () => false,
      notice: () => undefined,
      changed: () => undefined,
      log: () => undefined,
    });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('playlists shared with phones', () => {
  it('are shared and stop being shared; a folder of playlists or a template never is', () => {
    const sunday = playlists.create('Placeholder Sunday', null, false) ?? '';
    const folder = playlists.create('Placeholder folder', null, true) ?? '';
    db.prepare(
      "INSERT INTO media (id, kind, name, path) VALUES ('clip', 'video', 'Placeholder clip.mp4', 'ab/clip.mp4')",
    ).run();
    playlists.addItems(sunday, null, [{ kind: 'media', mediaId: 'clip' }]);
    expect(files.shared()).toEqual([]);
    expect(files.sharedItems(sunday)).toBeNull();
    expect(playlists.setShared(sunday, true)).toBe(true);
    expect(playlists.setShared(folder, true)).toBe(false);
    expect(files.shared()).toEqual([
      { id: sunday, name: 'Placeholder Sunday', itemCount: 1, fromFolder: false },
    ]);
    expect(files.sharedItems(sunday)?.map((i) => i.label)).toEqual(['Placeholder clip.mp4']);
    expect(playlists.tree().find((n) => n.id === sunday)?.shared).toBe(true);
    // Deleted, it is no longer shared; brought back (Undo), it is again.
    playlists.remove([sunday]);
    expect(files.shared()).toEqual([]);
    expect(files.sharedItems(sunday)).toBeNull();
    playlists.restore([sunday]);
    expect(files.shared().map((p) => p.id)).toEqual([sunday]);
    expect(playlists.setShared(sunday, false)).toBe(true);
    expect(files.shared()).toEqual([]);
    expect(playlists.tree().find((n) => n.id === sunday)?.shared).toBeUndefined();
    const template = playlists.create('Placeholder template', null, false, true) ?? '';
    expect(playlists.setShared(template, true)).toBe(false);
  });

  it('let a phone play a sound of theirs, and only while a shared playlist has it (D3)', () => {
    const sunday = playlists.create('Placeholder Sunday', null, false) ?? '';
    const other = playlists.create('Placeholder other', null, false) ?? '';
    for (const id of ['tone', 'chime'])
      db.prepare(
        `INSERT INTO media (id, kind, name, path) VALUES ('${id}', 'audio', 'Placeholder ${id}.wav', 'ab/${id}.wav')`,
      ).run();
    playlists.addItems(sunday, null, [{ kind: 'media', mediaId: 'tone' }]);
    playlists.addItems(other, null, [{ kind: 'media', mediaId: 'chime' }]);
    expect(playlists.isSharedMedia('tone')).toBe(false);
    playlists.setShared(sunday, true);
    expect(playlists.isSharedMedia('tone')).toBe(true);
    // In a playlist that is not shared, or in none.
    expect(playlists.isSharedMedia('chime')).toBe(false);
    expect(playlists.isSharedMedia('nothing')).toBe(false);
    // Its item removed (and brought back), the playlist deleted (and brought back), then no longer shared.
    const item = playlists.itemsOf(sunday)[0]?.id ?? '';
    playlists.removeItems([item]);
    expect(playlists.isSharedMedia('tone')).toBe(false);
    playlists.restoreItems([item]);
    expect(playlists.isSharedMedia('tone')).toBe(true);
    playlists.remove([sunday]);
    expect(playlists.isSharedMedia('tone')).toBe(false);
    playlists.restore([sunday]);
    expect(playlists.isSharedMedia('tone')).toBe(true);
    playlists.setShared(sunday, false);
    expect(playlists.isSharedMedia('tone')).toBe(false);
  });
});
