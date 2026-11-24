import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../db/database';
import { MediaStore } from '../import/media-store';
import { CombineVideos, type CombineDeps } from './combine-service';
import { discardUnlisted } from './video-copy-files';

/*
 * a22-review-combine2: what a combine copied into Media and never listed is removed only when nothing uses it, only
 * with its file, without ever waiting on the library's write lock, and never stops Drashti starting. No FFmpeg here:
 * placeholder bytes, a real library database and real files.
 */
const removal = vi.hoisted(() => ({ fails: [] as string[] }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof NodeFs>();
  // A file or folder held open (Windows: a scanner, a player, an FFmpeg still going) cannot be removed.
  const held: typeof real.rmSync = (path, options) => {
    const named = String(path).replaceAll('\\', '/');
    if (removal.fails.some((tail) => named.endsWith(tail)))
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    real.rmSync(path, options);
  };
  return { ...real, default: { ...real, rmSync: held }, rmSync: held };
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  removal.fails = [];
  for (const close of cleanup.splice(0).reverse()) close();
});

function library() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-combine-leftovers-'));
  const db = openDatabase(join(dir, 'library.sqlite'));
  const work = join(dir, 'video-combine-work');
  mkdirSync(work, { recursive: true });
  cleanup.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, db, work };
}
let made = 0;
/** A combine's copy into Media, never listed: its row (from its own work file) and its file in Media's folder. */
function leftover(at: { dir: string; db: Db; work: string }, job = `job-${String(++made)}`) {
  const sha = (String(made) + 'ab').padEnd(64, '0');
  const path = `${sha.slice(0, 2)}/${sha}.mp4`;
  const id = `left-${String(made)}`;
  mkdirSync(join(at.dir, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(at.dir, path), 'placeholder combined video');
  const source = join(at.work, `.${job}.mp4`);
  at.db
    .prepare(
      `INSERT INTO media(id,kind,name,path,sha256,bytes,playable,source_kind,source_path,listed)
       VALUES (?,'video','Placeholder one + Placeholder two.mp4',?,?,26,1,'drashti',?,0)`,
    )
    .run(id, path, sha, source);
  return { id, path, sha, source, file: join(at.dir, path) };
}
const row = (db: Db, id: string) => db.prepare('SELECT id, listed FROM media WHERE id = ?').get(id);
/** The same bytes staged again, as an import that reuses a row by its sha256 hands them to MediaStore. */
const staged = (left: ReturnType<typeof leftover>) => ({
  kind: 'video' as const,
  name: 'Placeholder object.mp4',
  rel: left.path,
  sha256: left.sha,
  bytes: 26,
  probe: { kind: 'video' as const, playable: true, format: 'H.264 video (MP4)' },
});

it('keeps a leftover a PowerPoint or Keynote video took up as an editable document object, with its file', async () => {
  const at = library();
  const left = leftover(at);
  // library/imported-slides.ts: the deck's video, kept as an editable object, reuses the row by its bytes.
  const taken = new MediaStore(at.db, { dir: at.dir }).addStaged(staged(left), {
    kind: 'drashti',
    path: 'Editable document object',
  });
  expect(taken.mediaId).toBe(left.id);
  at.db.exec(`
    INSERT INTO libraries(id,name) VALUES ('placeholder-library','Placeholder library');
    INSERT INTO presentations(id,library_id,name) VALUES ('placeholder-deck','placeholder-library','Placeholder deck');
    INSERT INTO slide_groups(id,presentation_id,name,position) VALUES ('placeholder-group','placeholder-deck','Group',0);
    INSERT INTO slides(id,group_id,position) VALUES ('placeholder-slide','placeholder-group',0);`);
  at.db
    .prepare(
      "INSERT INTO elements(id,slide_id,position,kind,x,y,width,height,props) VALUES ('placeholder-video','placeholder-slide',0,'video',0,0,1920,1080,?)",
    )
    .run(JSON.stringify({ mediaId: left.id }));
  expect(await discardUnlisted({ db: at.db, mediaDir: at.dir, file: left.source })).toBe(0);
  expect(row(at.db, left.id)).toBeDefined();
  expect(existsSync(left.file)).toBe(true);
});

it('keeps a leftover a kirtan bundle linked by its sha256 into a running order', async () => {
  const at = library();
  const left = leftover(at);
  // import/kirtan-bundle-import.ts: a bundle naming a video it does not include links any row with that sha256.
  const linked = at.db
    .prepare('SELECT id FROM media WHERE sha256 = ? AND kind = ? AND missing = 0 AND deleted_at IS NULL')
    .get(left.sha, 'video') as { id: string };
  expect(linked.id).toBe(left.id);
  at.db.exec("INSERT INTO playlists(id,name) VALUES ('placeholder-order','Placeholder running order')");
  at.db
    .prepare(
      "INSERT INTO playlist_items(id,playlist_id,position,kind,media_id) VALUES ('placeholder-item','placeholder-order',0,'media',?)",
    )
    .run(linked.id);
  expect(await discardUnlisted({ db: at.db, mediaDir: at.dir, file: left.source })).toBe(0);
  expect(row(at.db, left.id)).toBeDefined();
  expect(at.db.prepare("SELECT 1 FROM playlist_items WHERE id = 'placeholder-item'").get()).toBeDefined();
  expect(existsSync(left.file)).toBe(true);
});

it('keeps a leftover Edit Video took up as its copy', async () => {
  const at = library();
  const left = leftover(at);
  // convert/edit-files.ts: an edited copy with the same bytes reuses the row; the edit records it as its copy.
  const taken = new MediaStore(at.db, { dir: at.dir }).addStaged(staged(left), {
    kind: 'drashti',
    path: left.path,
  });
  expect(taken.mediaId).toBe(left.id);
  at.db.exec(
    "INSERT INTO media(id,kind,name,path,playable) VALUES ('placeholder-original','video','Placeholder original.mp4','original.mp4',1)",
  );
  at.db
    .prepare(
      "INSERT INTO video_edit_copies(source_id,revision,copy_id,recipe) VALUES ('placeholder-original',1,?,'{}')",
    )
    .run(left.id);
  at.db.prepare("UPDATE media SET video_edit_copy_id = ? WHERE id = 'placeholder-original'").run(left.id);
  expect(await discardUnlisted({ db: at.db, mediaDir: at.dir, file: left.source })).toBe(0);
  expect(row(at.db, left.id)).toBeDefined();
  expect(existsSync(left.file)).toBe(true);
});

it('the start sweep keeps a leftover a wallpaper uses, and still removes one nothing uses', async () => {
  const at = library();
  const used = leftover(at);
  const unused = leftover(at);
  at.db.exec("INSERT INTO wallpapers(id,name,position) VALUES ('placeholder-wallpaper','Placeholder',0)");
  at.db
    .prepare(
      "INSERT INTO wallpaper_pictures(wallpaper_id,position,media_id) VALUES ('placeholder-wallpaper',0,?)",
    )
    .run(used.id);
  expect(await discardUnlisted({ db: at.db, mediaDir: at.dir, folder: at.work })).toBe(1);
  expect(row(at.db, used.id)).toBeDefined();
  expect(existsSync(used.file)).toBe(true);
  expect(at.db.prepare('SELECT 1 FROM wallpaper_pictures WHERE media_id = ?').get(used.id)).toBeDefined();
  expect(row(at.db, unused.id)).toBeUndefined();
  expect(existsSync(unused.file)).toBe(false);
});

it('a file that cannot be removed keeps its row, so the next start finds it again', async () => {
  const at = library();
  const left = leftover(at);
  removal.fails = [left.path];
  expect(await discardUnlisted({ db: at.db, mediaDir: at.dir, folder: at.work })).toBe(0);
  expect(row(at.db, left.id)).toBeDefined();
  expect(existsSync(left.file)).toBe(true);
  // The next start: no longer held.
  removal.fails = [];
  expect(await discardUnlisted({ db: at.db, mediaDir: at.dir, folder: at.work })).toBe(1);
  expect(row(at.db, left.id)).toBeUndefined();
  expect(existsSync(left.file)).toBe(false);
});

it("never waits on the library's write lock: it looks again and finishes once the lock is free", async () => {
  const at = library();
  const left = leftover(at);
  // The import worker's connection holds the write lock.
  const other = openDatabase(join(at.dir, 'library.sqlite'));
  cleanup.push(() => {
    if (other.inTransaction) other.exec('ROLLBACK');
    other.close();
  });
  other.exec('BEGIN IMMEDIATE');
  const before = Date.now();
  const pending = discardUnlisted({ db: at.db, mediaDir: at.dir, folder: at.work });
  // Main went on at once (its usual wait for the lock is 5 s).
  expect(Date.now() - before).toBeLessThan(1000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(row(at.db, left.id)).toBeDefined();
  other.exec('ROLLBACK');
  expect(await pending).toBe(1);
  expect(row(at.db, left.id)).toBeUndefined();
  expect(existsSync(left.file)).toBe(false);
});

it('a work folder still held at the start (Windows) never stops Drashti starting', () => {
  const at = library();
  writeFileSync(join(at.work, '.held.mp4'), 'placeholder work file');
  removal.fails = ['video-combine-work'];
  const deps = (discard: CombineDeps['discardUnlisted']): CombineDeps => ({
    mediaDir: at.dir,
    workDir: at.work,
    row: () => null,
    conversions: {
      saveCopy: () => ({ id: 'none', done: new Promise<never>(() => undefined) }),
      cancelFile: () => false,
    },
    idle: () => true,
    importing: () => false,
    prepareImport: () => Promise.reject(new Error('Not used here.')),
    publishImport: () => Promise.resolve(false),
    discardUnlisted: discard,
    pickCopy: () => Promise.resolve(null),
  });
  expect(() => new CombineVideos(deps(() => Promise.resolve(0)))).not.toThrow();
  // Nor a removal that throws at once rather than failing its promise.
  removal.fails = [];
  expect(
    () =>
      new CombineVideos(
        deps(() => {
          throw new Error('The library is closed.');
        }),
      ),
  ).not.toThrow();
});

/*
 * a22-review-combine2 re-review: the start sweep removes nothing while an import or a deck's preparation goes (R-S1),
 * or while a video plays, the stream is on air or a recording goes on (R-S2): left for the next start. An import
 * starting while the sweep waits for the write lock stops it too.
 */
function sweeping(at: ReturnType<typeof library>, gate: { importing: boolean; idle: boolean }) {
  const asked: Promise<unknown>[] = [];
  const deps: CombineDeps = {
    mediaDir: at.dir,
    workDir: at.work,
    row: () => null,
    conversions: {
      saveCopy: () => ({ id: 'none', done: new Promise<never>(() => undefined) }),
      cancelFile: () => false,
    },
    idle: () => gate.idle,
    importing: () => gate.importing,
    prepareImport: () => Promise.reject(new Error('Not used here.')),
    publishImport: () => Promise.resolve(false),
    discardUnlisted: (made, keep, allowed) => {
      const removal = discardUnlisted({
        db: at.db,
        mediaDir: at.dir,
        ...made,
        keep: keep ?? null,
        ...(allowed ? { allowed } : {}),
      });
      asked.push(removal.catch(() => undefined));
      return removal;
    },
    pickCopy: () => Promise.resolve(null),
  };
  return { deps, asked };
}

it('an import going at the start leaves the sweep for the next start', async () => {
  const at = library();
  const left = leftover(at);
  const gate = { importing: true, idle: true };
  const first = sweeping(at, gate);
  new CombineVideos(first.deps).close();
  await Promise.all(first.asked);
  expect(row(at.db, left.id)).toBeDefined();
  expect(existsSync(left.file)).toBe(true);
  gate.importing = false;
  const next = sweeping(at, gate);
  new CombineVideos(next.deps).close();
  await Promise.all(next.asked);
  expect(row(at.db, left.id)).toBeUndefined();
  expect(existsSync(left.file)).toBe(false);
});

it('a video playing or the stream on air at the start leaves the sweep for the next start', async () => {
  const at = library();
  const left = leftover(at);
  const gate = { importing: false, idle: false };
  const first = sweeping(at, gate);
  new CombineVideos(first.deps).close();
  await Promise.all(first.asked);
  expect(row(at.db, left.id)).toBeDefined();
  expect(existsSync(left.file)).toBe(true);
});

it('an import starting while the sweep waits for the write lock stops the sweep', async () => {
  const at = library();
  const left = leftover(at);
  const other = openDatabase(join(at.dir, 'library.sqlite'));
  cleanup.push(() => {
    if (other.inTransaction) other.exec('ROLLBACK');
    other.close();
  });
  other.exec('BEGIN IMMEDIATE');
  const gate = { importing: false, idle: true };
  const first = sweeping(at, gate);
  const combines = new CombineVideos(first.deps);
  cleanup.push(() => {
    combines.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  gate.importing = true;
  other.exec('ROLLBACK');
  await Promise.all(first.asked);
  expect(row(at.db, left.id)).toBeDefined();
  expect(existsSync(left.file)).toBe(true);
});
