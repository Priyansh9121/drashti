import { constants, setPriority } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';
import { z } from 'zod';
import { EDITABLE_SOURCE_LIMITS, pptxAssetTokens } from '../../shared/editable-source';
import { MEDIA_REF } from '../import/model';
import type { FromPptxReader, PptxPage, ToPptxReader } from './pptx-reader-protocol';
import { readEditableWithTiming } from './pptx-source-timing';

const startSchema = z
  .object({
    type: z.literal('read'),
    jobId: z.string().min(1).max(512),
    file: z.string().max(32_768).refine(isAbsolute),
    outDir: z.string().max(32_768).refine(isAbsolute),
    sourcePages: z.array(z.number().int().min(0).max(1_000_000)).min(1).max(EDITABLE_SOURCE_LIMITS.pages),
    timingPages: z.array(z.number().int().min(0).max(1_000_000)).max(EDITABLE_SOURCE_LIMITS.pages).optional(),
  })
  .strict();
const parentPort = (): typeof process.parentPort | undefined => process.parentPort;
const port = parentPort();
if (!port) throw new Error('Document reader requires its parent.');
try {
  setPriority(process.pid, constants.priority.PRIORITY_LOW);
} catch {
  /* Remains normal if disallowed. */
}
let started = false;
let cancelled = false;
let activeId: string | undefined;

const reply = (message: FromPptxReader) => port.postMessage(message);

port.on('message', ({ data }: { data: unknown }) => {
  // A late cancel never applies to another generation. One worker is used for one source only.
  if (typeof data === 'object' && data && 'type' in data && data.type === 'cancel') {
    const cancel = data as Extract<ToPptxReader, { type: 'cancel' }>;
    if (cancel.jobId === activeId) cancelled = true;
    return;
  }
  const parsed = startSchema.safeParse(data);
  if (started || !parsed.success) return;
  started = true;
  activeId = parsed.data.jobId;
  const job = parsed.data;
  void (async () => {
    try {
      // W6's review N4: the asked pages' clicks and transition too, read as alpha.17's import reads them.
      const { editable: native, decks } = await readEditableWithTiming(
        job.file,
        job.outDir,
        job.timingPages ?? [],
      );
      const pages: PptxPage[] = [];
      const failed: number[] = [];
      for (const sourceIndex of job.sourcePages) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (cancelled) throw new Error('Cancelled.');
        const page = native.slides.find((entry) => entry.sourceIndex === sourceIndex);
        if (!page) {
          failed.push(sourceIndex);
          continue;
        }
        const needed = pptxAssetTokens(page.elements);
        const assets: PptxPage['assets'] = [];
        for (const [index, asset] of native.media.entries()) {
          const token = `${MEDIA_REF}${String(index)}`;
          if (!needed.has(token)) continue;
          const path = relative(job.outDir, asset.originalPath);
          if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
            throw new Error('Unsafe generated asset.');
          assets.push({ token, relative: path, kind: asset.kind });
        }
        if (assets.length !== needed.size) throw new Error('Unresolved native asset.');
        const deck = decks.get(sourceIndex);
        pages.push({
          sourceIndex,
          width: native.width,
          height: native.height,
          background: page.background,
          elements: page.elements,
          assets,
          issues: page.issues,
          ...(deck ? { deck } : {}),
        });
      }
      const within = (sent: PptxPage[]): FromPptxReader | null => {
        const message: FromPptxReader = {
          type: 'prepared',
          jobId: job.jobId,
          pages: sent,
          total: native.sourceCount,
          failed,
        };
        return Buffer.byteLength(JSON.stringify(message), 'utf8') > EDITABLE_SOURCE_LIMITS.jobMetadataBytes
          ? null
          : message;
      };
      // Clicks too many to send leave the pages as they were read before: those slides keep today's behaviour.
      const message =
        within(pages) ?? (decks.size > 0 ? within(pages.map(({ deck: _deck, ...page }) => page)) : null);
      if (!message) throw new Error('Metadata limit.');
      if (cancelled) throw new Error('Cancelled.');
      reply(message);
    } catch {
      reply({ type: 'failed', jobId: job.jobId });
    }
    // Parent owns final exit/cleanup sequencing. No source/exception output goes to stdout/stderr.
  })();
});
