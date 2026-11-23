import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { makeTestPdf } from '../import/testing/make-pdf';
import { publishExclusive, writePdfCopy } from './pdf-copy-file';
import { PdfCopyHistory } from './pdf-copy-history';

// A USB stick formatted exFAT or FAT32 (and some network shares), on both systems: link() is not supported, and a
// file's number comes from where its name sits in the folder, so a renamed file reads back with a new number. All other
// filesystem work is real.
const volume = vi.hoisted(() => ({ links: true }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    link: (...args: Parameters<typeof actual.link>) =>
      volume.links
        ? actual.link(...args)
        : Promise.reject(
            Object.assign(new Error('Placeholder: this volume has no hard links'), { code: 'ENOTSUP' }),
          ),
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const stats = await actual.lstat(...args);
      if (!volume.links && basename(String(args[0])).startsWith('.drashti-pdf-undo-'))
        stats.ino = typeof stats.ino === 'bigint' ? stats.ino + 7919n : stats.ino + 7919;
      return stats;
    },
  };
});

const pdf = (text: string) => makeTestPdf([{ width: 240, height: 160, color: [20, 40, 80], text }]);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function stick(run: (w: Awaited<ReturnType<typeof world>>) => Promise<void>): Promise<void> {
  const w = await world();
  volume.links = false;
  try {
    await run(w);
  } finally {
    volume.links = true;
    await rm(w.root, { recursive: true, force: true });
  }
}
async function world() {
  const home = resolve(import.meta.dirname, '../../..', 'test-results', 'task-temp');
  await mkdir(home, { recursive: true });
  const root = await mkdtemp(join(home, 'pdf-no-links-'));
  const mediaDir = join(root, 'Media');
  const outputDir = join(root, 'Placeholder stick');
  await Promise.all([mkdir(mediaDir), mkdir(outputDir)]);
  const original = join(mediaDir, 'original.pdf');
  const sourceBytes = pdf('Placeholder source');
  await writeFile(original, sourceBytes);
  const bytes = pdf('Placeholder extracted pages');
  const outputPath = join(outputDir, 'Placeholder extracted.pdf');
  const request = { bytes, outputPath, mediaDir, protectedSources: [original], newOnly: true };
  const noPrivateFiles = async () =>
    expect((await readdir(outputDir)).filter((name) => name.startsWith('.drashti-pdf-'))).toEqual([]);
  return { root, outputDir, original, sourceBytes, bytes, outputPath, request, noPrivateFiles };
}

describe('Extract pages to a new PDF on a volume without hard links (exFAT and FAT32 USB sticks)', () => {
  it('publishes the new PDF as an exclusive copy, its receipt the published file, and never over another file', async () =>
    stick(async (w) => {
      const receipt = await writePdfCopy(w.request);
      expect(await readFile(w.outputPath)).toEqual(w.bytes);
      const published = await lstat(w.outputPath, { bigint: true });
      expect(receipt.hash).toBe(digest(w.bytes));
      expect(receipt.identity.ino).toBe(published.ino);
      expect(receipt.identity.mtimeNs).toBe(published.mtimeNs);
      await w.noPrivateFiles();
      // An existing file at the chosen name is never replaced.
      const other = pdf('Placeholder occupied name');
      await writeFile(w.outputPath, other);
      await expect(writePdfCopy(w.request)).rejects.toMatchObject({ code: 'output-exists' });
      expect(await readFile(w.outputPath)).toEqual(other);
      expect(await readFile(w.original)).toEqual(w.sourceBytes);
      await w.noPrivateFiles();
    }));

  it('puts bytes at a name only while nothing is there, as a hard link would', async () =>
    stick(async (w) => {
      const from = join(w.outputDir, 'Placeholder from.pdf'),
        to = join(w.outputDir, 'Placeholder to.pdf');
      await writeFile(from, w.bytes);
      await publishExclusive(from, to);
      expect(await readFile(to)).toEqual(w.bytes);
      const other = pdf('Placeholder other file');
      await writeFile(to, other);
      await expect(publishExclusive(from, to)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(to)).toEqual(other);
    }));

  it('keeps Undo and Redo: Undo takes away only its own file, Redo puts back the same bytes and never over another file', async () =>
    stick(async (w) => {
      const history = new PdfCopyHistory();
      try {
        const id = await history.keep(w.outputPath, await writePdfCopy(w.request));
        expect(await history.show(id, false)).toBe(true);
        await expect(readFile(w.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await writeFile(w.outputPath, 'Placeholder unrelated file');
        expect(await history.show(id, true)).toBe(false);
        expect(await readFile(w.outputPath, 'utf8')).toBe('Placeholder unrelated file');
        await rm(w.outputPath);
        expect(await history.show(id, true)).toBe(true);
        expect(await readFile(w.outputPath)).toEqual(w.bytes);
        await w.noPrivateFiles();
        // Undo again after Redo, then a file changed outside Drashti is left alone.
        expect(await history.show(id, false)).toBe(true);
        expect(await history.show(id, true)).toBe(true);
        await writeFile(w.outputPath, 'Placeholder changed outside Drashti');
        expect(await history.show(id, false)).toBe(false);
        expect(await readFile(w.outputPath, 'utf8')).toBe('Placeholder changed outside Drashti');
        await w.noPrivateFiles();
      } finally {
        await history.stop();
      }
    }));
});
