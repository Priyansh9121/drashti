import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type * as FsPromises from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LATEST_VERSION } from '../db/database';
import { SCHEDULED_FOLDER } from '../../shared/backups';
import { pooledBackup } from '../backup/pooled';
import { bytesHash, originalWorld } from '../import/testing/original-fixture';
import { backupLibrary, checkBackup } from './backup';

const filesystem = vi.hoisted(() => ({ unsupportedBelow: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    link: (...args: Parameters<typeof actual.link>) => {
      if (filesystem.unsupportedBelow && String(args[1]).startsWith(filesystem.unsupportedBelow))
        return Promise.reject(
          Object.assign(new Error('The generated USB filesystem cannot make hard links.'), {
            code: 'ENOTSUP',
          }),
        );
      return actual.link(...args);
    },
  };
});
afterEach(() => {
  filesystem.unsupportedBelow = '';
});
const options = () => ({
  mediaDir: null,
  app: '1.0.0',
  schema: LATEST_VERSION,
  now: new Date(2026, 10, 2, 8, 0),
});

describe('required original backup filesystem boundaries', () => {
  it('refuses an originals-only backup whose Media symlink leaves its selected backup folder', async () => {
    const w = originalWorld();
    try {
      await w.importPdf();
      const saved = await backupLibrary(w.db, w.drive, options());
      const outside = join(w.root, 'generated-outside-backup');
      mkdirSync(outside);
      const movedMedia = join(outside, 'Media');
      renameSync(join(saved.folder, 'Media'), movedMedia);
      symlinkSync(movedMedia, join(saved.folder, 'Media'), process.platform === 'win32' ? 'junction' : 'dir');
      const untouched = join(movedMedia, 'Placeholder outside sentinel.bin');
      writeFileSync(untouched, 'generated outside bytes');
      expect(bytesHash(readFileSync(join(movedMedia, w.originalRelative)))).toBe(w.hash);
      expect(checkBackup(saved.folder, LATEST_VERSION)).toMatchObject({ ok: false, code: 'unfinished' });
      expect(readFileSync(untouched, 'utf8')).toBe('generated outside bytes');
    } finally {
      w.clean();
    }
  });

  it('backs up required originals on a generated USB filesystem that refuses hard-link publication', async () => {
    const w = originalWorld();
    try {
      await w.importPdf();
      expect(bytesHash(readFileSync(w.owned))).toBe(w.hash);
      filesystem.unsupportedBelow = w.drive;
      const saved = await backupLibrary(w.db, w.drive, options());
      expect(existsSync(join(saved.folder, 'backup.json'))).toBe(true);
      expect(checkBackup(saved.folder, LATEST_VERSION)).toMatchObject({ ok: true, media: false });
      expect(bytesHash(readFileSync(join(saved.folder, 'Media', w.originalRelative)))).toBe(w.hash);
      expect(readFileSync(w.owned)).toEqual(w.bytes);
    } finally {
      w.clean();
    }
  });
  it('cancels a pooled backup at its final media progress even when its required original is already in the pool', async () => {
    const w = originalWorld();
    try {
      await w.importPdf();
      const pooledOptions = (day: number) => ({
        dbFile: w.dbFile,
        mediaDir: w.mediaDir,
        root: w.drive,
        keep: 3,
        app: '1.0.0',
        schema: LATEST_VERSION,
        now: new Date(2026, 10, day, 8, 0),
        reserveBytes: 0,
      });
      const baseHooks = {
        gate: () => Promise.resolve(),
        throttle: () => Promise.resolve(),
        progress: () => undefined,
        cancelled: () => false,
        freeBytes: () => 1024 ** 4,
      };
      const first = await pooledBackup(pooledOptions(2), baseHooks);
      const scheduled = join(w.drive, SCHEDULED_FOLDER);
      const before = readdirSync(scheduled).sort();
      expect(bytesHash(readFileSync(join(scheduled, 'Media', w.originalRelative)))).toBe(w.hash);
      let cancelled = false;
      let finalProgressSeen = false;
      const pending = pooledBackup(pooledOptions(3), {
        ...baseHooks,
        cancelled: () => cancelled,
        progress: (done, total) => {
          // No new bytes need copying: this existing public hook is the deterministic boundary before
          // required-original verification/marker publication. No sleeps or mocked backup internals.
          if (done === total) {
            finalProgressSeen = true;
            cancelled = true;
          }
        },
      });
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      expect(finalProgressSeen).toBe(true);
      // Only the first completed backup and shared pool remain: no second note, manifest or unfinished folder.
      expect(readdirSync(scheduled).sort()).toEqual(before);
      expect(checkBackup(join(scheduled, first.folder), LATEST_VERSION)).toMatchObject({ ok: true });
      expect(bytesHash(readFileSync(join(scheduled, 'Media', w.originalRelative)))).toBe(w.hash);
    } finally {
      w.clean();
    }
  });
});
