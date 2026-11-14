import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, leaveCopyingToImports, openDatabase } from './database';

/*
 * The library file has two writers: the main process and the import
 * worker. A transaction takes the write lock at its start, so one that
 * reads and then writes cannot be failed by the other writing in between.
 */

let dir = '';
const open: Db[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function twoConnections(): { db: Db; other: Db } {
  dir = mkdtempSync(join(tmpdir(), 'drashti-db-'));
  const file = join(dir, 'drashti.sqlite');
  const db = openDatabase(file);
  const other = openDatabase(file);
  other.pragma('busy_timeout = 0');
  open.push(db, other);
  return { db, other };
}

describe('transactions on the library', () => {
  it('hold the write lock from their start: another connection waits, and the read-then-write goes through', () => {
    const { db, other } = twoConnections();
    let otherWrote = 'not tried';
    const changed = db.transaction(() => {
      const before = db.prepare('SELECT COUNT(*) FROM app_meta').pluck().get() as number;
      try {
        other.prepare("INSERT INTO app_meta (key, value) VALUES ('elsewhere', '1')").run();
        otherWrote = 'wrote';
      } catch (error) {
        otherWrote = (error as { code?: string }).code ?? 'failed';
      }
      db.prepare("INSERT INTO app_meta (key, value) VALUES ('here', '1')").run();
      return before;
    })();
    expect(typeof changed).toBe('number');
    expect(otherWrote).toBe('SQLITE_BUSY');
    expect(other.prepare("SELECT value FROM app_meta WHERE key = 'here'").pluck().get()).toBe('1');
  });

  it('nest as before: an inner one that fails is rolled back alone', () => {
    const { db } = twoConnections();
    db.transaction(() => {
      db.prepare("INSERT INTO app_meta (key, value) VALUES ('outer', '1')").run();
      expect(() => {
        db.transaction(() => {
          db.prepare("INSERT INTO app_meta (key, value) VALUES ('inner', '1')").run();
          throw new Error('inner fails');
        })();
      }).toThrow('inner fails');
    })();
    const keys = db.prepare("SELECT key FROM app_meta WHERE key IN ('outer', 'inner')").pluck().all();
    expect(keys).toEqual(['outer']);
  });
});

/*
 * SQLite copies the WAL into the library file in whichever connection's commit finds it past CHECKPOINT_PAGES pages
 * (Session 58): during an import that was the main process's next write, copying the import's pages and waiting for the
 * disk on the main thread. While an import runs, its own connection copies them, in its process.
 */
describe('copying the WAL into the library file (Session 58)', () => {
  /** The import's connection writes about 12 MB, leaving it in the WAL (its own copy not made yet). */
  function importWrites(importer: Db): void {
    importer.pragma('wal_autocheckpoint = 0');
    const put = importer.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)');
    importer.transaction(() => {
      for (let i = 0; i < 3000; i++) put.run(`placeholder-${String(i)}`, 'x'.repeat(4000));
    })();
  }

  it('while an import runs, a write of the main process copies none of the import’s pages into the library file; once it has ended, its commits copy as SQLite does by itself', () => {
    const { db, other } = twoConnections();
    const file = db.name;
    const copyHere = leaveCopyingToImports(db);
    copyHere(true);
    const before = statSync(file).size;
    importWrites(other);
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('placeholder-mode', 'pro')").run();
    expect(statSync(file).size, 'the library file after a write of the main process during the import').toBe(
      before,
    );
    copyHere(false);
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('placeholder-mode', 'simple')").run();
    expect(statSync(file).size, 'the library file after one once it has ended').toBeGreaterThan(before);
    // Nothing lost either way: every row is there.
    expect(db.prepare("SELECT COUNT(*) FROM app_meta WHERE key LIKE 'placeholder-%'").pluck().get()).toBe(
      3001,
    );
  });

  it('a library already closed (quitting) is left as it is', () => {
    const { db } = twoConnections();
    db.close();
    open.splice(open.indexOf(db), 1);
    expect(() => {
      leaveCopyingToImports(db)(false);
    }).not.toThrow();
  });
});
