import { expect, it } from 'vitest';
import { openDatabase } from './database';
import { migrate, MIGRATIONS, schemaVersion } from './migrate';
it('raises the database floor for PDF page crop JSON without rewriting source rows', () => {
  const db = openDatabase(
    ':memory:',
    MIGRATIONS.filter((m) => m.version <= 91),
  );
  try {
    db.exec('CREATE TABLE generated_crop_fixture (document_page TEXT)');
    const value = JSON.stringify({
      sha256: 'a'.repeat(64),
      ext: 'pdf',
      page: 0,
      crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
    });
    db.prepare('INSERT INTO generated_crop_fixture VALUES (?)').run(value);
    expect(MIGRATIONS.some((m) => m.version > 91 && m.name === 'PDF page crops')).toBe(true);
    migrate(db);
    expect(schemaVersion(db)).toBeGreaterThan(91);
    expect(db.prepare('SELECT document_page FROM generated_crop_fixture').pluck().get()).toBe(value);
  } finally {
    db.close();
  }
});
