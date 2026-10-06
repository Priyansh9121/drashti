import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from './database';
import { LaterWrites } from './later-writes';
import { SettingsRepo } from './settings';

/*
 * The main process's own bookkeeping never waits for the import worker's
 * write lock (Session 15): two connections to one library, the second
 * holding the lock as an import's group does.
 */

describe('later writes', () => {
  const open: Db[] = [];
  afterEach(() => {
    for (const db of open.splice(0)) db.close();
  });

  const setup = () => {
    const file = join(mkdtempSync(join(tmpdir(), 'drashti-later-')), 'drashti.sqlite');
    const main = openDatabase(file);
    const importer = new Database(file);
    importer.pragma('busy_timeout = 5000');
    open.push(main, importer);
    const jobs: (() => void)[] = [];
    const warnings: string[] = [];
    const later = new LaterWrites(main, {
      busyTimeoutMs: 5000,
      schedule: (run) => jobs.push(run),
      warn: (m) => warnings.push(m),
    });
    const runJobs = () => {
      for (const job of jobs.splice(0)) job();
    };
    return { main, importer, later, settings: new SettingsRepo(main), runJobs, jobs, warnings };
  };

  it('write at once while the library is free', () => {
    const { later, settings, jobs } = setup();
    later.write('setting:a', () => {
      settings.set('a', 1);
    });
    expect(settings.get('a')).toBe(1);
    expect(later.pending).toBe(0);
    expect(jobs).toHaveLength(0);
  });

  it('never wait while an import holds the write lock, and write once it lets go', () => {
    const { main, importer, later, settings, runJobs } = setup();
    importer.prepare('BEGIN IMMEDIATE').run();
    const started = performance.now();
    later.write('setting:a', () => {
      settings.set('a', 'played');
    });
    // Not the five seconds the connection would otherwise wait.
    expect(performance.now() - started).toBeLessThan(200);
    expect(later.pending).toBe(1);
    expect(settings.get('a')).toBeUndefined();
    // Still busy: it waits on.
    runJobs();
    expect(later.pending).toBe(1);
    importer.prepare('COMMIT').run();
    runJobs();
    expect(later.pending).toBe(0);
    expect(settings.get('a')).toBe('played');
    // The connection's own wait is as it was.
    expect(main.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('let a newer write for the same thing replace one still waiting, keeping the others in order', () => {
    const { importer, later, settings, runJobs } = setup();
    importer.prepare('BEGIN IMMEDIATE').run();
    const order: string[] = [];
    // Each notes itself once written (a try the library was too busy for throws first).
    later.write('setting:a', () => {
      settings.set('a', 1);
      order.push('a1');
    });
    later.write('setting:b', () => {
      settings.set('b', 1);
      order.push('b');
    });
    later.write('setting:a', () => {
      settings.set('a', 2);
      order.push('a2');
    });
    importer.prepare('COMMIT').run();
    runJobs();
    expect(order).toEqual(['b', 'a2']);
    expect(settings.get('a')).toBe(2);
  });

  it('drop a write that fails for another reason, saying so', () => {
    const { later, warnings } = setup();
    later.write('broken', () => {
      throw new Error('no such column');
    });
    expect(later.pending).toBe(0);
    expect(warnings[0]).toContain('no such column');
  });

  it('write whatever still waits when Drashti quits', () => {
    const { importer, later, settings } = setup();
    importer.prepare('BEGIN IMMEDIATE').run();
    later.write('setting:a', () => {
      settings.set('a', 'at quit');
    });
    importer.prepare('COMMIT').run();
    later.flush();
    expect(settings.get('a')).toBe('at quit');
  });
});
