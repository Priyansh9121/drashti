import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';

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
