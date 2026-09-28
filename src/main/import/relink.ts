import type { ImportProgress, ImportRunSummary } from '../../shared/import';
import { emptyTotals, NO_COUNTS } from '../../shared/import';
import type { Db } from '../db/database';
import { addToTotals, ImportRepo, type NewImportItem } from '../db/imports';
import type { MediaStore } from './media-store';
import { resolveMedia } from './media-resolver';
import { scanPaths } from './scan';

/*
 * Relinking missing media from a folder the operator picks (the last of
 * the three places PLAN.md 4.4 looks). Runs in the import worker, because
 * it hashes and copies media, and keeps a report like any import.
 */

/**
 * Point everything that used one media item at another (when a relinked
 * file turns out to be stored already). Slides use media through image and
 * video elements.
 */
export function repointMedia(db: Db, fromId: string, toId: string): void {
  db.prepare(
    `UPDATE elements SET props = json_set(props, '$.mediaId', ?)
      WHERE kind IN ('image', 'video') AND json_extract(props, '$.mediaId') = ?`,
  ).run(toId, fromId);
}

export interface RelinkContext {
  db: Db;
  media: MediaStore;
  runId: string;
  folder: string;
  /** Only these missing items (default: all of them). */
  mediaIds?: readonly string[];
  skipDir?: (dir: string) => boolean;
  onProgress?: (progress: ImportProgress) => void;
  isCancelled?: () => boolean;
}

export async function runRelink(ctx: RelinkContext): Promise<ImportRunSummary> {
  const imports = new ImportRepo(ctx.db);
  const totals = emptyTotals();
  let position = 0;
  const record = (item: NewImportItem) => {
    imports.addItem(ctx.runId, position++, item);
    addToTotals(totals, item);
  };
  imports.startRun(ctx.runId, [ctx.folder], {});
  ctx.onProgress?.({ runId: ctx.runId, phase: 'scanning', done: 0, total: 0, current: null });
  const scan = await scanPaths([ctx.folder], { skip: ctx.skipDir });
  const wanted = ctx.mediaIds ? new Set(ctx.mediaIds) : null;
  const missing = ctx.media.missing().filter((m) => !wanted || wanted.has(m.id));
  let done = 0;
  let cancelled = false;
  for (const m of missing) {
    if (ctx.isCancelled?.()) {
      cancelled = true;
      break;
    }
    ctx.onProgress?.({ runId: ctx.runId, phase: 'importing', done, total: missing.length, current: m.name });
    const reference = m.originalPath ?? m.name;
    const found = resolveMedia(reference, { nearby: [ctx.folder], byName: scan.mediaByName });
    if (!found) {
      record({
        sourcePath: reference,
        format: 'media',
        outcome: 'failed',
        name: m.name,
        target: { kind: 'media', id: m.id },
        counts: NO_COUNTS,
        message: 'Not in that folder.',
        issues: [
          {
            severity: 'warning',
            code: 'missing-media',
            message: `${m.name} is still missing.`,
            fix: { kind: 'relink-media', mediaId: m.id },
          },
        ],
      });
    } else {
      const result = await ctx.media.fillMissing(m.id, found.path, (from, to) => {
        repointMedia(ctx.db, from, to);
      });
      if (result.outcome === 'failed') {
        record({
          sourcePath: found.path,
          format: 'media',
          outcome: 'failed',
          name: m.name,
          target: { kind: 'media', id: m.id },
          counts: NO_COUNTS,
          message: result.issue.message,
          issues: [result.issue],
        });
      } else {
        record({
          sourcePath: found.path,
          format: 'media',
          outcome: 'imported',
          name: m.name,
          target: { kind: 'media', id: result.mediaId },
          counts: { ...NO_COUNTS, media: 1 },
          message: `Relinked to ${found.path}.`,
          issues: [],
        });
      }
    }
    done++;
  }
  const message = cancelled
    ? `Cancelled after ${done} of ${missing.length} missing files.`
    : missing.length === 0
      ? 'No media is missing.'
      : null;
  imports.finishRun(ctx.runId, cancelled ? 'cancelled' : 'done', totals, message);
  ctx.onProgress?.({ runId: ctx.runId, phase: 'finished', done, total: missing.length, current: null });
  const summary = imports.summary(ctx.runId);
  if (!summary) throw new Error('The relink run disappeared from the library.');
  return summary;
}
