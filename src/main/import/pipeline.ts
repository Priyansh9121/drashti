import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { formatBytes } from '../../shared/format';
import type {
  ConflictChoice,
  ImportCounts,
  ImportFormat,
  ImportIssue,
  ImportOptions,
  ImportProgress,
  ImportRunStatus,
  ImportRunSummary,
  ImportTimings,
} from '../../shared/import';
import { emptyTotals, NO_COUNTS } from '../../shared/import';
import type { ImportSource } from '../../shared/library';
import type { SlideElement } from '../../shared/model';
import { slideElementSchema } from '../../shared/model-schema';
import type { Db } from '../db/database';
import { addToTotals, ImportRepo, type NewImportItem } from '../db/imports';
import { type NewPlaylist, type NewPlaylistItem, PlaylistRepo } from '../db/playlists';
import { type NewPresentation, PresentationRepo } from '../db/presentations';
import { importedKirtan, readLatinLines } from './kirtan';
import { BatchWriter } from './batch';
import { parsePp6 } from './formats/pp6';
import { parsePp7, type Pp7Kind, pp7KindOf } from './formats/pp7';
import { parseLyricsText } from './formats/text';
import { diskFreeBytes, type MediaStore, type StagedMedia } from './media-store';
import { fileNameOf, pathFromReference, resolveMedia } from './media-resolver';
import type {
  ParsedMediaRef,
  ParsedPlaylist,
  ParsedPlaylistDoc,
  ParsedPresentation,
  ParsedProps,
} from './model';
import { MEDIA_REF, propsFromPresentation, slideCount } from './model';
import { PropRepo } from '../db/props';
import { SettingsRepo } from '../db/settings';
import { ShastraRepo } from '../db/shastra';
import { readShastraFile, SHASTRA_FORMAT } from '../../shared/shastra';
import { CalendarRepo } from '../db/calendar';
import { CALENDAR_FORMAT, readCalendarFile } from '../../shared/calendar';

/** "1 day", "182 days". */
const counted = (n: number, one: string): string => `${n.toLocaleString('en')} ${one}${n === 1 ? '' : 's'}`;
import { TRANSLIT_STYLES, type TranslitStyle } from '../../shared/translit';
import { unplayableIssue } from './probe';
import { extOf, formatOf, type ScannedFile, scanPaths } from './scan';
import type { PicturesResult } from '../../shared/pictures';
import { pictureSourceOf } from '../../shared/pictures';
import {
  type Converter,
  convertToPdf,
  converterFor,
  findConverters,
  noConverterMessage,
  notesForPages,
  picturesIssues,
  picturesPresentation,
  type PptxSlide,
  readPptx,
} from './pictures';
import { extractZip } from './zip';

/*
 * One import run (PLAN.md 4.4): find the files, read each into the
 * intermediate model, decide what to do with files imported before, find and
 * copy the media they use, and write them with their report lines. Runs in
 * the import worker, never in the main process, so the show keeps going.
 *
 * Writes go in small groups (BatchWriter): on the Windows CI runner nearly
 * all the time went to commits. Each file is its own savepoint inside a
 * group, so one bad file never costs the others.
 */

/** Lyrics files bigger than this are not read. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
/** PDF, PowerPoint and Keynote files bigger than this are not made into pictures. */
export const MAX_PICTURES_BYTES = 1024 * 1024 * 1024;
/** Presentation and playlist files bigger than this are not read (they are XML or protobuf, not media). */
export const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024;
/** Inside a bundle, a file's source path is the bundle's path, this, and the file's path inside it. */
export const BUNDLE_SEP = '!/';

export interface PipelineContext {
  db: Db;
  media: MediaStore;
  runId: string;
  paths: readonly string[];
  options: ImportOptions;
  /** Library that new presentations go into (templates go to "Templates"). */
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
  /** Commit a group of writes once it has been open this long (default 250 ms). */
  batchBudgetMs?: number;
  /** Where bundles are unpacked (default: the system's temporary folder). */
  tempDir?: string;
  /** Draws a PDF's pages as pictures (the main process does, in a window; Session 15). */
  drawPdf?: (pdf: string, outDir: string) => Promise<PicturesResult>;
  /** Whether Keynote or PowerPoint may save PowerPoint and Keynote files as PDF (default yes). */
  converters?: boolean;
}

type SourceKind = 'text' | 'pp6' | 'pp7' | 'pictures';

/** Where a file is being imported from, and where to look for what it names. */
interface Where {
  /** The item's source path: the file, or `bundle!/inner/path` for a file inside a bundle. */
  sourcePath: string;
  /** Folders to look in first for media the file names (its own folder, a bundle's folder). */
  nearby: string[];
  /** Media files found by name in the folders being imported. */
  mediaByName: ReadonlyMap<string, readonly string[]>;
  /** Presentation files found by name, for playlists that name them. */
  docsByName: ReadonlyMap<string, readonly ScannedFile[]>;
  /** Inside a bundle of this kind (a .proplaylist keeps its playlist in a file called "data"). */
  bundle?: 'pp6' | 'pp7';
}

/** Files that come with the older app but are not presentations: said plainly in the report. */
const SUPPORT_FILES: Record<string, { format: ImportFormat; message: string }> = {
  'mask.pro6': {
    format: 'pp6',
    message: 'Masks come in a later version of Drashti; set them up again from the audit.',
  },
  'messages.xml': {
    format: 'unknown',
    message: 'Messages are set up again in Drashti (see the audit report).',
  },
  'clocks.xml': { format: 'unknown', message: 'Timers are set up again in Drashti (see the audit report).' },
  'stagedisplaylayouts.xml': {
    format: 'unknown',
    message: 'Stage display layouts are set up again in Drashti (see the audit report).',
  },
  'cclidata.txt': { format: 'text', message: 'CCLI reporting data, not lyrics: not imported.' },
  librarydata: { format: 'pp7', message: 'Library settings, not a presentation: not imported.' },
};
const SUPPORT_EXTENSIONS: Record<string, string> = { pro6dvd: 'DVD clip lists are not imported.' };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A big file's sha256, read a piece at a time. */
async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 }))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** How transliteration is made (the setting kirtans use too): plain letters until the operator chooses marks. */
function storedTranslitStyle(db: Db): TranslitStyle {
  const value = new SettingsRepo(db).get('translitStyle');
  return (TRANSLIT_STYLES as readonly unknown[]).includes(value) ? (value as TranslitStyle) : 'plain';
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const normalizePath = (p: string) => p.replace(/\\/gu, '/').toLowerCase();

/** Presentations first, then media, then bundles, and playlists last (they name presentations). */
export function importOrder(file: ScannedFile): number {
  const ext = extOf(file.path);
  const pp7 = file.format === 'pp7' ? pp7KindOf(file.path) : null;
  if (pp7 === 'playlist') return 3;
  if (file.format === 'text' || ext === 'pro6' || ext === 'pro6template' || pp7 !== null) return 0;
  if (file.format === 'media') return 1;
  // PDF, PowerPoint and Keynote files take a while (saved as PDF, drawn): after the quick ones.
  if (ext === 'pro6x' || ext === 'probundle' || file.format === 'pictures') return 2;
  if (ext === 'pro6pl' || ext === 'pro6plx' || ext === 'proplaylist') return 3;
  return 4;
}

const sortForImport = (files: readonly ScannedFile[]) =>
  files
    .map((file, i) => ({ file, i }))
    .sort((a, b) => importOrder(a.file) - importOrder(b.file) || a.i - b.i)
    .map((x) => x.file);

export function countsOf(parsed: ParsedPresentation): ImportCounts {
  return {
    ...NO_COUNTS,
    presentations: 1,
    groups: parsed.groups.length,
    slides: slideCount(parsed),
    arrangements: parsed.arrangements.length,
  };
}

/**
 * The rows to write for a parsed presentation, with media references filled
 * in from `mediaIds`. Leaves `parsed` untouched (a group may be written twice).
 * Elements the renderer would refuse are left out and counted.
 */
export function toNewPresentation(
  parsed: ParsedPresentation,
  libraryId: string,
  source: ImportSource,
  hash: string,
  mediaIds: readonly string[] = [],
): { input: NewPresentation; dropped: number } {
  let dropped = 0;
  const media = (ref: string) =>
    ref.startsWith(MEDIA_REF) ? (mediaIds[Number(ref.slice(MEDIA_REF.length))] ?? null) : ref;
  const element = (e: SlideElement): SlideElement[] => {
    let el: SlideElement | null = e;
    if (e.kind === 'image' || e.kind === 'video') {
      const id = media(e.mediaId);
      el = id ? { ...e, mediaId: id } : null;
    }
    if (!el || !slideElementSchema.safeParse(el).success) {
      dropped++;
      return [];
    }
    return [el];
  };
  const input: NewPresentation = {
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
        elements: s.elements.flatMap(element),
        cues: s.cues.map((c) => ({
          kind: c.kind,
          label: c.label,
          mediaId: c.media === null ? null : (mediaIds[c.media] ?? null),
          props: c.props,
        })),
        transition: s.transition ?? null,
        autoAdvanceMs: s.autoAdvanceMs ?? null,
      })),
    })),
    arrangements: parsed.arrangements,
    selectedArrangement: parsed.selectedArrangement,
    transition: parsed.transition ?? null,
    loop: parsed.loop ?? false,
    source,
    sourceHash: hash,
  };
  return { input, dropped };
}

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
  const playlists = new PlaylistRepo(ctx.db);
  const batch = new BatchWriter(ctx.db, { budgetMs: ctx.batchBudgetMs ?? 250 });
  const commit = () => {
    const t = performance.now();
    batch.commit();
    time('commit', t);
  };
  const maybeCommit = () => {
    const t = performance.now();
    batch.maybeCommit();
    time('commit', t);
  };
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
  /** A report line (written in the open group; counted once committed). */
  const record = (item: NewImportItem, files = 1, at = position++) => {
    batch.write(
      () => {
        imports.addItem(ctx.runId, at, item);
      },
      {
        committed: () => {
          addToTotals(totals, item, files);
        },
      },
    );
  };
  const failed = (
    where: Where,
    format: ImportFormat,
    name: string,
    message: string,
    issues: ImportIssue[] = [],
    at?: number,
  ) => {
    record(
      {
        sourcePath: where.sourcePath,
        format,
        outcome: 'failed',
        name,
        target: null,
        counts: NO_COUNTS,
        message,
        issues,
      },
      1,
      at,
    );
  };

  /** Presentations written in this run, to find the ones playlists name. */
  const written = { byPath: new Map<string, string>(), byName: new Map<string, string>() };
  const remember = (where: Where, file: ScannedFile, id: string) => {
    written.byPath.set(normalizePath(where.sourcePath), id);
    written.byName.set(basename(file.path).toLowerCase(), id);
  };

  // ---- media ------------------------------------------------------------------

  interface Staged {
    ref: ParsedMediaRef;
    staged: StagedMedia | null;
    /** Why it could not be copied, when it was found. */
    issue: ImportIssue | null;
  }

  /** Find each media file a document names and copy it into the media folder (no database work). */
  const stageMedia = async (refs: readonly ParsedMediaRef[], where: Where): Promise<Staged[]> => {
    if (refs.length === 0) return [];
    // Never keep a group of writes (and its lock) open while copying media.
    commit();
    const out: Staged[] = [];
    for (const ref of refs) {
      const t = performance.now();
      const found = resolveMedia(ref.originalPath, { nearby: where.nearby, byName: where.mediaByName });
      if (!found) {
        out.push({ ref, staged: null, issue: null });
        continue;
      }
      const stage = await ctx.media.stage(found.path);
      time('media', t);
      out.push(
        stage.ok ? { ref, staged: stage.staged, issue: null } : { ref, staged: null, issue: stage.issue },
      );
    }
    return out;
  };

  /** The library rows for staged media (inside a group): ids by reference, and what is missing. */
  const storeMedia = (staged: readonly Staged[], kind: SourceKind) => {
    const ids: string[] = [];
    const issues: ImportIssue[] = [];
    let marked = 0;
    for (const s of staged) {
      // A page drawn from a document is a picture Drashti made, from that page.
      const source = {
        kind: kind === 'pictures' ? ('drashti' as const) : kind,
        path: s.ref.sourcePath ?? s.ref.originalPath,
      };
      if (s.staged) {
        const stored = ctx.media.addStaged(s.staged, source);
        ids.push(stored.mediaId);
        if (s.ref.markers && ctx.media.keepMarkers(stored.mediaId, s.ref.markers)) marked++;
        if (stored.probe.playable === false)
          issues.push(unplayableIssue(s.staged.name, stored.probe, stored.mediaId));
        continue;
      }
      const id = ctx.media.addMissing(s.ref.originalPath, s.ref.kind, source);
      ids.push(id);
      if (s.issue) issues.push(s.issue);
      issues.push({
        severity: 'warning',
        code: 'missing-media',
        message: `Missing media: ${fileNameOf(s.ref.originalPath)} was not at its original path, next to the file or in the imported folders.`,
        fix: { kind: 'relink-media', mediaId: id },
      });
    }
    if (marked > 0)
      issues.push({
        severity: 'info',
        code: 'markers-read',
        message: `Start and end points or markers were read for ${String(marked)} video(s) or sound(s). The older formats' markers follow the community notes on them and are not yet checked against real files: look them over (the media item's Markers).`,
        fix: null,
      });
    return { ids, issues, count: ids.length };
  };

  // ---- presentations ----------------------------------------------------------------

  /** An earlier import of the same file decides what happens to this one: null when it is done with. */
  interface Decided {
    latest: { id: string; name: string } | null;
    choice: ConflictChoice | null;
  }

  /**
   * Whether a presentation file goes ahead: unchanged since it was imported (skipped), changed (the
   * operator chooses, or has chosen), or new. Recorded when it goes no further.
   */
  const decideEarlier = (
    file: ScannedFile,
    where: Where,
    kind: SourceKind,
    ref: string | null,
    hash: string,
  ): Decided | null => {
    const fileName = basename(file.path);
    const base = { sourcePath: where.sourcePath, format: kind, counts: NO_COUNTS };
    const t = performance.now();
    const earlier = presentations.findImported(kind, ref, where.sourcePath);
    const same =
      earlier.find((e) => e.sourceHash === hash) ??
      (earlier.length === 0 ? presentations.findByHash(kind, hash) : null);
    time('lookup', t);
    if (same) {
      record({
        ...base,
        outcome: 'skipped',
        name: same.name,
        target: { kind: 'presentation', id: same.id },
        message:
          same.sourcePath === where.sourcePath
            ? 'Already in the library, unchanged since it was imported.'
            : `Already in the library: the same file was imported from ${same.sourcePath ?? 'another folder'}.`,
        issues: [],
      });
      remember(where, file, same.id);
      return null;
    }
    const latest = earlier[0] ?? null;
    let choice: ConflictChoice | null = null;
    if (latest) {
      const decided = ctx.options.decisions?.[where.sourcePath] ?? ctx.options.onConflict ?? 'ask';
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
              fix: { kind: 'choose', sourcePath: where.sourcePath },
            },
          ],
        });
        remember(where, file, latest.id);
        return null;
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
        remember(where, file, latest.id);
        return null;
      }
      choice = decided;
    }
    return { latest, choice };
  };

  const importPresentation = async (
    file: ScannedFile,
    where: Where,
    kind: SourceKind,
    hash: string,
    parsed: ParsedPresentation,
    decidedAlready?: Decided,
  ) => {
    const base = { sourcePath: where.sourcePath, format: kind, counts: NO_COUNTS };
    const decided = decidedAlready ?? decideEarlier(file, where, kind, parsed.ref, hash);
    if (!decided) return;
    const { latest, choice } = decided;
    if (kind === 'text' && slideCount(parsed) === 0) {
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
    const staged = await stageMedia(parsed.media, where);
    const source: ImportSource = {
      kind,
      path: where.sourcePath,
      ref: parsed.ref,
      importedAt: new Date().toISOString(),
    };
    const at = position++;
    const result = batch.write(
      () => {
        const started = performance.now();
        const media = storeMedia(staged, kind);
        const libraryId = presentations.ensureLibrary(parsed.library ?? ctx.libraryName ?? 'Default');
        const { input, dropped } = toNewPresentation(parsed, libraryId, source, hash, media.ids);
        // A kirtan laid out a box per language: its plain transliteration is told from English by reading.
        for (const g of input.groups) for (const sl of g.slides) sl.elements = readLatinLines(sl.elements);
        const issues = [...parsed.issues, ...media.issues];
        // A kirtan: from its author field, or its lines in Gujarati or Hindi with another language.
        const kirtan = importedKirtan(parsed.kavi ?? null, input.groups);
        // Importing it again keeps the details the operator gave it (filling in a kavi it lacked).
        const kept = choice === 'replace' && latest ? presentations.kirtanDetails(latest.id) : null;
        if (kept) input.kirtan = { ...kept, kavi: kept.kavi ?? kirtan?.details.kavi ?? null };
        else if (kirtan) input.kirtan = kirtan.details;
        if (kirtan) issues.push(kirtan.issue);
        if (dropped > 0) {
          issues.push({
            severity: 'warning',
            code: 'invalid-element',
            message: `${dropped} slide element(s) could not be read and were left out.`,
            fix: null,
          });
        }
        const counts = { ...countsOf(parsed), media: media.count };
        let item: NewImportItem;
        let wrote: { presentationId: string; replaced: boolean };
        if (choice === 'replace' && latest && presentations.replace(latest.id, input)) {
          item = {
            ...base,
            outcome: 'replaced',
            name: latest.name,
            target: { kind: 'presentation', id: latest.id },
            counts,
            message: 'Replaced the earlier import with the new version.',
            issues,
          };
          wrote = { presentationId: latest.id, replaced: true };
        } else {
          const name = presentations.uniqueName(libraryId, parsed.name);
          const id = presentations.insert({ ...input, name });
          item = {
            ...base,
            outcome: choice === 'keep-both' ? 'kept-both' : 'imported',
            name,
            target: { kind: 'presentation', id },
            counts,
            message:
              choice === 'keep-both' && latest
                ? `Kept both; the earlier import is still “${latest.name}”.`
                : null,
            issues,
          };
          wrote = { presentationId: id, replaced: false };
        }
        imports.addItem(ctx.runId, at, item);
        time('write', started);
        return { item, wrote };
      },
      {
        committed: ({ item, wrote }) => {
          addToTotals(totals, item);
          ctx.onWrote?.(wrote);
        },
        failed: (error) => {
          failed(where, kind, parsed.name, `Could not write this presentation: ${errorText(error)}`, [], at);
        },
      },
    );
    if (result) remember(where, file, result.wrote.presentationId);
  };

  /**
   * A PDF, PowerPoint or Keynote file as pictures (Session 15): saved as PDF by Keynote or PowerPoint
   * when it is not one, its pages drawn by the main process, then one slide per page.
   */
  const importPictures = async (file: ScannedFile, where: Where) => {
    const fileName = basename(file.path);
    const source = pictureSourceOf(extOf(file.path));
    const fail = (code: string, message: string) => {
      failed(where, 'pictures', fileName, message, [{ severity: 'error', code, message, fix: null }]);
    };
    if (!source || !ctx.drawPdf) {
      fail('pictures-unavailable', 'Drashti cannot make pictures of this file here.');
      return;
    }
    if (file.size > MAX_PICTURES_BYTES) {
      fail(
        'too-large',
        `${fileName} is ${formatBytes(file.size)}: files over 1 GB are not made into pictures.`,
      );
      return;
    }
    let t = performance.now();
    const hash = await fileSha256(file.path);
    time('read', t);
    // Unchanged since it was imported, or waiting for the operator's choice: nothing to draw.
    const decided = decideEarlier(file, where, 'pictures', null, hash);
    if (!decided) return;
    const work = await mkdtemp(join(ctx.tempDir ?? tmpdir(), 'drashti-pictures-'));
    try {
      let pdf = file.path;
      let converter: Converter | null = null;
      let slides: PptxSlide[] | null = null;
      if (source === 'pptx') {
        try {
          slides = await readPptx(file.path);
        } catch {
          // Its own slides cannot be read here: whatever saves it as PDF may still read it.
        }
      }
      if (source !== 'pdf') {
        converter =
          ctx.converters === false ? null : converterFor(source, process.platform, await findConverters());
        if (!converter) {
          fail('pictures-no-converter', noConverterMessage(source));
          return;
        }
        t = performance.now();
        const converted = await convertToPdf(converter, file.path, work);
        time('parse', t);
        if (!converted.ok) {
          fail('pictures-not-converted', converted.message);
          return;
        }
        pdf = converted.pdf;
        // The file's own notes when it could be read; otherwise what the converter told.
        if (!slides?.some((sl) => sl.notes !== '') && converted.slides) slides = converted.slides;
      }
      t = performance.now();
      const drawn = await ctx.drawPdf(pdf, join(work, 'pages'));
      time('parse', t);
      if (!drawn.ok) {
        fail('pictures-not-drawn', drawn.message);
        return;
      }
      const notes = slides ? notesForPages(slides, drawn.total) : null;
      const parsed = picturesPresentation(
        fileName,
        drawn,
        drawn.pages.map((p) => notes?.[p.index] ?? ''),
      );
      parsed.media = parsed.media.map((m, i) => ({
        ...m,
        sourcePath: `${where.sourcePath}#page=${String((drawn.pages[i]?.index ?? i) + 1)}`,
      }));
      const shown = slides?.filter((sl) => !sl.hidden) ?? [];
      parsed.issues = picturesIssues({
        source,
        converter,
        pages: drawn.pages.length,
        total: drawn.total,
        failed: drawn.failed,
        withNotes: parsed.groups.flatMap((g) => g.slides).filter((sl) => sl.notes !== '').length,
        animated: shown.filter((sl) => sl.animated).length,
        notesUnmatched: slides !== null && notes === null && slides.some((sl) => sl.notes !== ''),
      });
      await importPresentation(file, where, 'pictures', hash, parsed, decided);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  };

  const importText = async (file: ScannedFile, where: Where) => {
    const fileName = basename(file.path);
    if (file.size > MAX_TEXT_BYTES) {
      const message = `${fileName} is ${formatBytes(file.size)}. Lyrics files over 5 MB are not read.`;
      failed(where, 'text', fileName, message, [
        { severity: 'error', code: 'too-large', message, fix: null },
      ]);
      return;
    }
    let t = performance.now();
    const bytes = await readFile(file.path);
    const hash = sha256(bytes);
    t = time('read', t);
    const parsed = parseLyricsText(bytes, file.path);
    time('parse', t);
    await importPresentation(file, where, 'text', hash, parsed);
  };

  // ---- playlists ----------------------------------------------------------------------

  /** The presentation a playlist names: imported in this run, or earlier, or found now and imported. */
  const presentationFor = async (
    named: { path: string | null; name: string },
    kind: SourceKind,
    where: Where,
  ): Promise<string | null> => {
    // Playlists store paths as file URLs or percent-encoded paths: compare real paths.
    const item = { ...named, path: named.path ? pathFromReference(named.path) : null };
    const known = () => {
      if (item.path) {
        const byPath = written.byPath.get(normalizePath(item.path));
        if (byPath) return byPath;
        const byName = written.byName.get(fileNameOf(item.path).toLowerCase());
        if (byName) return byName;
        return presentations.findBySourceFile(kind, item.path);
      }
      return null;
    };
    const id = known();
    if (id || !item.path) return id;
    // Not imported yet: look for the file (its original path, then by name in the imported folders).
    const name = fileNameOf(item.path).toLowerCase();
    const candidates = [item.path, ...(where.docsByName.get(name) ?? []).map((f) => f.path)];
    for (const path of candidates) {
      let size: number;
      try {
        const s = await stat(path);
        if (!s.isFile()) continue;
        size = s.size;
      } catch {
        continue;
      }
      const file: ScannedFile = { path, size, format: formatOf(path) };
      await importOne(file, { ...where, sourcePath: path, nearby: [dirname(path), ...where.nearby] });
      return known();
    }
    return null;
  };

  const importPlaylist = async (where: Where, kind: SourceKind, hash: string, doc: ParsedPlaylistDoc) => {
    const base = { sourcePath: where.sourcePath, format: kind, counts: NO_COUNTS };
    const earlier = playlists.findImported(kind, where.sourcePath);
    if (earlier.length > 0 && earlier.every((e) => e.hash === hash)) {
      record({
        ...base,
        outcome: 'skipped',
        name: doc.name,
        target: { kind: 'playlist', id: earlier[0]?.id ?? '' },
        message: 'Already in the library, unchanged since it was imported.',
        issues: [],
      });
      return;
    }
    // The presentations it names come first (they may need importing now).
    const issues: ImportIssue[] = [...doc.issues];
    const resolved = new Map<ParsedPlaylist['items'][number], string | null>();
    const walk = async (lists: readonly ParsedPlaylist[]) => {
      for (const list of lists) {
        for (const item of list.items) {
          if (item.kind !== 'presentation') continue;
          const id = await presentationFor(item, kind, where);
          resolved.set(item, id);
          if (!id) {
            issues.push({
              severity: 'warning',
              code: 'missing-presentation',
              message: `“${item.name}” is in the playlist, but its file was not found${item.path ? ` (${fileNameOf(item.path)})` : ''}. Import it, then import the playlist again.`,
              fix: { kind: 'import-again', sourcePath: where.sourcePath },
            });
          }
        }
        await walk(list.children);
      }
    };
    await walk(doc.playlists);
    const staged = await stageMedia(doc.media, where);
    const source: ImportSource = {
      kind,
      path: where.sourcePath,
      ref: null,
      importedAt: new Date().toISOString(),
    };
    const at = position++;
    batch.write(
      () => {
        const started = performance.now();
        const media = storeMedia(staged, kind);
        const convert = (list: ParsedPlaylist): NewPlaylist => ({
          name: list.name,
          isFolder: list.isFolder,
          ref: list.ref,
          children: list.children.map(convert),
          items: list.items.map((item): NewPlaylistItem => {
            switch (item.kind) {
              case 'presentation': {
                const id = resolved.get(item) ?? null;
                return id
                  ? {
                      kind: 'presentation',
                      presentationId: id,
                      label: item.name,
                      arrangementRef: item.arrangementRef,
                    }
                  : {
                      kind: 'placeholder',
                      label: item.name,
                      hint: 'Not found when the playlist was imported.',
                    };
              }
              case 'media': {
                const id = media.ids[item.media];
                return id
                  ? { kind: 'media', mediaId: id, label: item.name }
                  : { kind: 'placeholder', label: item.name, hint: 'Media not found.' };
              }
              case 'header':
                return { kind: 'header', label: item.name, color: item.color };
              case 'placeholder':
                return { kind: 'placeholder', label: item.name, hint: item.hint };
            }
          }),
        });
        if (earlier.length > 0) playlists.removeImported(kind, where.sourcePath);
        const counts = playlists.insertTree(doc.playlists.map(convert), source, hash);
        const item: NewImportItem = {
          ...base,
          outcome: earlier.length > 0 ? 'replaced' : 'imported',
          name: doc.name,
          target: counts.ids[0] ? { kind: 'playlist', id: counts.ids[0] } : null,
          counts: { ...NO_COUNTS, playlists: counts.playlists, media: media.count },
          message: earlier.length > 0 ? 'Updated from the changed file.' : null,
          issues: [...issues, ...media.issues],
        };
        imports.addItem(ctx.runId, at, item);
        time('write', started);
        return item;
      },
      {
        committed: (item) => {
          addToTotals(totals, item);
        },
        failed: (error) => {
          failed(where, kind, doc.name, `Could not write this playlist: ${errorText(error)}`, [], at);
        },
      },
    );
  };

  /** Props from a props file: each one kept in the library, replacing those from the same file before. */
  const importProps = async (where: Where, kind: 'pp6' | 'pp7', parsed: ParsedProps) => {
    const name = basename(where.sourcePath);
    const staged = await stageMedia(parsed.media, where);
    const at = position++;
    batch.write(
      () => {
        const started = performance.now();
        const media = storeMedia(staged, kind);
        let dropped = 0;
        const props = parsed.props.map((p) => ({
          name: p.name,
          ref: p.ref,
          width: parsed.width,
          height: parsed.height,
          elements: p.elements.flatMap((e): SlideElement[] => {
            let el: SlideElement | null = e;
            if (e.kind === 'image' || e.kind === 'video') {
              const id = e.mediaId.startsWith(MEDIA_REF)
                ? media.ids[Number(e.mediaId.slice(MEDIA_REF.length))]
                : null;
              el = id ? { ...e, mediaId: id } : null;
            }
            if (!el || !slideElementSchema.safeParse(el).success) {
              dropped++;
              return [];
            }
            return [el];
          }),
        }));
        const kept = props.filter((p) => p.elements.length > 0);
        const ids = new PropRepo(ctx.db).replaceImported(kind, where.sourcePath, kept);
        const issues = [...parsed.issues, ...media.issues];
        if (dropped > 0)
          issues.push({
            severity: 'warning',
            code: 'invalid-element',
            message: `${dropped} prop element(s) could not be read and were left out.`,
            fix: null,
          });
        const item: NewImportItem = {
          sourcePath: where.sourcePath,
          format: kind,
          outcome: 'imported',
          name,
          target: null,
          counts: { ...NO_COUNTS, media: media.count },
          message:
            ids.length > 0
              ? `${ids.length} prop${ids.length === 1 ? '' : 's'}: show them from Props, under the live picture.`
              : 'No props with anything on them.',
          issues,
        };
        imports.addItem(ctx.runId, at, item);
        time('write', started);
        return item;
      },
      {
        committed: (item) => {
          addToTotals(totals, item);
        },
        failed: (error) => {
          failed(where, kind, name, `Could not write these props: ${errorText(error)}`, [], at);
        },
      },
    );
  };

  // ---- one file ---------------------------------------------------------------------

  const importPp6 = async (file: ScannedFile, where: Where) => {
    if (file.size > MAX_DOCUMENT_BYTES) {
      failed(
        where,
        'pp6',
        basename(file.path),
        `${basename(file.path)} is ${formatBytes(file.size)}, too big to be a presentation.`,
      );
      return;
    }
    let t = performance.now();
    const bytes = await readFile(file.path);
    const hash = sha256(bytes);
    t = time('read', t);
    let parsed;
    try {
      parsed = parsePp6(bytes, file.path);
    } catch (error) {
      failed(where, 'pp6', basename(file.path), `Not a readable .pro6 file: ${errorText(error)}`);
      return;
    }
    time('parse', t);
    if (parsed.kind === 'presentation' && basename(file.path).toLowerCase() === 'props.pro6')
      await importProps(where, 'pp6', propsFromPresentation(parsed.presentation));
    else if (parsed.kind === 'presentation')
      await importPresentation(file, where, 'pp6', hash, parsed.presentation);
    else if (parsed.kind === 'playlist') await importPlaylist(where, 'pp6', hash, parsed.playlist);
    else {
      record({
        sourcePath: where.sourcePath,
        format: 'pp6',
        outcome: 'unsupported',
        name: basename(file.path),
        target: null,
        counts: NO_COUNTS,
        message: `Not a presentation or playlist (it holds ${parsed.root}).`,
        issues: [],
      });
    }
  };

  const PP7_LABEL: Record<Pp7Kind, string> = {
    presentation: '.pro file',
    playlist: 'playlist file',
    template: 'theme',
    props: 'props file',
  };

  const importPp7 = async (file: ScannedFile, where: Where, kind: Pp7Kind | null) => {
    if (!kind) {
      record({
        sourcePath: where.sourcePath,
        format: 'pp7',
        outcome: 'unsupported',
        name: basename(file.path),
        target: null,
        counts: NO_COUNTS,
        message: 'Not a presentation, playlist or theme file.',
        issues: [],
      });
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      failed(
        where,
        'pp7',
        basename(file.path),
        `${basename(file.path)} is ${formatBytes(file.size)}, too big to be a presentation.`,
      );
      return;
    }
    let t = performance.now();
    const bytes = await readFile(file.path);
    const hash = sha256(bytes);
    t = time('read', t);
    // A .proplaylist keeps its playlist in a file called "data": name it after the bundle.
    const namePath =
      where.bundle === 'pp7' && basename(file.path) === 'data'
        ? (where.sourcePath.split(BUNDLE_SEP)[0] ?? file.path)
        : file.path;
    let parsed;
    try {
      parsed = parsePp7(bytes, namePath, kind);
    } catch (error) {
      failed(where, 'pp7', basename(file.path), `Not a readable ${PP7_LABEL[kind]}: ${errorText(error)}`);
      return;
    }
    time('parse', t);
    if (parsed.kind === 'presentation')
      await importPresentation(file, where, 'pp7', hash, parsed.presentation);
    else if (parsed.kind === 'props') await importProps(where, 'pp7', parsed.props);
    else await importPlaylist(where, 'pp7', hash, parsed.playlist);
  };

  const importMedia = async (file: ScannedFile, where: Where) => {
    const t = performance.now();
    const stage = await ctx.media.stage(file.path);
    time('media', t);
    if (!stage.ok) {
      failed(where, 'media', basename(file.path), stage.issue.message, [stage.issue]);
      return;
    }
    const at = position++;
    batch.write(
      () => {
        const result = ctx.media.addStaged(stage.staged, { kind: 'media', path: file.path });
        const item: NewImportItem = {
          sourcePath: where.sourcePath,
          format: 'media',
          outcome: result.outcome,
          name: result.name,
          target: { kind: 'media', id: result.mediaId },
          counts: result.outcome === 'imported' ? { ...NO_COUNTS, media: 1 } : NO_COUNTS,
          message: result.outcome === 'skipped' ? `Already in the media library as “${result.name}”.` : null,
          issues:
            result.probe.playable === false
              ? [unplayableIssue(basename(file.path), result.probe, result.mediaId)]
              : [],
        };
        imports.addItem(ctx.runId, at, item);
        return item;
      },
      {
        committed: (item) => {
          addToTotals(totals, item);
        },
        failed: (error) => {
          failed(where, 'media', basename(file.path), `Could not add this file: ${errorText(error)}`, [], at);
        },
      },
    );
  };

  const docsIndex = (files: readonly ScannedFile[]) => {
    const map = new Map<string, ScannedFile[]>();
    for (const f of files) {
      if (f.format !== 'pp6' && f.format !== 'pp7' && f.format !== 'text') continue;
      const key = basename(f.path).toLowerCase();
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return map;
  };

  const importBundle = async (file: ScannedFile, where: Where, kind: 'pp6' | 'pp7') => {
    commit();
    const temp = await mkdtemp(join(ctx.tempDir ?? tmpdir(), 'drashti-bundle-'));
    try {
      let extracted;
      try {
        extracted = await extractZip(file.path, temp, {
          maxBytes: Math.max(0, diskFreeBytes(temp) - 2 * 1024 ** 3),
        });
      } catch (error) {
        failed(where, kind, basename(file.path), `Could not open the bundle: ${errorText(error)}`);
        return;
      }
      const inner = await scanPaths([temp]);
      const docs = docsIndex(inner.files);
      for (const f of sortForImport(inner.files)) {
        if (ctx.isCancelled?.()) break;
        const rel = relative(temp, f.path).split(sep).join('/');
        await importOne(f, {
          sourcePath: `${where.sourcePath}${BUNDLE_SEP}${rel}`,
          nearby: [dirname(f.path), temp],
          mediaByName: inner.mediaByName,
          docsByName: docs,
          bundle: kind,
        });
        maybeCommit();
      }
      if (extracted.skipped.length > 0) {
        failed(
          where,
          kind,
          basename(file.path),
          'Some files in the bundle were not read.',
          extracted.skipped.map((s) => ({
            severity: 'warning' as const,
            code: 'bundle-entry',
            message: `${s.name}: ${s.reason}.`,
            fix: null,
          })),
        );
      }
    } finally {
      // Staged media is already copied into the media folder; the unpacked files can go.
      commit();
      await rm(temp, { recursive: true, force: true });
    }
  };

  // ---- what an admin loads: Shastra texts (and, later, calendars and quotes) -------------------

  const importShastra = (where: Where, fileName: string, hash: string, raw: unknown) => {
    const read = readShastraFile(raw);
    if (!read.ok) {
      failed(where, 'shastra', fileName, read.message);
      return;
    }
    const text = read.text;
    const at = position++;
    batch.write(
      () => {
        const started = performance.now();
        const loaded = new ShastraRepo(ctx.db).load(
          text,
          { path: where.sourcePath, hash },
          storedTranslitStyle(ctx.db),
        );
        const issues: ImportIssue[] = read.notes.map((n) => ({
          severity: n.severity,
          code: 'shastra-note',
          message: n.message,
          fix: null,
        }));
        if (loaded.made.translit > 0 || loaded.made.script > 0)
          issues.push({
            severity: 'info',
            code: 'shastra-made',
            message: [
              loaded.made.translit > 0 ? `transliteration for ${loaded.made.translit} items` : '',
              loaded.made.script > 0 ? `Sanskrit in its other script for ${loaded.made.script} items` : '',
            ]
              .filter((x) => x !== '')
              .join(' and ')
              .replace(/^./u, (c) => c.toUpperCase())
              .concat(' made by Drashti (marked as made).'),
            fix: null,
          });
        const first = text.items[0]?.number ?? text.sections[0]?.items[0]?.number ?? 1;
        const item: NewImportItem = {
          sourcePath: where.sourcePath,
          format: 'shastra',
          outcome:
            loaded.outcome === 'added' ? 'imported' : loaded.outcome === 'updated' ? 'replaced' : 'skipped',
          name: `${text.name} (${text.abbreviation})`,
          target: { kind: 'shastra', id: loaded.textId },
          counts: NO_COUNTS,
          message:
            loaded.outcome === 'unchanged'
              ? 'Already loaded, unchanged since.'
              : `${loaded.outcome === 'updated' ? 'Updated' : 'Loaded'}: ${loaded.items} items${
                  loaded.sections > 0 ? ` in ${loaded.sections} sections` : ''
                }. Find a passage in Shastra by typing its reference${
                  loaded.sections > 0 ? '' : `, for example “${text.abbreviation} ${first}”`
                }.`,
          issues: loaded.outcome === 'unchanged' ? [] : issues,
        };
        imports.addItem(ctx.runId, at, item);
        time('write', started);
        return item;
      },
      {
        committed: (item) => {
          addToTotals(totals, item);
        },
        failed: (error) => {
          failed(where, 'shastra', fileName, `Could not load this text: ${errorText(error)}`, [], at);
        },
      },
    );
  };

  const importCalendar = (where: Where, fileName: string, hash: string, raw: unknown) => {
    const read = readCalendarFile(raw);
    if (!read.ok) {
      failed(where, 'calendar', fileName, read.message);
      return;
    }
    const calendar = read.calendar;
    const at = position++;
    batch.write(
      () => {
        const started = performance.now();
        const loaded = new CalendarRepo(ctx.db).load(calendar, { path: where.sourcePath, hash });
        const issues: ImportIssue[] = read.issues.map((n) => ({
          severity: 'warning',
          code: 'calendar-note',
          message: n.message,
          fix: null,
        }));
        if (loaded.overlapping > 0)
          issues.push({
            severity: 'info',
            code: 'calendar-overlap',
            message: `${String(loaded.overlapping)} of its dates ${loaded.overlapping === 1 ? 'is' : 'are'} in another calendar too: this one is used for them now.`,
            fix: null,
          });
        const item: NewImportItem = {
          sourcePath: where.sourcePath,
          format: 'calendar',
          outcome:
            loaded.outcome === 'added' ? 'imported' : loaded.outcome === 'updated' ? 'replaced' : 'skipped',
          name: calendar.name,
          target: { kind: 'calendar', id: loaded.calendarId },
          counts: NO_COUNTS,
          message:
            loaded.outcome === 'unchanged'
              ? 'Already loaded, unchanged since.'
              : `${loaded.outcome === 'updated' ? 'Updated' : 'Loaded'}: ${counted(loaded.days, 'day')}, ${loaded.firstDate} to ${loaded.lastDate}${
                  loaded.festivals > 0 ? `, with ${counted(loaded.festivals, 'festival')}` : ''
                }. Today's Samvat date shows in the operator window, and wherever a stage layout or a message shows it.`,
          issues: loaded.outcome === 'unchanged' ? [] : issues,
        };
        imports.addItem(ctx.runId, at, item);
        time('write', started);
        return item;
      },
      {
        committed: (item) => {
          addToTotals(totals, item);
        },
        failed: (error) => {
          failed(where, 'calendar', fileName, `Could not load this calendar: ${errorText(error)}`, [], at);
        },
      },
    );
  };

  /** A JSON file: what it says it is decides how it is read. */
  const importJson = async (file: ScannedFile, where: Where) => {
    const fileName = basename(file.path);
    if (file.size > MAX_DOCUMENT_BYTES) {
      failed(where, 'unknown', fileName, `${fileName} is ${formatBytes(file.size)}, too big to load.`);
      return;
    }
    const bytes = await readFile(file.path);
    const hash = sha256(bytes);
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''));
    } catch (error) {
      failed(where, 'unknown', fileName, `Not a JSON file Drashti can read: ${errorText(error)}`);
      return;
    }
    const format = typeof raw === 'object' && raw !== null ? (raw as { format?: unknown }).format : undefined;
    if (format === SHASTRA_FORMAT) {
      importShastra(where, fileName, hash, raw);
      return;
    }
    if (format === CALENDAR_FORMAT) {
      importCalendar(where, fileName, hash, raw);
      return;
    }
    record({
      sourcePath: where.sourcePath,
      format: 'unknown',
      outcome: 'unsupported',
      name: fileName,
      target: null,
      counts: NO_COUNTS,
      message:
        'A JSON file that is not a Shastra text or a calendar Drashti knows (see docs/shastra-format.md and docs/calendar-format.md).',
      issues: [],
    });
  };

  const unknown = new Map<string, string[]>();

  async function importOne(file: ScannedFile, where: Where): Promise<void> {
    const name = basename(file.path).toLowerCase();
    const ext = extOf(file.path);
    if (ext === 'json') {
      await importJson(file, where);
      return;
    }
    const support =
      SUPPORT_FILES[name] ??
      (SUPPORT_EXTENSIONS[ext] ? { format: 'unknown' as const, message: SUPPORT_EXTENSIONS[ext] } : null) ??
      (ext === '' && basename(dirname(file.path)) === 'Configuration' && basename(file.path) !== 'Props'
        ? { format: 'pp7' as const, message: 'Settings are set up again in Drashti (see the audit report).' }
        : null);
    if (support) {
      record({
        sourcePath: where.sourcePath,
        format: support.format,
        outcome: 'unsupported',
        name: basename(file.path),
        target: null,
        counts: NO_COUNTS,
        message: support.message,
        issues: [],
      });
      return;
    }
    switch (file.format) {
      case 'text':
        await importText(file, where);
        return;
      case 'media':
        await importMedia(file, where);
        return;
      case 'pictures':
        await importPictures(file, where);
        return;
      case 'pp6':
        if (ext === 'pro6x' || ext === 'pro6plx') await importBundle(file, where, 'pp6');
        else await importPp6(file, where);
        return;
      case 'pp7':
        if (ext === 'probundle' || ext === 'proplaylist') await importBundle(file, where, 'pp7');
        else await importPp7(file, where, pp7KindOf(file.path));
        return;
      default: {
        if (where.bundle === 'pp7' && name === 'data') {
          await importPp7(file, where, 'playlist');
          return;
        }
        const list = unknown.get(ext) ?? [];
        list.push(where.sourcePath);
        unknown.set(ext, list);
      }
    }
  }

  // ---- the run ---------------------------------------------------------------------

  try {
    imports.startRun(ctx.runId, ctx.paths, ctx.options);
    progress('scanning', 0, 0, null, true);
    const scanStarted = performance.now();
    const scan = await scanPaths(ctx.paths, { skip: ctx.skipDir });
    time('scan', scanStarted);
    const top: Omit<Where, 'sourcePath' | 'nearby'> = {
      mediaByName: scan.mediaByName,
      docsByName: docsIndex(scan.files),
    };
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

    const files = sortForImport(scan.files);
    const total = files.length;
    let done = 0;
    let status: ImportRunStatus = 'done';
    progress('importing', 0, total, null, true);
    for (const file of files) {
      if (ctx.isCancelled?.()) {
        status = 'cancelled';
        break;
      }
      progress('importing', done, total, basename(file.path));
      const where: Where = { ...top, sourcePath: file.path, nearby: [dirname(file.path)] };
      // A playlist may have imported this presentation already, for its own sake.
      if (written.byPath.has(normalizePath(file.path))) {
        done++;
        continue;
      }
      try {
        await importOne(file, where);
      } catch (error) {
        failed(where, file.format, basename(file.path), `Could not import this file: ${errorText(error)}`);
      }
      done++;
      maybeCommit();
    }

    // Files Drashti does not read: one line per type, never dropped silently.
    for (const [ext, paths] of unknown) {
      const label = ext ? `.${ext}` : 'no extension';
      const examples = paths.slice(0, 5).map((p) => basename(p.split(BUNDLE_SEP).pop() ?? p));
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
    commit();

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
  } finally {
    // Whatever happens, never leave a group of writes open: files written so far are whole
    // (each is its own savepoint), so they are kept.
    if (batch.isOpen) commit();
  }
  const summary = imports.summary(ctx.runId);
  if (!summary) throw new Error('The import run disappeared from the library.');
  return summary;
}
