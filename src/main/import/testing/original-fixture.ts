import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { openDatabase } from '../../db/database';
import { ImportRepo } from '../../db/imports';
import { MediaStore } from '../media-store';
import { runImport } from '../pipeline';
import { makeTestPdf } from './make-pdf';

/* Generated source and page bytes only. No original-store production API is assumed by this fixture. */
export const PLACEHOLDER_WORDS = 'Placeholder editable words';
export const bytesHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A tiny generated page picture, as in pictures.test.ts; never supplies native text to the editor. */
function pagePng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(3, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.from([0, 30, 58, 138, 30, 58, 138, 30, 58, 138, 30, 58, 138]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat([row, row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function originalWorld() {
  const root = mkdtempSync(join(tmpdir(), 'drashti-original-test-'));
  const userData = join(root, 'userData');
  const mediaDir = join(userData, 'Media');
  const externalDir = join(root, 'generated-external');
  const drive = join(root, 'backup-drive');
  for (const dir of [mediaDir, externalDir, drive]) mkdirSync(dir, { recursive: true });
  const dbFile = join(userData, 'drashti.sqlite');
  const db = openDatabase(dbFile);
  const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
  const bytes = makeTestPdf([
    {
      width: 960,
      height: 540,
      color: [30, 58, 138],
      text: PLACEHOLDER_WORDS,
      note: 'Placeholder note',
    },
  ]);
  const hash = bytesHash(bytes);
  const source = join(externalDir, 'Placeholder original.pdf');
  writeFileSync(source, bytes);

  // Provisional file-store layout. Keep this assumption in one place if the chosen layout changes.
  const originalRelative = join('Originals', hash.slice(0, 2), `${hash}.pdf`);
  const originalManifestPath = originalRelative.split(sep).join('/');
  const owned = join(mediaDir, originalRelative);

  const importPdf = async () => {
    const summary = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths: [source],
      options: {},
      converters: false,
      progressEveryMs: 0,
      drawPdf: (pdf, outDir) => {
        // Accept either the generated external PDF or a retained own copy passed by the real importer.
        if (!readFileSync(pdf).subarray(0, 5).equals(Buffer.from('%PDF-')))
          throw new Error('The generated PDF input was not readable.');
        mkdirSync(outDir, { recursive: true });
        const file = join(outDir, 'page-0001.png');
        writeFileSync(file, pagePng());
        return Promise.resolve({
          ok: true as const,
          width: 1920,
          height: 1080,
          pages: [{ index: 0, file, notes: 'Placeholder note' }],
          total: 1,
          failed: [],
        });
      },
    });
    const item = new ImportRepo(db)
      .report(summary.id)
      ?.items.find((entry) => entry.target?.kind === 'presentation');
    if (item?.target?.kind !== 'presentation') throw new Error('The generated PDF was not imported.');
    return { summary, id: item.target.id };
  };

  // Backup cases arrange already-owned bytes so the import-retention RED cannot mask a backup RED.
  // The real importer supplies current source_hash metadata. Do not invent an original table here.
  // If future metadata requires more, use the then-real import binding rather than bypassing it.
  const arrangeOwnedBytes = () => {
    if (existsSync(owned)) {
      if (!readFileSync(owned).equals(bytes)) throw new Error('The retained original bytes changed.');
      return;
    }
    mkdirSync(dirname(owned), { recursive: true });
    writeFileSync(owned, bytes, { flag: 'wx' });
  };

  return {
    root,
    userData,
    mediaDir,
    externalDir,
    drive,
    dbFile,
    db,
    bytes,
    hash,
    source,
    originalRelative,
    originalManifestPath,
    owned,
    importPdf,
    arrangeOwnedBytes,
    clean: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
