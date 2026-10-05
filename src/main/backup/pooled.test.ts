import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEDULED_FOLDER } from '../../shared/backups';
import { applyPendingRestore, checkBackup, requestRestore } from '../library/backup';
import type { PooledHooks } from './pooled';
import { MARKER, pooledBackup } from './pooled';

/* Scheduled backups into a shared media folder: made, kept, pruned, restored (made-up files only). */

function world() {
  const base = mkdtempSync(join(tmpdir(), 'drashti-pooled-'));
  const userData = join(base, 'userData');
  const mediaDir = join(userData, 'Media');
  const drive = join(base, 'drive');
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(drive);
  const dbFile = join(userData, 'drashti.sqlite');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE things (name TEXT)');
  db.pragma('user_version = 5');
  const add = (name: string) => db.prepare('INSERT INTO things VALUES (?)').run(name);
  const media = (name: string, bytes: number) =>
    writeFileSync(join(mediaDir, name), Buffer.alloc(bytes, name.length));
  return { base, userData, mediaDir, drive, dbFile, db, add, media };
}

const hooks = (over: Partial<PooledHooks> = {}): PooledHooks => ({
  gate: () => Promise.resolve(),
  throttle: () => Promise.resolve(),
  progress: () => undefined,
  cancelled: () => false,
  freeBytes: () => 100 * 1024 ** 3,
  ...over,
});

const at = (day: number) => new Date(Date.UTC(2026, 9, day, 21, 0));

describe('scheduled backups into a shared media folder', () => {
  it('copy each media file once, list what each needs, keep the newest, and leave everything else alone', async () => {
    const w = world();
    w.media('a1.png', 1000);
    w.media('b2.mp4', 5000);
    w.add('first');
    const run = (day: number, keep = 2) =>
      pooledBackup(
        {
          dbFile: w.dbFile,
          mediaDir: w.mediaDir,
          root: w.drive,
          keep,
          app: '1.0',
          schema: 5,
          now: at(day),
          reserveBytes: 0,
        },
        hooks(),
      );
    const one = await run(1);
    expect(one).toMatchObject({ copied: 2, files: 2, removed: 0 });
    const scheduled = join(w.drive, SCHEDULED_FOLDER);
    const pool = join(scheduled, 'Media');
    const inode = statSync(join(pool, 'b2.mp4')).ino;
    // Something of the admin's own beside it: never touched.
    writeFileSync(join(scheduled, 'Notes of the admin.txt'), 'placeholder');
    mkdirSync(join(scheduled, 'Old hand backup'));
    // The next one copies only what is new.
    w.media('c3.jpg', 300);
    w.add('second');
    const two = await run(2);
    expect(two).toMatchObject({ copied: 1, files: 3 });
    expect(statSync(join(pool, 'b2.mp4')).ino).toBe(inode);
    // A file gone from the library stays while a kept backup lists it...
    const { rmSync } = await import('node:fs');
    rmSync(join(w.mediaDir, 'a1.png'));
    const three = await run(3);
    expect(existsSync(join(pool, 'a1.png'))).toBe(true);
    // ...and goes once none does (keep 2: the first two are gone now).
    const four = await run(4);
    expect(four.removed).toBe(1);
    expect(existsSync(join(pool, 'a1.png'))).toBe(false);
    expect(existsSync(join(pool, 'b2.mp4'))).toBe(true);
    const folders = readdirSync(scheduled).sort();
    expect(folders).toEqual(
      [three.folder, four.folder, 'Media', 'Notes of the admin.txt', 'Old hand backup'].sort(),
    );
    expect(four.folder).toMatch(/^Drashti backup \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/u);
    const newest = join(scheduled, four.folder);
    expect(readdirSync(newest).sort()).toEqual([MARKER, 'backup.json', 'drashti.sqlite', 'media.json']);
    expect(JSON.parse(readFileSync(join(newest, 'media.json'), 'utf8'))).toEqual({
      files: ['b2.mp4', 'c3.jpg'],
    });
  });

  it('restore like a backup made by hand, the media from the shared folder', async () => {
    const w = world();
    w.media('a1.png', 1000);
    w.add('kept');
    const made = await pooledBackup(
      {
        dbFile: w.dbFile,
        mediaDir: w.mediaDir,
        root: w.drive,
        keep: 3,
        app: '1.0',
        schema: 5,
        now: at(1),
        reserveBytes: 0,
      },
      hooks(),
    );
    const folder = join(w.drive, SCHEDULED_FOLDER, made.folder);
    const check = checkBackup(folder, 5);
    expect(check).toMatchObject({ ok: true, media: true });
    w.add('after the backup');
    w.db.close();
    requestRestore(w.userData, folder);
    const restored = applyPendingRestore(w.userData, { schema: 5, app: '1.0', now: at(2) });
    expect(restored).toMatchObject({ restored: true, media: true });
    const back = new Database(w.dbFile, { readonly: true });
    expect(back.prepare('SELECT name FROM things').pluck().all()).toEqual(['kept']);
    back.close();
    expect(readFileSync(join(w.mediaDir, 'a1.png')).length).toBe(1000);
    // A pool missing a listed file is refused before anything changes.
    const { rmSync } = await import('node:fs');
    rmSync(join(w.drive, SCHEDULED_FOLDER, 'Media', 'a1.png'));
    expect(checkBackup(folder, 5)).toMatchObject({ ok: false, code: 'unfinished' });
  });

  it('stop cleanly: no room, the folder gone, or cancelled; nothing half-made is left', async () => {
    const w = world();
    w.media('a1.png', 4000);
    const options = {
      dbFile: w.dbFile,
      mediaDir: w.mediaDir,
      root: w.drive,
      keep: 3,
      app: '1.0',
      schema: 5,
      now: at(1),
      reserveBytes: 0,
    };
    await expect(pooledBackup(options, hooks({ freeBytes: () => 1000 }))).rejects.toMatchObject({
      code: 'no-room',
    });
    await expect(
      pooledBackup({ ...options, root: join(w.drive, 'unplugged') }, hooks()),
    ).rejects.toMatchObject({
      code: 'no-folder',
    });
    let checks = 0;
    await expect(pooledBackup(options, hooks({ cancelled: () => ++checks > 1 }))).rejects.toMatchObject({
      code: 'cancelled',
    });
    const scheduled = join(w.drive, SCHEDULED_FOLDER);
    expect(readdirSync(scheduled).filter((n) => n !== 'Media')).toEqual([]);
    // A folder cut short by a stop (marker, no note) is cleared by the next backup.
    mkdirSync(join(scheduled, 'Drashti backup 2026-09-30 21-00'));
    writeFileSync(join(scheduled, 'Drashti backup 2026-09-30 21-00', MARKER), '{}');
    const ok = await pooledBackup(options, hooks());
    expect(ok.removed).toBe(1);
    expect(readdirSync(scheduled).filter((n) => n !== 'Media')).toEqual([ok.folder]);
  });

  it('wait at the gate while told to, and keep to the speed it is given', async () => {
    const w = world();
    w.media('a1.png', 3000);
    let open = false;
    let waited = 0;
    let throttled = 0;
    const done = pooledBackup(
      {
        dbFile: w.dbFile,
        mediaDir: w.mediaDir,
        root: w.drive,
        keep: 3,
        app: '1.0',
        schema: 5,
        now: at(1),
        reserveBytes: 0,
      },
      hooks({
        gate: async () => {
          while (!open) {
            waited++;
            await new Promise((r) => setTimeout(r, 5));
          }
        },
        throttle: (n) => {
          throttled += n;
          return Promise.resolve();
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(w.drive, SCHEDULED_FOLDER, 'Media', 'a1.png'))).toBe(false);
    open = true;
    await done;
    expect(waited).toBeGreaterThan(1);
    expect(throttled).toBe(3000);
  });
});
