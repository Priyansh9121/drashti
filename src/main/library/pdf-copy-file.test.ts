import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type * as FsPromises from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { makeTestPdf } from '../import/testing/make-pdf';
import { writePdfCopy, MAX_PDF_COPY_BYTES } from './pdf-copy-file';

// All filesystem work stays real except an explicit final-rename failure. This
// exercises the same staging/verification/protection path before publication.
const faults = vi.hoisted(() => ({ rename: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: (...args: Parameters<typeof actual.rename>) => {
      if (faults.rename)
        return Promise.reject(
          Object.assign(new Error('Placeholder publication failure'), { code: 'EACCES' }),
        );
      return actual.rename(...args);
    },
  };
});

function generatedPdf(text: string): Buffer {
  return makeTestPdf([{ width: 240, height: 160, color: [20, 40, 80], text }]);
}
async function world() {
  const fixtureHome = resolve(import.meta.dirname, '../../..', 'test-results', 'task-temp');
  await mkdir(fixtureHome, { recursive: true });
  const root = await mkdtemp(join(fixtureHome, 'pdf-copy-'));
  const mediaDir = join(root, 'Media');
  const sourceDir = join(root, 'external');
  const outputDir = join(root, 'chosen');
  await Promise.all([mediaDir, sourceDir, outputDir].map((folder) => mkdir(folder)));
  const original = join(mediaDir, 'original.pdf');
  const external = join(sourceDir, 'source.pdf');
  const outputPath = join(outputDir, 'copy.pdf');
  const sourceBytes = generatedPdf('Placeholder source');
  const bytes = generatedPdf('Placeholder edited copy');
  await Promise.all([writeFile(original, sourceBytes), writeFile(external, sourceBytes)]);
  const request = { bytes, outputPath, mediaDir, protectedSources: [original, external] };
  return {
    root,
    mediaDir,
    sourceDir,
    outputDir,
    original,
    external,
    outputPath,
    sourceBytes,
    bytes,
    request,
  };
}
type World = Awaited<ReturnType<typeof world>>;
async function inWorld(run: (w: World) => Promise<void>): Promise<void> {
  const w = await world();
  try {
    await run(w);
  } finally {
    faults.rename = false;
    await rm(w.root, { recursive: true, force: true });
  }
}
async function originalsUnchanged(w: World): Promise<void> {
  expect(await readFile(w.original)).toEqual(w.sourceBytes);
  expect(await readFile(w.external)).toEqual(w.sourceBytes);
}
async function noPrivateTemps(folder: string): Promise<void> {
  expect((await readdir(folder)).filter((name) => name.startsWith('.drashti-pdf-'))).toEqual([]);
}
const dirLink = (target: string, alias: string) =>
  symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');

describe('bounded atomic PDF copy files', () => {
  it('publishes the complete generated copy and never changes either protected source', async () =>
    inWorld(async (w) => {
      await writePdfCopy(w.request);
      expect(await readFile(w.outputPath)).toEqual(w.bytes);
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
  it('atomically replaces only the explicitly chosen ordinary output', async () =>
    inWorld(async (w) => {
      await writeFile(w.outputPath, generatedPdf('Placeholder previous output'));
      await writePdfCopy(w.request);
      expect(await readFile(w.outputPath)).toEqual(w.bytes);
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
  it('freezes caller bytes before any awaited work', async () =>
    inWorld(async (w) => {
      const expected = Buffer.from(w.bytes);
      await writePdfCopy(w.request, {
        beforePublish: () => {
          w.bytes.fill(0);
          return Promise.resolve();
        },
      });
      expect(await readFile(w.outputPath)).toEqual(expected);
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
  it('refuses invalid signatures and oversized bytes before staging', async () =>
    inWorld(async (w) => {
      const highBitHeader = Buffer.from(w.bytes);
      highBitHeader[0] = 0xa5;
      for (const bytes of [
        Buffer.from('Placeholder invalid PDF'),
        highBitHeader,
        Buffer.alloc(MAX_PDF_COPY_BYTES + 1),
      ]) {
        await expect(writePdfCopy({ ...w.request, bytes })).rejects.toMatchObject({ code: 'invalid-pdf' });
      }
      expect(await readdir(w.outputDir)).toEqual([]);
      await originalsUnchanged(w);
    }));
  it('refuses every output in managed Media, including a new file', async () =>
    inWorld(async (w) => {
      await expect(
        writePdfCopy({ ...w.request, outputPath: join(w.mediaDir, 'new-copy.pdf') }),
      ).rejects.toMatchObject({ code: 'unsafe-output' });
      expect(await readdir(w.mediaDir)).toEqual(['original.pdf']);
      await originalsUnchanged(w);
    }));
  it('refuses a managed Media directory alias', async () =>
    inWorld(async (w) => {
      const alias = join(w.root, 'media-alias');
      await dirLink(w.mediaDir, alias);
      await expect(
        writePdfCopy({ ...w.request, outputPath: join(alias, 'new-copy.pdf') }),
      ).rejects.toMatchObject({ code: 'unsafe-output' });
      expect(await readdir(w.mediaDir)).toEqual(['original.pdf']);
      await originalsUnchanged(w);
    }));
  it('refuses an external source path and a directory alias to that source', async () =>
    inWorld(async (w) => {
      const alias = join(w.root, 'source-alias');
      await dirLink(w.sourceDir, alias);
      for (const outputPath of [w.external, join(alias, 'source.pdf')]) {
        await expect(writePdfCopy({ ...w.request, outputPath })).rejects.toMatchObject({
          code: 'unsafe-output',
        });
      }
      await originalsUnchanged(w);
      await noPrivateTemps(w.sourceDir);
    }));
  it('refuses an output symlink rather than following or replacing it', async () =>
    inWorld(async (w) => {
      await symlink(w.external, w.outputPath, 'file');
      await expect(writePdfCopy(w.request)).rejects.toMatchObject({ code: 'unsafe-output' });
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
  it('refuses a hardlink inode alias to any protected source', async () =>
    inWorld(async (w) => {
      await link(w.external, w.outputPath);
      await expect(writePdfCopy(w.request)).rejects.toMatchObject({ code: 'unsafe-output' });
      expect(await readFile(w.outputPath)).toEqual(w.sourceBytes);
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
  it('never stages or publishes when already cancelled', async () =>
    inWorld(async (w) => {
      const abort = new AbortController();
      abort.abort();
      await expect(writePdfCopy({ ...w.request, signal: abort.signal })).rejects.toMatchObject({
        code: 'cancelled',
      });
      expect(await readdir(w.outputDir)).toEqual([]);
      await originalsUnchanged(w);
    }));
  it('cleans its staged file when cancelled before the commit boundary', async () =>
    inWorld(async (w) => {
      const abort = new AbortController();
      await expect(
        writePdfCopy(
          { ...w.request, signal: abort.signal },
          {
            beforePublish: () => {
              abort.abort();
              return Promise.resolve();
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'cancelled' });
      expect(await readdir(w.outputDir)).toEqual([]);
      await originalsUnchanged(w);
    }));
  it('checks Main admission before staging and again after awaited work', async () =>
    inWorld(async (w) => {
      await expect(writePdfCopy({ ...w.request, current: () => false })).rejects.toMatchObject({
        code: 'cancelled',
      });
      let current = true;
      await expect(
        writePdfCopy(
          { ...w.request, current: () => current },
          {
            beforePublish: () => {
              current = false;
              return Promise.resolve();
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'cancelled' });
      expect(await readdir(w.outputDir)).toEqual([]);
      await originalsUnchanged(w);
    }));
  it('verifies staged bytes after the seam and preserves the previous output on corruption', async () =>
    inWorld(async (w) => {
      const previous = generatedPdf('Placeholder previous output');
      await writeFile(w.outputPath, previous);
      await expect(
        writePdfCopy(w.request, {
          beforePublish: async (staged) => {
            const corrupt = Buffer.from(w.bytes);
            corrupt[corrupt.length - 1] = 0;
            await writeFile(staged, corrupt);
          },
        }),
      ).rejects.toMatchObject({ code: 'corrupt-staging' });
      expect(await readFile(w.outputPath)).toEqual(previous);
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
  it('rejects a changed destination without overwriting the other process output', async () =>
    inWorld(async (w) => {
      const replacement = generatedPdf('Placeholder other output');
      await expect(
        writePdfCopy(w.request, {
          beforePublish: async () => {
            await writeFile(w.outputPath, replacement);
          },
        }),
      ).rejects.toMatchObject({ code: 'changed-output' });
      expect(await readFile(w.outputPath)).toEqual(replacement);
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
  it('rechecks source hardlink protection immediately before publication', async () =>
    inWorld(async (w) => {
      await expect(
        writePdfCopy(w.request, {
          beforePublish: async () => {
            await link(w.external, w.outputPath);
          },
        }),
      ).rejects.toMatchObject({ code: 'unsafe-output' });
      expect(await readFile(w.outputPath)).toEqual(w.sourceBytes);
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
  it('refuses a changed chosen parent alias and cleans the actual canonical staging folder', async () =>
    inWorld(async (w) => {
      const alias = join(w.root, 'chosen-alias');
      const other = join(w.root, 'other');
      await mkdir(other);
      await dirLink(w.outputDir, alias);
      await expect(
        writePdfCopy(
          { ...w.request, outputPath: join(alias, 'copy.pdf') },
          {
            beforePublish: async () => {
              await unlink(alias);
              await dirLink(other, alias);
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'changed-output' });
      expect(await readdir(w.outputDir)).toEqual([]);
      expect(await readdir(other)).toEqual([]);
      await originalsUnchanged(w);
    }));
  it('preserves the previous output and sources when final publication fails', async () =>
    inWorld(async (w) => {
      const previous = generatedPdf('Placeholder previous output');
      await writeFile(w.outputPath, previous);
      await expect(
        writePdfCopy(w.request, {
          beforePublish: () => {
            faults.rename = true;
            return Promise.resolve();
          },
        }),
      ).rejects.toMatchObject({ code: 'EACCES' });
      expect(await readFile(w.outputPath)).toEqual(previous);
      await originalsUnchanged(w);
      await noPrivateTemps(w.outputDir);
    }));
});
