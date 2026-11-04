import type { MessageBoxOptions } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEDULED_FOLDER } from '../../shared/backups';
import { formatBytes } from '../../shared/format';
import type { EditSlidesResult } from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { pooledBackup } from '../backup/pooled';
import { LATEST_VERSION, openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { sourceWrite } from '../documents/source-write';
import { makeTestPdf } from '../import/testing/make-pdf';
import { nativeSourceReader } from '../import/testing/native-source-reader';
import { bytesHash, originalWorld } from '../import/testing/original-fixture';
import {
  applyPendingRestore,
  backupLibrary,
  checkBackup,
  LIBRARY_FILE,
  readManifest,
  readNote,
  requestRestore,
  rollBackRestore,
  sameDisk,
} from './backup';
import { backUp, type BackupUi } from './backup-ui';
import { Revisions } from './revisions';
import { registerSlidesIpc } from './slides-ipc';
import { themeLook } from './themes';

/* File > Back Up Library…'s questions, answered here: the folder, then the first button, the media as ticked. */
const dialogs = vi.hoisted(() => ({
  folder: '',
  media: false,
  boxes: [] as { message?: string; detail?: string; checkboxLabel?: string }[],
}));
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [dialogs.folder] }),
    showMessageBox: (...args: unknown[]) => {
      dialogs.boxes.push(args.at(-1) as MessageBoxOptions);
      return Promise.resolve({ response: 0, checkboxChecked: dialogs.media });
    },
  },
}));
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
}));
beforeEach(() => {
  handlers.clear();
  dialogs.boxes = [];
});

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

type World = ReturnType<typeof originalWorld>;
/** A second generated PDF imported beside the fixture's, with a retained original of its own. */
async function importSecond(w: World) {
  const bytes = makeTestPdf([
    { width: 960, height: 540, color: [138, 58, 30], text: 'Placeholder second words' },
  ]);
  const hash = bytesHash(bytes);
  const file = join(w.externalDir, 'Placeholder second.pdf');
  writeFileSync(file, bytes);
  const summary = await w.runPdf({ paths: [file] });
  expect(summary.totals).toMatchObject({ imported: 1, failed: 0 });
  const relative = join('Originals', hash.slice(0, 2), `${hash}.pdf`);
  expect(bytesHash(readFileSync(join(w.mediaDir, relative)))).toBe(hash);
  return { bytes, hash, relative, listed: relative.split(sep).join('/') };
}
/** The same size, other bytes: an original damaged on the disk. */
const damage = (file: string) => {
  const bytes = readFileSync(file);
  bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0xff;
  writeFileSync(file, bytes);
};
const presentationName = (w: World, id: string) =>
  w.db.prepare('SELECT name FROM presentations WHERE id = ?').pluck().get(id) as string;
const pooledHooks = {
  gate: () => Promise.resolve(),
  throttle: () => Promise.resolve(),
  progress: () => undefined,
  cancelled: () => false,
  freeBytes: () => 1024 ** 4,
};
/** File > Back Up Library… as the menu runs it, into the world's drive; what it tells the operator. */
function backupUi(w: World, notices: string[], free?: number): BackupUi {
  dialogs.folder = w.drive;
  return {
    parent: () => null,
    db: w.db,
    userData: w.userData,
    mediaDir: w.mediaDir,
    version: '1.0.0',
    schema: LATEST_VERSION,
    notice: (text) => notices.push(text),
    progress: () => undefined,
    restart: () => undefined,
    log: { info: () => undefined, warn: () => undefined },
    ...(free === undefined ? {} : { freeBytes: () => free }),
  };
}

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

/*
 * alpha.15: one retained original that is missing or damaged never stops a backup. The library and everything
 * else are backed up; the original is left out, its note says which, and the operator is told once it has
 * finished. Such a backup restores, and a bad original in the library being restored over never stops it.
 */
describe('a missing or damaged original never stops a backup or a restore', () => {
  it('(a) backs up the library and the other originals when one original is missing, and says which was left out', async () => {
    const w = originalWorld();
    try {
      const first = await w.importPdf();
      w.arrangeOwnedBytes();
      const second = await importSecond(w);
      const name = presentationName(w, first.id);
      rmSync(w.owned);
      const saved = await backupLibrary(w.db, w.drive, options(null));
      expect(hashInLibrary(join(saved.folder, LIBRARY_FILE), first.id)).toBe(w.hash);
      expect(bytesHash(readFileSync(join(saved.folder, 'Media', second.relative)))).toBe(second.hash);
      expect(existsSync(join(saved.folder, 'Media', w.originalRelative))).toBe(false);
      const leftOut = [{ sha256: w.hash, ext: 'pdf', bytes: w.bytes.length, name }];
      expect(readNote(saved.folder)).toMatchObject({
        media: false,
        originals: { version: 1, files: [{ sha256: second.hash, ext: 'pdf', bytes: second.bytes.length }] },
        originalsLeftOut: leftOut,
      });
      expect(saved).toMatchObject({ originalsLeftOut: leftOut });
      expect(checkBackup(saved.folder, LATEST_VERSION)).toMatchObject({ ok: true, media: false });

      // File > Back Up Library… tells the operator once it has finished, in plain words.
      const notices: string[] = [];
      await backUp(backupUi(w, notices));
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatch(/^Library backed up to /u);
      expect(notices[0]).toContain(
        `1 original document was missing or damaged, so it isn’t in this backup: “${name}”. Its slides are in the backup.`,
      );
    } finally {
      w.clean();
    }
  });

  it('(b) leaves a damaged original out of a backup with the media, and keeps every other media file', async () => {
    const w = originalWorld();
    try {
      const first = await w.importPdf();
      w.arrangeOwnedBytes();
      const second = await importSecond(w);
      const name = presentationName(w, first.id);
      damage(w.owned);
      const saved = await backupLibrary(w.db, w.drive, options(w.mediaDir));
      expect(hashInLibrary(join(saved.folder, LIBRARY_FILE), first.id)).toBe(w.hash);
      expect(bytesHash(readFileSync(join(saved.folder, 'Media', second.relative)))).toBe(second.hash);
      // The damaged copy is not kept in the backup as if it were the original.
      expect(existsSync(join(saved.folder, 'Media', w.originalRelative))).toBe(false);
      const pictures = w.db.prepare("SELECT path FROM media WHERE path <> ''").pluck().all() as string[];
      expect(pictures.length).toBeGreaterThan(1);
      for (const file of pictures) expect(existsSync(join(saved.folder, 'Media', file))).toBe(true);
      expect(readNote(saved.folder)).toMatchObject({
        media: true,
        originals: { files: [{ sha256: second.hash }] },
        originalsLeftOut: [{ sha256: w.hash, ext: 'pdf', bytes: w.bytes.length, name }],
      });
      expect(saved.originalsLeftOut).toHaveLength(1);
      expect(checkBackup(saved.folder, LATEST_VERSION)).toMatchObject({ ok: true, media: true });
    } finally {
      w.clean();
    }
  });

  it('(c) makes a scheduled backup without a missing original, and copies a whole original over a damaged copy in the pool', async () => {
    const w = originalWorld();
    try {
      const first = await w.importPdf();
      w.arrangeOwnedBytes();
      const second = await importSecond(w);
      const name = presentationName(w, first.id);
      const run = (day: number) =>
        pooledBackup(
          {
            dbFile: w.dbFile,
            mediaDir: w.mediaDir,
            root: w.drive,
            keep: 3,
            app: '1.0.0',
            schema: LATEST_VERSION,
            now: new Date(2026, 10, day, 8, 0),
            reserveBytes: 0,
          },
          pooledHooks,
        );
      await run(2);
      const scheduled = join(w.drive, SCHEDULED_FOLDER);
      const pool = join(scheduled, 'Media');
      expect(bytesHash(readFileSync(join(pool, second.relative)))).toBe(second.hash);
      // Since then: the fixture's original gone from the library, and the pool's copy of the other damaged.
      rmSync(w.owned);
      damage(join(pool, second.relative));
      const made = await run(3);
      const folder = join(scheduled, made.folder);
      expect(made).toMatchObject({
        originalsLeftOut: [{ sha256: w.hash, ext: 'pdf', bytes: w.bytes.length, name }],
      });
      expect(hashInLibrary(join(folder, LIBRARY_FILE), first.id)).toBe(w.hash);
      // The damaged pool copy was not used: a whole one from the library took its place.
      expect(bytesHash(readFileSync(join(pool, second.relative)))).toBe(second.hash);
      expect(readManifest(folder)).toContain(second.listed);
      expect(readManifest(folder)).not.toContain(w.originalManifestPath);
      expect(readNote(folder)).toMatchObject({
        scheduled: true,
        originals: { files: [{ sha256: second.hash }] },
        originalsLeftOut: [{ sha256: w.hash, name }],
      });
      expect(checkBackup(folder, LATEST_VERSION)).toMatchObject({ ok: true, media: true });
    } finally {
      w.clean();
    }
  });

  it('(d) restores a backup that left an original out; its editor says the original is missing and nothing changes', async () => {
    const w = originalWorld();
    try {
      const first = await w.importPdf();
      w.arrangeOwnedBytes();
      const second = await importSecond(w);
      rmSync(w.owned);
      const saved = await backupLibrary(w.db, w.drive, options(null));
      expect(checkBackup(saved.folder, LATEST_VERSION)).toMatchObject({
        ok: true,
        media: false,
        originals: { set: { files: [{ sha256: second.hash }] } },
      });
      const target = join(w.root, 'restored-left-out');
      mkdirSync(target);
      requestRestore(target, saved.folder);
      expect(applyPendingRestore(target, restoreOptions())).toMatchObject({ restored: true, media: false });
      expect(hashInLibrary(join(target, LIBRARY_FILE), first.id)).toBe(w.hash);
      expect(bytesHash(readFileSync(join(target, 'Media', second.relative)))).toBe(second.hash);
      expect(existsSync(join(target, 'Media', w.originalRelative))).toBe(false);

      // As in a library whose original went missing: the editor opens, says so, and playback is unchanged.
      const db = openDatabase(join(target, LIBRARY_FILE));
      try {
        const presentations = new PresentationRepo(db);
        const playback = presentations.content(first.id);
        expect(playback?.slides).toHaveLength(1);
        registerSlidesIpc({
          db,
          presentations,
          revisions: new Revisions(),
          settings: new SettingsRepo(db),
          fromOperator: () => true,
          mayPrepareSource: () => true,
          sourceReader: nativeSourceReader,
          sourceWrite: sourceWrite(db),
          lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
          changed: () => {
            throw new Error('Opening must not publish a saved content change.');
          },
        });
        const open = handlers.get('library:slides-for-edit');
        if (!open) throw new Error('The editor-open handler was not registered.');
        const opened = (await open({}, first.id)) as EditSlidesResult;
        expect(opened).toMatchObject({
          ok: true,
          sourceIssues: [
            'A retained original is missing or damaged. Saved playback is unchanged; restore the original from a backup.',
          ],
        });
        expect(presentations.content(first.id)).toEqual(playback);
      } finally {
        db.close();
      }
    } finally {
      w.clean();
    }
  });

  it('(e) restores a library-only backup over a library whose own originals are damaged or missing', async () => {
    const w = originalWorld();
    try {
      await w.importPdf();
      w.arrangeOwnedBytes();
      const second = await importSecond(w);
      const saved = await backupLibrary(w.db, w.drive, options(null));
      w.db.close();
      // Since the backup: the library's copy of one original damaged, the other gone.
      damage(w.owned);
      rmSync(join(w.mediaDir, second.relative));
      requestRestore(w.userData, saved.folder);
      const restored = applyPendingRestore(w.userData, restoreOptions());
      expect(restored).toMatchObject({ restored: true, media: false, originalsNotKept: 2 });
      // The backup's whole originals are the library's again.
      expect(bytesHash(readFileSync(w.owned))).toBe(w.hash);
      expect(bytesHash(readFileSync(join(w.mediaDir, second.relative)))).toBe(second.hash);
      // The library from before is kept, says what it lacks, and is still a backup that can be restored.
      if (!restored.restored) throw new Error('The generated library was not restored.');
      const kept = join(w.userData, 'Backups', restored.keptIn);
      expect(readNote(kept)?.originalsLeftOut?.map((o) => o.sha256).sort()).toEqual(
        [w.hash, second.hash].sort(),
      );
      expect(checkBackup(kept, LATEST_VERSION)).toMatchObject({ ok: true, media: false });
    } finally {
      w.clean();
    }
  });

  it('(f) counts the originals with the library in the size shown and in the room a backup needs', async () => {
    const w = originalWorld();
    try {
      await w.importPdf();
      w.arrangeOwnedBytes();
      const second = await importSecond(w);
      const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);
      const libraryBytes = size(w.dbFile) + size(`${w.dbFile}-wal`);
      const originalBytes = w.bytes.length + second.bytes.length;
      const reserve = sameDisk(w.drive, w.userData) ? 2 * 1024 ** 3 : 64 * 1024 * 1024;

      // The library only: one byte short of the library and its originals.
      dialogs.media = false;
      const notices: string[] = [];
      await backUp(backupUi(w, notices, reserve + libraryBytes + originalBytes - 1));
      expect(dialogs.boxes[0]?.detail).toContain(
        `settings, and 2 original documents kept for editing (${formatBytes(libraryBytes + originalBytes)}).`,
      );
      expect(dialogs.boxes[1]).toMatchObject({ message: 'There is not enough room there' });
      expect(dialogs.boxes[1]?.detail).toContain(`needs ${formatBytes(libraryBytes + originalBytes)}`);
      expect(notices).toEqual([]);

      // With the media: the originals are counted once, with the library (the media box leaves them out).
      dialogs.boxes = [];
      dialogs.media = true;
      const media = w.db.prepare("SELECT path FROM media WHERE path <> ''").pluck().all() as string[];
      const mediaBytes = media.reduce((sum, file) => sum + size(join(w.mediaDir, file)), 0);
      await backUp(backupUi(w, notices, reserve + libraryBytes + originalBytes + mediaBytes));
      expect(dialogs.boxes[0]?.checkboxLabel).toContain(`(${formatBytes(mediaBytes)})`);
      expect(dialogs.boxes).toHaveLength(1);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatch(/^Library backed up to /u);
    } finally {
      dialogs.media = false;
      w.clean();
    }
  });
});
