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
    const deck = files.arrived(
      sent(pptx, 'Placeholder deck.pptx', { ext: 'pptx', kind: 'powerpoint' }),
      (m) => notes.push(m),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(notes).toEqual([DECK_WAITS]);
    expect(imported).toHaveLength(1);
    onAir = false;
    expect(await deck).toMatchObject({ ok: true });
    expect(imported).toHaveLength(2);
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

describe('what the network is told', () => {
  it('the switch, the size limit, 2 GB kept free, and slower on air; told when the stream goes on or off air', async () => {
    expect(files.policy()).toEqual({
      on: true,
      maxBytes: 2 * 1024 ** 3,
      reserveBytes: 2 * 1024 ** 3,
      slowed: false,
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
