import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import { BatchWriter } from './batch';

function setup() {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO libraries (id, name) VALUES ('lib', 'Default')").run();
  let clock = 0;
  const batch = new BatchWriter(db, { budgetMs: 250, now: () => clock });
  const insert =
    (name: string, library = 'lib') =>
    () =>
      db
        .prepare('INSERT INTO presentations (id, library_id, name) VALUES (?, ?, ?)')
        .run(name, library, name);
  const names = () =>
    (db.prepare('SELECT name FROM presentations ORDER BY name').all() as { name: string }[]).map(
      (r) => r.name,
    );
  return {
    db,
    batch,
    insert,
    names,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe('BatchWriter', () => {
  it('writes items into one transaction and commits when the group has been open for its budget', () => {
    const { db, batch, insert, names, tick } = setup();
    const committed = vi.fn();
    batch.write(insert('a'), { committed });
    tick(100);
    batch.maybeCommit();
    batch.write(insert('b'), { committed });
    expect(db.inTransaction).toBe(true);
    expect(committed).not.toHaveBeenCalled();
    tick(200);
    batch.maybeCommit();
    expect(db.inTransaction).toBe(false);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(names()).toEqual(['a', 'b']);
  });

  it('rolls back an item that fails on its own, keeping the rest of the group', () => {
    const { batch, insert, names } = setup();
    const failed = vi.fn();
    batch.write(insert('a'));
    const result = batch.write(
      (): string => {
        insert('half')();
        throw new Error('bad file');
      },
      { failed },
    );
    batch.write(insert('c'));
    batch.commit();
    expect(result).toBeUndefined();
    expect(failed).toHaveBeenCalledWith(new Error('bad file'));
    expect(names()).toEqual(['a', 'c']);
  });

  it('when the commit fails, writes each item again on its own, so one bad item loses only itself', () => {
    const { db, batch, insert, names } = setup();
    // A foreign key checked only at commit makes the commit itself fail.
    db.pragma('defer_foreign_keys = ON');
    const committed = vi.fn();
    const failed = vi.fn();
    batch.write(insert('a'), { committed, failed });
    batch.write(insert('orphan', 'no-such-library'), { committed, failed });
    batch.write(insert('c'), { committed, failed });
    batch.commit();
    expect(names()).toEqual(['a', 'c']);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(db.inTransaction).toBe(false);
  });

  it('commits failure records written during the retries too', () => {
    const { db, batch, insert, names } = setup();
    db.pragma('defer_foreign_keys = ON');
    batch.write(insert('orphan', 'no-such-library'), {
      failed: () => batch.write(insert('failure noted')),
    });
    batch.commit();
    expect(names()).toEqual(['failure noted']);
    expect(db.inTransaction).toBe(false);
  });

  it('holds the write lock from the start of a group, so another connection writing then cannot fail an item', () => {
    // The import worker and the main process share the library file. An item reads first (is this file
    // here already?) and then writes; had another connection committed in between, a group begun as
    // a reader could not become a writer (SQLITE_BUSY_SNAPSHOT, which no busy timeout waits out).
    const dir = mkdtempSync(join(tmpdir(), 'drashti-batch-'));
    const file = join(dir, 'library.sqlite');
    const db = openDatabase(file);
    db.prepare("INSERT INTO libraries (id, name) VALUES ('lib', 'Default')").run();
    const other = new Database(file);
    other.pragma('busy_timeout = 0');
    const batch = new BatchWriter(db, { budgetMs: 250, now: () => 0 });
    const failed = vi.fn();
    let otherWrote = 'not tried';
    batch.write(
      () => {
        db.prepare('SELECT COUNT(*) FROM presentations').get();
        // The main process writes now (as the stream's settings did at start).
        try {
          other.prepare("INSERT INTO app_meta (key, value) VALUES ('elsewhere', '1')").run();
          otherWrote = 'wrote';
        } catch (error) {
          otherWrote = (error as { code?: string }).code ?? 'failed';
        }
        db.prepare(
          "INSERT INTO presentations (id, library_id, name) VALUES ('p', 'lib', 'Placeholder')",
        ).run();
      },
      { failed },
    );
    batch.commit();
    expect(failed).not.toHaveBeenCalled();
    // The other connection had to wait for the group (here it does not wait, so it is told it is busy).
    expect(otherWrote).toBe('SQLITE_BUSY');
    expect(db.prepare('SELECT name FROM presentations').pluck().all()).toEqual(['Placeholder']);
    other.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does nothing when there is nothing to commit', () => {
    const { db, batch } = setup();
    batch.commit();
    batch.maybeCommit();
    expect(db.inTransaction).toBe(false);
    expect(batch.isOpen).toBe(false);
  });
});
