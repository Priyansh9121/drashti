import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { whenFree, writeLockFree } from './write-lock';

describe('the write lock, looked at without waiting (Session 16)', () => {
  it('is free unless another connection holds it, and looking never waits or takes it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'drashti-lock-')), 'drashti.sqlite');
    const main = openDatabase(file);
    const importer = openDatabase(file);
    expect(writeLockFree(main, 5000)).toBe(true);
    importer.exec('BEGIN IMMEDIATE');
    const t = performance.now();
    expect(writeLockFree(main, 5000)).toBe(false);
    expect(performance.now() - t).toBeLessThan(100);
    importer.exec('COMMIT');
    expect(writeLockFree(main, 5000)).toBe(true);
    // Its own wait for the lock is as it was.
    expect(main.pragma('busy_timeout', { simple: true })).toBe(5000);
    // Looking did not leave it holding the lock: the other connection can write.
    importer.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('looked', '1')").run();
    main.close();
    importer.close();
  });

  it('resolves when the lock is seen free, or when the import has given way, whichever is first', async () => {
    let free = false;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((r) => (resolveReady = r));
    const looking = whenFree(() => free, ready, 1);
    await new Promise((r) => setTimeout(r, 10));
    free = true;
    expect(await looking).toBe('free');
    resolveReady();
    const given = whenFree(() => false, Promise.resolve(), 1);
    expect(await given).toBe('ready');
  });
});
