import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import {
  EDITABLE_SOURCE_LIMITS,
  type PreparedSource,
  type PreparedSourcePage,
} from '../../shared/editable-source';
import { hexColorSchema, slideElementSchema } from '../../shared/model-schema';
import { sourceCheckpoint, sourceTimeLeft, type SourceReader } from './source-reader';
import type { PptxReaderChild } from './pptx-reader-protocol';

const resultSchema = z
  .object({
    type: z.literal('prepared'),
    jobId: z.string().min(1).max(512),
    total: z.number().int().min(0).max(2_000),
    failed: z.array(z.number().int().min(0)).max(EDITABLE_SOURCE_LIMITS.pages),
    pages: z
      .array(
        z
          .object({
            sourceIndex: z.number().int().min(0),
            width: z.number().min(16).max(16_384),
            height: z.number().min(16).max(16_384),
            background: hexColorSchema.nullable(),
            elements: z.array(slideElementSchema).max(EDITABLE_SOURCE_LIMITS.pageElements),
            issues: z.array(z.string().max(300)).max(100),
            assets: z
              .array(
                z
                  .object({
                    token: z.string().min(1).max(512),
                    relative: z.string().min(1).max(32_768),
                    kind: z.enum(['image', 'video', 'audio']),
                  })
                  .strict(),
              )
              .max(EDITABLE_SOURCE_LIMITS.pageElements),
          })
          .strict(),
      )
      .max(EDITABLE_SOURCE_LIMITS.pages),
  })
  .strict();
const failed = (): PreparedSource => ({
  ok: false,
  message: 'This deck’s words and shapes could not be read safely. The slides still show as before.',
});

interface ReaderOptions {
  timeoutMs?: number;
  cancelGraceMs?: number;
  exitGraceMs?: number;
}

/** One fresh child per source. An unconfirmed exit poisons admission until that child really exits. */
export function pptxReader(spawn: () => PptxReaderChild, options: ReaderOptions = {}): SourceReader {
  let active = false;
  const isActive = (): boolean => active;
  return async (request) => {
    if (isActive() || request.ext !== 'pptx' || !(await sourceCheckpoint(request))) return failed();
    if (isActive()) return failed();
    const selected = new Set(request.sourcePages);
    if (
      !selected.size ||
      selected.size > EDITABLE_SOURCE_LIMITS.pages ||
      selected.size !== request.sourcePages.length
    )
      return failed();
    active = true;
    return await new Promise<PreparedSource>((resolve) => {
      let child: PptxReaderChild;
      try {
        child = spawn();
      } catch {
        active = false;
        resolve(failed());
        return;
      }
      const jobId = randomUUID();
      let stopping = false;
      let settled = false;
      let exited = false;
      const hasExited = (): boolean => exited;
      let reply: unknown;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let exitTimer: ReturnType<typeof setTimeout> | undefined;
      const timers: { deadline?: ReturnType<typeof setTimeout> } = {};
      const clearTimers = () => {
        if (timers.deadline) clearTimeout(timers.deadline);
        if (killTimer) clearTimeout(killTimer);
        if (exitTimer) clearTimeout(exitTimer);
      };
      const publish = (result: PreparedSource) => {
        if (settled) return;
        settled = true;
        clearTimers();
        request.signal.removeEventListener('abort', abort);
        resolve(result);
      };
      const kill = () => {
        if (hasExited()) return;
        try {
          child.kill();
        } catch {
          /* Confirmation still determines whether output is safe to remove. */
        }
        if (hasExited()) return;
        exitTimer = setTimeout(() => {
          if (hasExited()) return;
          try {
            child.kill();
          } catch {
            /* Only this owned child is targeted. */
          }
          if (!hasExited())
            publish({
              ok: false,
              message:
                'Drashti’s document reader did not stop. Restart Drashti before editing more imported slides.',
              retainOutput: true,
            });
        }, options.exitGraceMs ?? 1_000);
      };
      const stop = (delay = 0) => {
        if (stopping || hasExited()) return;
        stopping = true;
        if (timers.deadline) clearTimeout(timers.deadline);
        if (delay) killTimer = setTimeout(kill, delay);
        else kill();
      };
      const abort = () => {
        if (stopping || hasExited()) return;
        reply = undefined;
        try {
          child.post({ type: 'cancel', jobId });
        } catch {
          stop();
          return;
        }
        stop(options.cancelGraceMs ?? 1_000);
      };
      child.onMessage((message) => {
        if (stopping || hasExited() || request.signal.aborted) return;
        reply = message;
        stop();
      });
      child.onExit(() => {
        if (hasExited()) return;
        exited = true;
        active = false;
        clearTimers();
        if (settled) return;
        void (async () => {
          try {
            if (!(await sourceCheckpoint(request))) {
              publish(failed());
              return;
            }
            const parsed = resultSchema.safeParse(reply);
            if (
              !parsed.success ||
              parsed.data.jobId !== jobId ||
              Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > EDITABLE_SOURCE_LIMITS.jobMetadataBytes
            ) {
              publish(failed());
              return;
            }
            const requested = new Set(request.sourcePages);
            const failedPages = new Set(parsed.data.failed);
            const completed = new Set<number>();
            if (
              failedPages.size !== parsed.data.failed.length ||
              [...failedPages].some((index) => !requested.has(index))
            ) {
              publish(failed());
              return;
            }
            const root = await realpath(request.outDir);
            const checkedFiles = new Map<string, number>();
            let totalBytes = 0;
            const pages: PreparedSourcePage[] = [];
            for (const page of parsed.data.pages) {
              if (
                !requested.has(page.sourceIndex) ||
                completed.has(page.sourceIndex) ||
                failedPages.has(page.sourceIndex) ||
                page.sourceIndex >= parsed.data.total
              ) {
                publish(failed());
                return;
              }
              completed.add(page.sourceIndex);
              if (
                page.elements.some(
                  (element) =>
                    !Object.values(element.frame).every(
                      (value: unknown) =>
                        typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000,
                    ),
                )
              ) {
                publish(failed());
                return;
              }
              const needed = new Set(
                page.elements.flatMap((element) =>
                  element.kind === 'image' || element.kind === 'video' ? [element.mediaId] : [],
                ),
              );
              const seen = new Set<string>();
              const assets: PreparedSourcePage['assets'] = [];
              const pageFiles = new Set<string>();
              let pageBytes = 0;
              for (const asset of page.assets) {
                if (!needed.has(asset.token) || seen.has(asset.token) || isAbsolute(asset.relative)) {
                  publish(failed());
                  return;
                }
                seen.add(asset.token);
                const file = join(root, asset.relative);
                const metadata = await lstat(file);
                const actual = await realpath(file);
                const inside = relative(root, actual);
                if (
                  !inside ||
                  isAbsolute(inside) ||
                  inside === '..' ||
                  inside.startsWith(`..${sep}`) ||
                  !metadata.isFile() ||
                  metadata.isSymbolicLink()
                ) {
                  publish(failed());
                  return;
                }
                if (!checkedFiles.has(actual)) {
                  totalBytes += metadata.size;
                  checkedFiles.set(actual, metadata.size);
                }
                if (!pageFiles.has(actual)) {
                  pageFiles.add(actual);
                  pageBytes += metadata.size;
                }
                if (
                  pageBytes > EDITABLE_SOURCE_LIMITS.pageAssetBytes ||
                  totalBytes > EDITABLE_SOURCE_LIMITS.jobAssetBytes
                ) {
                  publish(failed());
                  return;
                }
                assets.push({ token: asset.token, file: actual, kind: asset.kind });
              }
              if (seen.size !== needed.size) {
                publish(failed());
                return;
              }
              pages.push({ ...page, assets });
            }
            if ([...requested].some((index) => !completed.has(index) && !failedPages.has(index))) {
              publish(failed());
              return;
            }
            publish({ ok: true, pages, total: parsed.data.total, failed: [...failedPages] });
          } catch {
            publish(failed());
          }
        })();
      });
      request.signal.addEventListener('abort', abort, { once: true });
      timers.deadline = setTimeout(
        abort,
        Math.min(options.timeoutMs ?? EDITABLE_SOURCE_LIMITS.timeoutMs, sourceTimeLeft(request)),
      );
      try {
        child.post({
          type: 'read',
          jobId,
          file: request.file,
          outDir: request.outDir,
          sourcePages: request.sourcePages,
        });
        if (request.signal.aborted) abort();
      } catch {
        stop();
      }
    });
  };
}
