import { expect, it } from 'vitest';
import { NO_COUNTS } from '../../shared/import';
import { openDatabase } from './database';
import { ImportRepo } from './imports';
import { migrate, MIGRATIONS, schemaVersion } from './migrate';

it('upgrades schema 82 reports without losing their rows, issues, order or references', () => {
  const db = openDatabase(
    ':memory:',
    MIGRATIONS.filter((m) => m.version <= 82),
  );
  try {
    const repo = new ImportRepo(db);
    repo.startRun('placeholder-run', ['Placeholder.txt'], {});
    repo.addItem('placeholder-run', 0, {
      sourcePath: 'Placeholder.txt',
      format: 'text',
      outcome: 'failed',
      name: 'Placeholder',
      target: null,
      counts: { ...NO_COUNTS },
      message: 'Placeholder failure',
      issues: [{ severity: 'warning', code: 'placeholder', message: 'Placeholder issue', fix: null }],
    });
    const before = repo.report('placeholder-run');
    const rowid = db.prepare('SELECT rowid FROM import_items').pluck().get();
    migrate(db);
    expect(schemaVersion(db)).toBeGreaterThan(82);
    expect(repo.report('placeholder-run')).toEqual(before);
    expect(db.prepare('SELECT rowid FROM import_items').pluck().get()).toBe(rowid);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(() =>
      repo.addItem('placeholder-run', 1, {
        sourcePath: 'Placeholder.drashti-kirtans',
        format: 'kirtan-bundle',
        outcome: 'imported',
        name: 'Placeholder bundle',
        target: null,
        counts: { ...NO_COUNTS },
        message: null,
        issues: [],
      }),
    ).not.toThrow();
    expect(repo.report('placeholder-run')?.items).toHaveLength(2);
  } finally {
    db.close();
  }
});
