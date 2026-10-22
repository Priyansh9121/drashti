import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudOf, droppedName, type DropFolderView } from '../../shared/drop-folder';
import { NO_COUNTS, type ImportItemReport } from '../../shared/import';
import { SOUND_EXTENSIONS } from '../../shared/media';
import { openDatabase, type Db } from '../db/database';
import { DropFolder } from './drop-folder';

/*
 * The drop folder (Session 28, decision 21): a temporary folder of made-up files, a stand-in for the import
 * (one media item per content, as Drashti's media is), and a clock the test moves. Each look is asked for by
 * the test; nothing looks again by itself.
 */

let root: string;
let folder: string;
const services: DropFolder[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'drashti-drop-'));
  folder = join(root, 'Drop here');
  await mkdir(folder);
});

afterEach(async () => {
  for (const s of services.splice(0)) s.stop();
  await rm(root, { recursive: true, force: true });
});

const put = (name: string, content: string) => writeFile(join(folder, name), content);

function setup(options: { db?: Db; maxBytes?: number; air?: { on: boolean }; simple?: boolean } = {}) {
  const db = options.db ?? openDatabase(':memory:');
  const settings = new Map<string, unknown>();
  const reports = new Map<string, ImportItemReport[]>();
  const imports: { names: string[]; bytes: number[] }[] = [];
  const notices: string[] = [];
  const views: DropFolderView[] = [];
  const clock = { now: 1_000_000 };
  const busy = new Set<string>();
  const watching = { failed: null as (() => void) | null, count: 0 };
  const scheduled: { ms: number; run: () => void }[] = [];
  let mediaChanged = 0;
  const importFiles = async (paths: string[]) => {
    const items: ImportItemReport[] = [];
    const bytes: number[] = [];
    for (const path of paths) {
      const content = await readFile(path).catch(() => null);
      const name = basename(path);
      const base = { id: randomUUID(), sourcePath: path, counts: NO_COUNTS, message: null, issues: [] };
      bytes.push(content?.length ?? -1);
      if (!content || content.toString() === 'broken') {
        items.push({
          ...base,
          format: 'media',
          outcome: 'failed',
          name,
          target: null,
          message: 'Not a picture.',
        });
        continue;
      }
      const sha = createHash('sha256').update(content).digest('hex').slice(0, 16);
      const kind = /\.(mp4|webm|mov)$/iu.test(path) ? 'video' : 'image';
      const had = db.prepare('SELECT 1 FROM media WHERE id = ?').get(sha);
      db.prepare('INSERT OR IGNORE INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)').run(
        sha,
        kind,
        name,
        `${sha}.x`,
      );
      items.push({
        ...base,
        format: 'media',
        outcome: had ? 'skipped' : 'imported',
        name,
        target: { kind: 'media', id: sha },
      });
    }
    imports.push({ names: paths.map((p) => basename(p)), bytes });
    const runId = randomUUID();
    reports.set(runId, items);
    return { ok: true as const, runId };
  };
  const air = options.air ?? { on: false };
  const service = new DropFolder({
    db,
    settings: { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
    dataDir: join(root, 'Drashti data'),
    importFiles,
    report: (runId) => ({ items: reports.get(runId) ?? [] }),
    onAir: () => air.on,
    simpleMode: () => options.simple ?? false,
    notice: (t) => notices.push(t),
    mediaChanged: () => {
      mediaChanged += 1;
    },
    changed: (v) => views.push(v),
    log: () => undefined,
    now: () => clock.now,
    scanMs: 3_600_000,
    settleMs: 5000,
    watch: (_dir, _changed, failed) => {
      watching.count += 1;
      watching.failed = failed;
      return () => undefined;
    },
    busy: (path) => Promise.resolve(busy.has(basename(path))),
    schedule: (ms, run) => {
      const s = { ms, run };
      scheduled.push(s);
      return () => {
        scheduled.splice(scheduled.indexOf(s), 1);
      };
    },
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
  services.push(service);
  /** One look now, and one once what it found has held still. */
  const settle = async () => {
    await service.scan();
    clock.now += 5000;
    await service.scan();
  };
  const dropped = () =>
    (
      db.prepare('SELECT name FROM media WHERE dropped_at IS NOT NULL ORDER BY name').all() as {
        name: string;
      }[]
    ).map((r) => r.name);
  return {
    db,
    service,
    settings,
    imports,
    notices,
    views,
    clock,
    busy,
    air,
    watching,
    scheduled,
    settle,
    dropped,
    mediaChanged: () => mediaChanged,
  };
}

describe('the drop folder', () => {
  it('takes pictures, videos and sounds once each has held still for 5 s; lists the rest; passes over what is being written', async () => {
    await put('Darshan.png', 'picture one');
    await put('Clip.webm', 'video one');
    await put('Talk.mp3', 'a sound');
    await put('Notes.pdf', 'a deck');
    await put('Photo.jpg.crdownload', 'half a download');
    await put('Movie.mp4.part', 'half a copy');
    await put('~$Slides.png', 'an editor’s lock file');
    await put('.hidden.png', 'never');
    const h = setup();
    expect(await h.service.setFolder(folder)).toMatchObject({ ok: true });
    // Seen once: nothing is taken before it has held still.
    expect(h.imports).toEqual([]);
    expect(h.service.view()).toMatchObject({ state: 'watching', waiting: 3 });
    h.clock.now += 4999;
    await h.service.scan();
    expect(h.imports).toEqual([]);
    h.clock.now += 1;
    await h.service.scan();
    expect(h.imports.map((i) => i.names.sort())).toEqual([['Clip.webm', 'Darshan.png', 'Talk.mp3']]);
    expect(h.dropped()).toEqual(['Clip.webm', 'Darshan.png', 'Talk.mp3']);
    expect(h.service.view().notTaken).toEqual([
      {
        name: 'Notes.pdf',
        reason: 'Only pictures, videos and sounds are taken from the drop folder.',
        tooLarge: false,
      },
    ]);
    // One quiet notice for the batch.
    expect(h.notices).toEqual(['3 files from the drop folder are in Media.']);
    expect(h.mediaChanged()).toBe(1);
  });

  it('takes the videos and sounds Session 50 adds (MKV, MXF, TS, VOB, FLV…; MKA, AC-3…) as it takes any', async () => {
    for (const name of ['Arti.mkv', 'Katha.mxf', 'Sabha.ts', 'Old DVD.vob', 'Clip.flv', 'Phone.3gp'])
      await put(name, `placeholder ${name}`);
    await put('Dhun.mka', 'a sound');
    await put('Bhajan.ac3', 'another sound');
    const h = setup();
    await h.service.setFolder(folder);
    await h.settle();
    expect(h.imports.map((i) => i.names.sort())).toEqual([
      ['Arti.mkv', 'Bhajan.ac3', 'Clip.flv', 'Dhun.mka', 'Katha.mxf', 'Old DVD.vob', 'Phone.3gp', 'Sabha.ts'],
    ]);
    expect(h.service.view().notTaken).toEqual([]);
  });

  it('takes every sound Drashti takes (Session 51), into Media with the drop folder’s mark; the notice says sounds', async () => {
    const names = SOUND_EXTENSIONS.map((ext) => `Placeholder ${ext}.${ext}`);
    for (const name of names) await put(name, `placeholder ${name}`);
    const h = setup();
    await h.service.setFolder(folder);
    await h.settle();
    expect(h.imports.map((i) => i.names.sort())).toEqual([[...names].sort()]);
    expect(h.dropped()).toEqual([...names].sort());
    expect(h.service.view().notTaken).toEqual([]);
    expect(h.notices).toEqual([`${String(names.length)} sounds from the drop folder are in Media.`]);
    // One more, on its own: one sound.
    await put('Placeholder bell.wav', 'placeholder bell');
    await h.settle();
    expect(h.notices.at(-1)).toBe('1 sound from the drop folder is in Media.');
  });

  it('a file still being written is taken only once whole', async () => {
    const h = setup();
    await h.service.setFolder(folder);
    await put('Big.mp4', 'first part ');
    await h.service.scan();
    for (let i = 0; i < 3; i++) {
      h.clock.now += 2000;
      await appendFile(join(folder, 'Big.mp4'), `part ${String(i)} `);
      await h.service.scan();
    }
    expect(h.imports).toEqual([]);
    h.clock.now += 5000;
    await h.service.scan();
    const whole = (await stat(join(folder, 'Big.mp4'))).size;
    expect(h.imports).toEqual([{ names: ['Big.mp4'], bytes: [whole] }]);
  });

  it('a file another program still has open waits (Windows’ check), then is taken', async () => {
    const h = setup();
    await put('Held.png', 'picture');
    h.busy.add('Held.png');
    await h.service.setFolder(folder);
    await h.settle();
    h.clock.now += 20_000;
    await h.service.scan();
    expect(h.imports).toEqual([]);
    h.busy.delete('Held.png');
    await h.settle();
    expect(h.imports).toHaveLength(1);
  });

  it('waits while the stream is on air or recording, then takes what held still', async () => {
    const air = { on: true };
    const h = setup({ air });
    await put('Darshan.png', 'picture one');
    await h.service.setFolder(folder);
    await h.settle();
    expect(h.imports).toEqual([]);
    expect(h.service.view()).toMatchObject({ state: 'waiting', waiting: 1 });
    air.on = false;
    await h.service.scan();
    expect(h.imports).toHaveLength(1);
    expect(h.service.view()).toMatchObject({ state: 'watching', waiting: 0 });
  });

  it('over the size limit: listed, and imported anyway when an admin says (not on air)', async () => {
    const air = { on: false };
    const h = setup({ maxBytes: 10, air });
    await put('Huge.mp4', 'more than ten bytes');
    await h.service.setFolder(folder);
    await h.settle();
    expect(h.imports).toEqual([]);
    expect(h.service.view().notTaken).toEqual([
      { name: 'Huge.mp4', reason: 'Larger than 10 bytes: an admin can import it anyway.', tooLarge: true },
    ]);
    air.on = true;
    expect(await h.service.importAnyway('Huge.mp4')).toMatchObject({ ok: false });
    air.on = false;
    expect(await h.service.importAnyway('Huge.mp4')).toMatchObject({ ok: true, view: { notTaken: [] } });
    expect(h.dropped()).toEqual(['Huge.mp4']);
  });

  it('takes a file once (after a restart too), again only when it changes; a file gone leaves its media', async () => {
    const db = openDatabase(':memory:');
    const first = setup({ db });
    await put('Darshan.png', 'picture one');
    await first.service.setFolder(folder);
    await first.settle();
    expect(first.imports).toHaveLength(1);
    first.service.stop();
    // Drashti again: nothing new.
    const again = setup({ db });
    again.settings.set('dropFolder', { folder, on: true });
    await again.settle();
    expect(again.imports).toEqual([]);
    // Changed: taken again, as a new picture.
    await put('Darshan.png', 'picture one, edited');
    await again.settle();
    expect(again.imports).toHaveLength(1);
    // Gone: its media stays.
    await rm(join(folder, 'Darshan.png'));
    await again.settle();
    expect(again.dropped()).toEqual(['Darshan.png', 'Darshan.png']);
  });

  it('never writes to the folder', async () => {
    await put('Darshan.png', 'picture one');
    await put('Talk.mp3', 'a sound');
    await put('broken.png', 'broken');
    const before = await Promise.all(
      (await readdir(folder))
        .sort()
        .map(async (n) => [
          n,
          (await stat(join(folder, n))).mtimeMs,
          await readFile(join(folder, n), 'utf8'),
        ]),
    );
    const h = setup();
    await h.service.setFolder(folder);
    await h.settle();
    const after = await Promise.all(
      (await readdir(folder))
        .sort()
        .map(async (n) => [
          n,
          (await stat(join(folder, n))).mtimeMs,
          await readFile(join(folder, n), 'utf8'),
        ]),
    );
    expect(after).toEqual(before);
    // The one that would not import is listed, with why.
    expect(h.service.view().notTaken.map((n) => n.name)).toEqual(['broken.png']);
  });

  it('in Simple Mode it carries on, with no notice', async () => {
    const h = setup({ simple: true });
    await put('Darshan.png', 'picture one');
    await h.service.setFolder(folder);
    await h.settle();
    expect(h.imports).toHaveLength(1);
    expect(h.notices).toEqual([]);
  });

  it('the watching stopping: looks again at once, and watches again', async () => {
    const h = setup();
    await h.service.setFolder(folder);
    expect(h.watching.count).toBe(1);
    await put('Darshan.png', 'picture one');
    h.watching.failed?.();
    // Looked at once: the file is seen.
    await new Promise((r) => setTimeout(r, 0));
    await h.service.scan();
    expect(h.service.view().waiting).toBe(1);
    const rewatch = h.scheduled.find((s) => s.ms === 5000 && h.watching.count === 1);
    rewatch?.run();
    expect(h.watching.count).toBe(2);
  });

  it('never Drashti’s own folder; a folder kept by a cloud service is said', async () => {
    const h = setup();
    await mkdir(join(root, 'Drashti data', 'Media'), { recursive: true });
    expect(await h.service.setFolder(join(root, 'Drashti data', 'Media'))).toMatchObject({ ok: false });
    expect(await h.service.setFolder(join(root, 'nowhere'))).toMatchObject({ ok: false });
    expect(cloudOf('C:\\Users\\Mandir\\OneDrive\\Drop')).toBe('OneDrive');
    expect(cloudOf('/Users/mandir/Library/Mobile Documents/com~apple~CloudDocs/Drop')).toBe('iCloud Drive');
    expect(cloudOf('/Users/mandir/Dropbox/Drop')).toBe('Dropbox');
    expect(cloudOf('/Users/mandir/Library/CloudStorage/GoogleDrive-x/My Drive/Drop')).toBe('Google Drive');
    expect(cloudOf('/Users/mandir/Pictures/Drop')).toBeNull();
  });

  it('passes over names left while writing', () => {
    expect(['a.png', 'b.mp4'].every(droppedName)).toBe(true);
    expect(
      ['.a.png', '~$b.png', 'c.part', 'd.crdownload', 'e.download', 'f.tmp', 'g.mp4.partial'].some(
        droppedName,
      ),
    ).toBe(false);
  });
});
