import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LIBRARY_BUSY_TIMEOUT_MS, openDatabase } from '../db/database';
import { sourceWrite } from './source-write';

describe('prepared-source hidden-media writes', () => {
  it('lets Main timers run while another library writer holds the lock, then commits one bounded batch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-source-write-'));
    const file = join(root, 'placeholder.sqlite');
    const main = openDatabase(file),
      importer = openDatabase(file);
    let timer: ReturnType<typeof setInterval> | undefined;
    let release: ReturnType<typeof setTimeout> | undefined;
    try {
      main.exec('CREATE TABLE placeholder_source_write(value INTEGER)');
      importer.exec('BEGIN IMMEDIATE');
      let ticks = 0;
      const done = vi.fn();
      const giveWay = vi.fn(() => ({ ready: Promise.resolve(), done }));
      timer = setInterval(() => {
        ticks++;
      }, 2);
      release = setTimeout(() => importer.exec('ROLLBACK'), 20);
      const insert = vi.fn(() => main.prepare('INSERT INTO placeholder_source_write VALUES (7)').run());
      await sourceWrite(main, giveWay)({ signal: new AbortController().signal, allowed: () => true }, insert);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(main.prepare('SELECT value FROM placeholder_source_write').pluck().get()).toBe(7);
      expect(ticks, 'Main timers must not wait inside the synchronous SQLite busy timeout').toBeGreaterThan(
        0,
      );
      expect(giveWay).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledTimes(1);
      expect(main.pragma('busy_timeout', { simple: true })).toBe(LIBRARY_BUSY_TIMEOUT_MS);
    } finally {
      if (timer) clearInterval(timer);
      if (release) clearTimeout(release);
      if (importer.inTransaction) importer.exec('ROLLBACK');
      importer.close();
      main.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a revoked guard before any callback runs and restores admission after cancellation', async () => {
    const db = openDatabase(':memory:');
    try {
      const write = vi.fn(() => 1);
      await expect(
        sourceWrite(db)({ signal: new AbortController().signal, allowed: () => false }, write),
      ).rejects.toThrow(/no longer allowed/u);
      expect(write).not.toHaveBeenCalled();
      expect(db.inTransaction).toBe(false);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(LIBRARY_BUSY_TIMEOUT_MS);
    } finally {
      db.close();
    }
  });
});
