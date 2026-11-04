import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEDULED_FOLDER } from '../../shared/backups';
import { pooledBackup } from '../backup/pooled';
import { LATEST_VERSION, openDatabase } from '../db/database';
import { bytesHash, originalWorld } from '../import/testing/original-fixture';
import {
  applyPendingRestore,
  backupLibrary,
  LIBRARY_FILE,
  readManifest,
  requestRestore,
  rollBackRestore,
} from './backup';

const options = (mediaDir: string | null) => ({
  mediaDir,
  app: '1.0.0',
  schema: LATEST_VERSION,
  now: new Date(2026, 10, 2, 8, 0),
});
const hashInLibrary = (file: string, id: string) => {
  const db = openDatabase(file);
  try {
    return db.prepare('SELECT source_hash FROM presentations WHERE id = ?').pluck().get(id);
  } finally {
    db.close();
  }
};
const restoreOptions = () => ({ app: '1.0.0', schema: LATEST_VERSION, now: options(null).now });

/* Original paths follow the provisional Media/Originals/hash fixture convention in original-fixture.ts. */
describe('required original bytes in backups', () => {
  it('includes originals in a library-only backup and restores them without the external source or optional media', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      expect(imported.summary.totals).toMatchObject({ imported: 1, failed: 0 });
      w.arrangeOwnedBytes(); // Separate this backup failure from the importer-retention failure.
      expect(bytesHash(readFileSync(w.owned))).toBe(w.hash);
      const displayFiles = w.db.prepare("SELECT path FROM media WHERE path <> ''").pluck().all() as string[];
      expect(displayFiles).toHaveLength(1); // The real imported page PNG is optional display media.
      const optional = 'Placeholder optional picture.bin';
      writeFileSync(join(w.mediaDir, optional), Buffer.alloc(37, 4));
      const saved = await backupLibrary(w.db, w.drive, options(null));
      expect(hashInLibrary(join(saved.folder, LIBRARY_FILE), imported.id)).toBe(w.hash);
      const backedOriginal = join(saved.folder, 'Media', w.originalRelative);
      expect(existsSync(backedOriginal)).toBe(true);
      expect(bytesHash(readFileSync(backedOriginal))).toBe(w.hash);
      expect(existsSync(join(saved.folder, 'Media', optional))).toBe(false);
      for (const file of displayFiles) expect(existsSync(join(saved.folder, 'Media', file))).toBe(false);
      rmSync(w.source);
      const target = join(w.root, 'restored-library-only');
      mkdirSync(target);
      requestRestore(target, saved.folder);
      expect(applyPendingRestore(target, restoreOptions())).toMatchObject({ restored: true });
      expect(hashInLibrary(join(target, LIBRARY_FILE), imported.id)).toBe(w.hash);
      expect(bytesHash(readFileSync(join(target, 'Media', w.originalRelative)))).toBe(w.hash);
      expect(existsSync(join(target, 'Media', optional))).toBe(false);
      for (const file of displayFiles) expect(existsSync(join(target, 'Media', file))).toBe(false);
    } finally {
      w.clean();
    }
  });

  it('keeps original bytes for a document committed at the existing gate before the pooled DB snapshot', async () => {
    const w = originalWorld();
    try {
      // The first gate is after the current file list and before the DB snapshot. No timer race or backup mock.
      let id = '';
      let inserted = false;
      const made = await pooledBackup(
        {
          dbFile: w.dbFile,
          mediaDir: w.mediaDir,
          root: w.drive,
          keep: 2,
          app: '1.0.0',
          schema: LATEST_VERSION,
          now: options(null).now,
          reserveBytes: 0,
        },
        {
          gate: async () => {
            if (inserted) return;
            inserted = true;
            const imported = await w.importPdf();
            expect(imported.summary.totals).toMatchObject({ imported: 1, failed: 0 });
            id = imported.id;
            w.arrangeOwnedBytes();
            expect(bytesHash(readFileSync(w.owned))).toBe(w.hash);
            rmSync(w.source); // No generated external-file fallback can rescue the restored backup.
          },
          throttle: () => Promise.resolve(),
          progress: () => undefined,
          cancelled: () => false,
          freeBytes: () => 1024 ** 4,
        },
      );
      expect(inserted).toBe(true);
      expect(id).not.toBe('');
      const folder = join(w.drive, SCHEDULED_FOLDER, made.folder);
      // Prove the real migrated snapshot contains this document before checking its required source bytes.
      expect(hashInLibrary(join(folder, LIBRARY_FILE), id)).toBe(w.hash);
      // Old behavior lists [], then the gate imports, then the snapshot keeps its row but the manifest omits it.
      expect(readManifest(folder)).toContain(w.originalManifestPath);
      const poolOriginal = join(w.drive, SCHEDULED_FOLDER, 'Media', w.originalRelative);
      expect(bytesHash(readFileSync(poolOriginal))).toBe(w.hash);
      const target = join(w.root, 'restored-pooled');
      mkdirSync(target);
      requestRestore(target, folder);
      expect(applyPendingRestore(target, restoreOptions())).toMatchObject({ restored: true });
      expect(hashInLibrary(join(target, LIBRARY_FILE), id)).toBe(w.hash);
      expect(bytesHash(readFileSync(join(target, 'Media', w.originalRelative)))).toBe(w.hash);
    } finally {
      w.clean();
    }
  });
  it('merges originals-only restore into existing optional Media and preserves it through rollback', async () => {
    const w = originalWorld();
    try {
      await w.importPdf();
      w.arrangeOwnedBytes();
      const saved = await backupLibrary(w.db, w.drive, options(w.mediaDir));
      const noteFile = join(saved.folder, 'backup.json');
      const note = JSON.parse(readFileSync(noteFile, 'utf8')) as Record<string, unknown>;
      writeFileSync(
        noteFile,
        JSON.stringify({
          ...note,
          media: false,
          originals: { version: 1, files: [{ sha256: w.hash, ext: 'pdf', bytes: w.bytes.length }] },
        }),
      );
      const target = join(w.root, 'populated-restore');
      mkdirSync(join(target, 'Media'), { recursive: true });
      const current = openDatabase(join(target, LIBRARY_FILE));
      current.close();
      const optional = join(target, 'Media', 'Placeholder current picture.bin');
      const unchanged = Buffer.from('generated optional bytes');
      writeFileSync(optional, unchanged);
      requestRestore(target, saved.folder);
      const restored = applyPendingRestore(target, restoreOptions());
      expect(restored).toMatchObject({ restored: true, media: false });
      expect(existsSync(optional)).toBe(true);
      expect(readFileSync(optional)).toEqual(unchanged);
      expect(bytesHash(readFileSync(join(target, 'Media', w.originalRelative)))).toBe(w.hash);
      if (!restored.restored) throw new Error('The generated original backup was not restored.');
      expect(rollBackRestore(target, restored.keptIn, { now: options(null).now })).toMatchObject({
        ok: true,
      });
      expect(readFileSync(optional)).toEqual(unchanged);
    } finally {
      w.clean();
    }
  });
});
