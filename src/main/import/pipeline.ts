import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  ConflictChoice,
  ImportCounts,
  ImportTimings,
  ImportOptions,
  ImportProgress,
  ImportRunStatus,
  ImportRunSummary,
} from '../../shared/import';
import { emptyTotals, NO_COUNTS } from '../../shared/import';
import type { ImportSource } from '../../shared/library';
import { slideElementSchema } from '../../shared/model-schema';
import type { Db } from '../db/database';
import { addToTotals, ImportRepo, type NewImportItem } from '../db/imports';
import { type NewPresentation, PresentationRepo } from '../db/presentations';
import { parseLyricsText } from './formats/text';
import { formatBytes } from '../../shared/format';
import type { MediaStore } from './media-store';
import type { ParsedPresentation } from './model';
import { slideCount } from './model';
import { extOf, type ScannedFile, scanPaths } from './scan';

/*
 * One import run: find the files, read each into the intermediate model,
 * decide what to do with files imported before, and write each presentation
 * (with its report row) in one transaction. Runs in the import worker, never
 * in the main process, so the show keeps going during a big import.
 */

/** Lyrics files bigger than this are not read. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export interface PipelineContext {
  db: Db;
  media: MediaStore;
  runId: string;
  paths: readonly string[];
  options: ImportOptions;
  /** Library that new presentations go into. */
  libraryName?: string;
  /** Folders never to import from (Drashti's own data folder). */
  skipDir?: (dir: string) => boolean;
  onProgress?: (progress: ImportProgress) => void;
  /** After each presentation is committed. */
  onWrote?: (wrote: { presentationId: string; replaced: boolean }) => void;
  isCancelled?: () => boolean;
  /** Filled in with where the time went. */
  timings?: ImportTimings;
  /** Least time between progress reports (default 100 ms). */
  progressEveryMs?: number;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Drop elements the renderer would refuse to draw, and say so in the report. */
export function dropInvalidElements(parsed: ParsedPresentation): void {
  let dropped = 0;
  for (const group of parsed.groups) {
    for (const slide of group.slides) {
      const kept = slide.elements.filter((e) => slideElementSchema.safeParse(e).success);
      dropped += slide.elements.length - kept.length;
      slide.elements = kept;
    }
  }
  if (dropped > 0) {
    parsed.issues.push({
      severity: 'warning',
      code: 'invalid-element',
      message: `${dropped} slide element(s) could not be read and were left out.`,
      fix: null,
    });
  }
}

export function countsOf(parsed: ParsedPresentation): ImportCounts {
  return {
    ...NO_COUNTS,
    presentations: 1,
    groups: parsed.groups.length,
    slides: slideCount(parsed),
    arrangements: parsed.arrangements.length,
  };
}

export function toNewPresentation(
  parsed: ParsedPresentation,
  libraryId: string,
  source: ImportSource,
  hash: string,
): NewPresentation {
  return {
    libraryId,
    name: parsed.name,
    width: parsed.width,
    height: parsed.height,
    notes: parsed.notes,
    groups: parsed.groups.map((g) => ({
      name: g.name,
      color: g.color,
      slides: g.slides.map((s) => ({
        label: s.label,
        notes: s.notes,
        background: s.background,
        enabled: s.enabled,
        elements: s.elements,
      })),
    })),
    arrangements: parsed.arrangements,
    source,
    sourceHash: hash,
  };
}

const FORMAT_LABEL: Record<'pp6' | 'pp7', string> = { pp6: '.pro6', pp7: '.pro' };

export async function runImport(ctx: PipelineContext): Promise<ImportRunSummary> {
  const runStarted = performance.now();
  const timings = ctx.timings;
  /** Add the time since `from` to a phase; returns now. */
  const time = (phase: Exclude<keyof ImportTimings, 'total'>, from: number): number => {
    const now = performance.now();
    if (timings) timings[phase] += now - from;
    return now;
  };
  const imports = new ImportRepo(ctx.db);
  const presentations = new PresentationRepo(ctx.db);
  const totals = emptyTotals();
  const every = ctx.progressEveryMs ?? 100;
  let lastProgress = 0;
  const progress = (
    phase: ImportProgress['phase'],
    done: number,
    total: number,
    current: string | null,
    force = false,
  ) => {
    const now = Date.now();
    if (!force && now - lastProgress < every) return;
    lastProgress = now;
    ctx.onProgress?.({ runId: ctx.runId, phase, done, total, current });
  };

  let position = 0;
  /** Store an item's report row (and count it). */
  const record = (item: NewImportItem, files = 1) => {
    imports.addItem(ctx.runId, position++, item);
    addToTotals(totals, item, files);
  };
  /** Write content and its report row in one transaction. */
  const recordWrite = <T>(write: () => { item: NewImportItem; result: T }): T => {
    const at = position++;
    const out = ctx.db.transaction(() => {
      const written = write();
      imports.addItem(ctx.runId, at, written.item);
      return written;
    })();
    addToTotals(totals, out.item);
    return out.result;
  };

  let libraryId: string | null = null;
  const library = () => (libraryId ??= presentations.ensureLibrary(ctx.libraryName ?? 'Default'));

  const importText = async (file: ScannedFile) => {
    const fileName = basename(file.path);
    const base = { sourcePath: file.path, format: 'text' as const, counts: NO_COUNTS };
    if (file.size > MAX_TEXT_BYTES) {
      const message = `${fileName} is ${formatBytes(file.size)}. Lyrics files over 5 MB are not read.`;
      record({
        ...base,
        outcome: 'failed',
        name: fileName,
        target: null,
        message,
        issues: [{ severity: 'error', code: 'too-large', message, fix: null }],
      });
      return;
    }
    let t = performance.now();
    const bytes = await readFile(file.path);
    const hash = sha256(bytes);
    t = time('read', t);
    const earlier = presentations.findImported('text', null, file.path);
    const same =
      earlier.find((e) => e.sourceHash === hash) ??
      (earlier.length === 0 ? presentations.findByHash('text', hash) : null);
    time('lookup', t);
    if (same) {
      record({
        ...base,
        outcome: 'skipped',
        name: same.name,
        target: { kind: 'presentation', id: same.id },
        message:
          same.sourcePath === file.path
            ? 'Already in the library, unchanged since it was imported.'
            : `Already in the library: the same file was imported from ${same.sourcePath ?? 'another folder'}.`,
        issues: [],
      });
      return;
    }

    const latest = earlier[0] ?? null;
    let choice: ConflictChoice | null = null;
    if (latest) {
      const decided = ctx.options.decisions?.[file.path] ?? ctx.options.onConflict ?? 'ask';
      if (decided === 'ask') {
        record({
          ...base,
          outcome: 'conflict',
          name: latest.name,
          target: { kind: 'presentation', id: latest.id },
          message: `Changed since it was imported as “${latest.name}”.`,
          issues: [
            {
              severity: 'warning',
              code: 'changed-since-import',
              message: `${fileName} has changed since it was imported. Replace “${latest.name}” with the new version, or keep both?`,
              fix: { kind: 'choose', sourcePath: file.path },
            },
          ],
        });
        return;
      }
      if (decided === 'skip') {
        record({
          ...base,
          outcome: 'skipped',
          name: latest.name,
          target: { kind: 'presentation', id: latest.id },
          message: 'Changed since it was imported; the earlier import was kept, as chosen.',
          issues: [],
        });
        return;
      }
      choice = decided;
    }

    t = performance.now();
    const parsed = parseLyricsText(bytes, file.path);
    dropInvalidElements(parsed);
    t = time('parse', t);
    if (slideCount(parsed) === 0) {
      record({
        ...base,
        outcome: 'failed',
        name: parsed.name,
        target: null,
        message: parsed.issues.find((i) => i.severity === 'error')?.message ?? 'The file has no text.',
        issues: parsed.issues,
      });
      return;
    }
    const source: ImportSource = {
      kind: 'text',
      path: file.path,
      ref: null,
      importedAt: new Date().toISOString(),
    };
    const wrote = recordWrite(() => {
      const input = toNewPresentation(parsed, library(), source, hash);
      const counts = countsOf(parsed);
      if (choice === 'replace' && latest && presentations.replace(latest.id, input)) {
        return {
          item: {
            ...base,
            outcome: 'replaced' as const,
            name: latest.name,
            target: { kind: 'presentation' as const, id: latest.id },
            counts,
            message: 'Replaced the earlier import with the new version.',
            issues: parsed.issues,
          },
          result: { presentationId: latest.id, replaced: true },
        };
      }
      const name = presentations.uniqueName(library(), parsed.name);
      const id = presentations.insert({ ...input, name });
      return {
        item: {
          ...base,
          outcome: choice === 'keep-both' ? ('kept-both' as const) : ('imported' as const),
          name,
          target: { kind: 'presentation' as const, id },
          counts,
          message:
            choice === 'keep-both' && latest
              ? `Kept both; the earlier import is still “${latest.name}”.`
              : null,
          issues: parsed.issues,
        },
        result: { presentationId: id, replaced: false },
      };
    });
    time('write', t);
    ctx.onWrote?.(wrote);
  };

  const importMedia = async (file: ScannedFile) => {
    const started = performance.now();
    const result = await ctx.media.importFile(file.path, { kind: 'media', path: file.path });
    time('media', started);
    const base = { sourcePath: file.path, format: 'media' as const };
    if (result.outcome === 'failed') {
      record({
        ...base,
        outcome: 'failed',
        name: basename(file.path),
        target: null,
        counts: NO_COUNTS,
        message: result.issue.message,
        issues: [result.issue],
      });
      return;
    }
    record({
      ...base,
      outcome: result.outcome,
      name: result.name,
      target: { kind: 'media', id: result.mediaId },
      counts: result.outcome === 'imported' ? { ...NO_COUNTS, media: 1 } : NO_COUNTS,
      message: result.outcome === 'skipped' ? `Already in the media library as “${result.name}”.` : null,
      issues: [],
    });
  };

  imports.startRun(ctx.runId, ctx.paths, ctx.options);
  progress('scanning', 0, 0, null, true);
  const scanStarted = performance.now();
  const scan = await scanPaths(ctx.paths, { skip: ctx.skipDir });
  time('scan', scanStarted);
  for (const m of scan.missing) {
    record({
      sourcePath: m.path,
      format: 'unknown',
      outcome: 'failed',
      name: basename(m.path),
      target: null,
      counts: NO_COUNTS,
      message: m.message,
      issues: [
        {
          severity: 'error',
          code: 'not-found',
          message: `${m.path}: ${m.message}`,
          fix: { kind: 'import-again', sourcePath: m.path },
        },
      ],
    });
  }

  const unknown = new Map<string, string[]>();
  const total = scan.files.length;
  let done = 0;
  let status: ImportRunStatus = 'done';
  progress('importing', 0, total, null, true);
  for (const file of scan.files) {
    if (ctx.isCancelled?.()) {
      status = 'cancelled';
      break;
    }
    progress('importing', done, total, basename(file.path));
    try {
      switch (file.format) {
        case 'text':
          await importText(file);
          break;
        case 'media':
          await importMedia(file);
          break;
        case 'pp6':
        case 'pp7':
          record({
            sourcePath: file.path,
            format: file.format,
            outcome: 'unsupported',
            name: basename(file.path),
            target: null,
            counts: NO_COUNTS,
            message: `Files of type ${FORMAT_LABEL[file.format]} cannot be imported yet.`,
            issues: [],
          });
          break;
        default: {
          const ext = extOf(file.path);
          const list = unknown.get(ext) ?? [];
          list.push(file.path);
          unknown.set(ext, list);
        }
      }
    } catch (error) {
      record({
        sourcePath: file.path,
        format: file.format,
        outcome: 'failed',
        name: basename(file.path),
        target: null,
        counts: NO_COUNTS,
        message: `Could not import this file: ${error instanceof Error ? error.message : String(error)}`,
        issues: [],
      });
    }
    done++;
  }

  // Files Drashti does not read: one line per type, never dropped silently.
  for (const [ext, paths] of unknown) {
    const label = ext ? `.${ext}` : 'no extension';
    const examples = paths.slice(0, 5).map((p) => basename(p));
    record(
      {
        sourcePath: paths[0] ?? '',
        format: 'unknown',
        outcome: 'unsupported',
        name: ext ? `${label} files` : 'Files with no extension',
        target: null,
        counts: NO_COUNTS,
        message: `${paths.length === 1 ? '1 file' : `${paths.length.toLocaleString('en')} files`} (${label}) not imported: Drashti does not read this type. ${paths.length === 1 ? 'File' : 'For example'}: ${examples.join(', ')}${paths.length > examples.length ? ', …' : ''}.`,
        issues: [],
      },
      paths.length,
    );
  }

  const message =
    status === 'cancelled'
      ? `Cancelled after ${done} of ${total} files.`
      : scan.truncated
        ? `Stopped after ${total.toLocaleString('en')} files. Import the rest in smaller parts.`
        : null;
  imports.finishRun(ctx.runId, status, totals, message);
  if (timings) {
    for (const key of Object.keys(timings) as (keyof ImportTimings)[])
      timings[key] = Math.round(timings[key]);
    timings.total = Math.round(performance.now() - runStarted);
  }
  progress('finished', done, total, null, true);
  const summary = imports.summary(ctx.runId);
  if (!summary) throw new Error('The import run disappeared from the library.');
  return summary;
}
