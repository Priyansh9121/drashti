import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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
import { SIMPLE_IMPORT_LEFT_OUT } from '../../shared/mode';
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
import { readDocx } from './formats/docx';
import { parseLyricsText } from './formats/text';
import { OriginalsStore, type OriginalDescriptor } from './originals-store';
import { diskFreeBytes, type MediaStore, sha256File, type StagedMedia, UPLOADS_DIR } from './media-store';
import { isInside } from '../media/contained';
import { withoutOutsideLinks } from './deck/links';
import { fileNameOf, pathFromReference, resolveMedia } from './media-resolver';
import type { MediaMarkers } from '../../shared/markers';
import type { ParsedMediaRef, ParsedPlaylist, ParsedPlaylistDoc, ParsedPresentation } from './model';
import { MEDIA_REF, slideCount } from './model';
import { SettingsRepo } from '../db/settings';
import { ShastraRepo } from '../db/shastra';
import { readShastraFile, SHASTRA_FORMAT } from '../../shared/shastra';
import { CalendarRepo } from '../db/calendar';
import { CALENDAR_FORMAT, readCalendarFile } from '../../shared/calendar';

/** "1 day", "182 days". */
const counted = (n: number, one: string): string => `${n.toLocaleString('en')} ${one}${n === 1 ? '' : 's'}`;
import { TRANSLIT_STYLES, type TranslitStyle } from '../../shared/translit';
import { unreadPictureWords } from '../../shared/media';
import { playIssues } from './probe';
import { extOf, formatOf, type ScannedFile, scanPaths } from './scan';
import type { DrawPdf, PicturesResult } from '../../shared/pictures';
import { pictureSourceOf } from '../../shared/pictures';
import {
  checkDeck,
  type Converter,
  convertersFor,
  convertToPdf,
  findConverters,
  noConverterMessage,
} from './deck-converters';
import { standInPdf } from './stand-in-converter';
import {
  keynotePagesShifted,
  notesForPages,
  picturesIssues,
  picturesPresentation,
  type PptxDeck,
  type PptxSlide,
  readPptxDeck,
} from './pictures';
import { runDeck } from './deck/deck-flow';
import { readDeckFontIssues } from './deck/deck-fonts';
import {
  addDeckMedia,
  deckMediaCount,
  deckMediaFiles,
  noAppIssue,
  picturesMediaIssues,
} from './deck/deck-import';
import { type Baker, movieChoice } from './deck/plan';
import type { OfficeCopies } from './deck/leftovers';
import { StepTimes, stepsLine } from './step-times';
import { extractZip } from './zip';
import { plural } from '../../shared/text';
import { readabilityCounts, REFERENCE_LINES } from '../../shared/readable';
import { standsUpright } from '../../shared/text-runs';
import { nfc, nfcDeep, nfcElement } from '../../shared/nfc';
import { mapDeckMedia } from '../../shared/deck-schema';

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
  /**
   * After a group is committed in which this import gave files start and end points or markers they had none of
   * (Session 54), by media id: what is up playing them moves to them at once, as for points saved while it plays.
   */
  onMarked?: (mediaIds: string[]) => void;
  isCancelled?: () => boolean;
  /** Says when the run is cancelled, to stop work in the middle of a file (Keynote or PowerPoint saving one). */
  signal?: AbortSignal;
  /** A line for Drashti's log. */
  log?: (message: string) => void;
  /**
   * The main process waiting to write (an operator's edit; Session 16): between files the import
   * commits its group and gives way until the main process has written. `loop` says when the import
   * goes through its files (and gives way only between them) and when it is done with them.
   */
  way?: { wanted(): boolean; give(): Promise<void>; loop(on: boolean): void };
  /** Bring Drashti's window back to the front (Keynote or PowerPoint took it with a message). */
  refocus?: () => void;
  /** Keynote or PowerPoint started by Drashti itself, and its end (Session 31: the leftovers record). */
  appStarted?: (pid: number, app: 'PowerPoint' | 'Keynote') => void;
  appEnded?: (pid: number) => void;
  /** Filled in with where the time went. */
  timings?: ImportTimings;
  /** Least time between progress reports (default 100 ms). */
  progressEveryMs?: number;
  /** Commit a group of writes once it has been open this long (default 250 ms). */
  batchBudgetMs?: number;
  /** Where bundles are unpacked (default: the system's temporary folder). */
  tempDir?: string;
  /** Draws a PDF's pages as pictures (the main process does, in a window; Session 15). */
  drawPdf?: DrawPdf;
  /**
   * Whether Keynote or PowerPoint may save PowerPoint and Keynote files as PDF (default yes), or
   * 'stand-in' (tests only: ./stand-in-converter.ts saves PowerPoint files as PDF in their place).
   */
  converters?: boolean | 'stand-in';
  /**
   * Whether a PowerPoint or Keynote deck comes in with its animations where PowerPoint or Keynote can make its
   * movie (Session 54, C2; default yes), or 'stand-in' (tests only: ./deck/stand-in-baker.ts makes it). It needs
   * `ffmpeg`, which cuts the movie.
   */
  baker?: boolean | 'stand-in';
  /** The bundled FFmpeg (Session 50), where it is there. */
  ffmpeg?: string | null;
  /** Whether the stream is on air or recording now: then no deck's movie is made (Session 50's rule). */
  onAir?: () => Promise<boolean>;
  /** Free space on a folder's disk, as a deck's bake sees it (tests only; default: the disk's own). */
  freeBytes?: (dir: string) => number;
  /**
   * Drashti's record of the copies a PowerPoint import puts in PowerPoint for Mac's own folder (Session 56): each
   * written down before it goes there, forgotten once removed, so that only a start after one cut short looks there.
   */
  officeCopies?: OfficeCopies | null;
  /** Tests only (Session 56's timing check): the stand-in's movie this many lines high (else 180). */
  standInLines?: number | null;
  /** Tests only (the timing check): only these apps make a deck's movie or PDF, in this order (else every one here). */
  deckApps?: Converter[] | null;
  /** Tests only (Session 56): the stand-in makes its movie only once this file is there (a deck seen preparing). */
  standInHold?: string | null;
}

type SourceKind = 'text' | 'docx' | 'pp6' | 'pp7' | 'pictures';

/** What the log's "Import steps" line says of a file (Session 56): how it came in, and when its slides first showed. */
interface Told {
  how: string;
  slides: number;
  /** Ms from its start until its slides were first in the library. */
  shownMs?: number;
}

/** A deck's slides written as their pictures while its animations are made (Session 56), and whether that is over. */
interface EarlyDeck {
  /** Where they went, and the presentation's content revision just after (null: none yet). */
  shown: { id: string; name: string; rev: number | null } | null;
  /** The deck (or its pictures) took their place, or they were kept as changed: nothing left to clear. */
  done: boolean;
}

/** A source's format in the report: a Word file's lyrics are lyrics, as a text file's are (Session 26f). */
const reportFormat = (kind: SourceKind): ImportFormat => (kind === 'docx' ? 'text' : kind);

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
    message: 'Drashti has no masks, so this file of masks was left out.',
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
const SUPPORT_EXTENSIONS: Record<string, string> = {
  pro6dvd: 'DVD clip lists are not imported.',
  // Session 26f: Word lyrics are read from .docx files only.
  doc: 'An old Word document (.doc) is not read: open it in Word and save it as a Word Document (.docx), then import that.',
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

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

/**
 * The report's word on slides the hall may not read (Sessions 31–36, SLD-1), counted by the estimate: words
 * running past their box, and words drawn below 36 px on a 1080-line screen. The slide editor measures and
 * marks each.
 */
export function readabilityIssues(input: NewPresentation): ImportIssue[] {
  const { over, small } = readabilityCounts(
    input.groups.flatMap((g) => g.slides),
    input.height ?? REFERENCE_LINES,
  );
  const out: ImportIssue[] = [];
  if (over > 0)
    out.push({
      severity: 'warning',
      code: 'words-run-over',
      message: `${plural(over, 'slide has', 'slides have')} words that may run past their box: open it in the slide editor, where a mark shows each.`,
      fix: null,
    });
  // Gujarati, Hindi or Sanskrit set italic or letter-spaced in the file (Sessions 31–36, I18N-2): kept as
  // stored, but drawn upright with no extra spacing.
  const slanted = input.groups
    .flatMap((g) => g.slides)
    .filter((s) =>
      s.elements.some(
        (e) =>
          e.kind === 'text' &&
          (e.runs ?? []).some(
            (r) => (r.italic === true || (r.letterSpacing ?? 0) !== 0) && standsUpright(r, e.lang),
          ),
      ),
    ).length;
  if (slanted > 0)
    out.push({
      severity: 'info',
      code: 'indic-upright',
      message: `${plural(slanted, 'slide has', 'slides have')} Gujarati, Hindi or Sanskrit words set italic or letter-spaced in the file: Drashti draws them upright, with the font’s own spacing, so their letters stay joined.`,
      fix: null,
    });
  if (small > 0)
    out.push({
      severity: 'info',
      code: 'words-small',
      message: `${plural(small, 'slide has', 'slides have')} words drawn below 36 px on a 1080-line screen, hard to read from the back of the hall: the slide editor says which.`,
      fix: null,
    });
  return out;
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
    // Its words in one form, NFC (Sessions 31–36, I18N-6): text enters the library here.
    return [nfcElement(el)];
  };
  const input: NewPresentation = {
    libraryId,
    name: nfc(parsed.name),
    width: parsed.width,
    height: parsed.height,
    notes: nfc(parsed.notes),
    groups: parsed.groups.map((g) => ({
      name: nfc(g.name),
      color: g.color,
      slides: g.slides.map((s) => ({
        label: nfc(s.label),
        notes: nfc(s.notes),
        background: s.background,
        enabled: s.enabled,
        elements: s.elements.flatMap(element),
        cues: s.cues.map((c) => ({
          kind: c.kind,
          label: nfc(c.label),
          mediaId: c.media === null ? null : (mediaIds[c.media] ?? null),
          props: c.props,
        })),
        transition: s.transition ?? null,
        autoAdvanceMs: s.autoAdvanceMs ?? null,
        ...(s.documentPage ? { documentPage: s.documentPage } : {}),
        // A deck's slide (Session 54, C2): its references made the library's media ids.
        ...(s.deck ? { deck: mapDeckMedia(s.deck, (ref) => media(ref) ?? ref) } : {}),
      })),
    })),
    arrangements: parsed.arrangements.map((a) => ({ ...a, name: nfc(a.name) })),
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
  const originals = new OriginalsStore(
    ctx.db,
    ctx.media.dir,
    ctx.freeBytes ? { freeBytes: ctx.freeBytes } : {},
  );
  const playlists = new PlaylistRepo(ctx.db);
  const batch = new BatchWriter(ctx.db, { budgetMs: ctx.batchBudgetMs ?? 250 });
  /** Run a commit, counting it when it committed a group. */
  const groupOpen = () => batch.isOpen;
  const countCommit = (run: () => void) => {
    const open = groupOpen();
    run();
    if (open && !groupOpen() && timings) timings.commits = (timings.commits ?? 0) + 1;
  };
  const commit = () => {
    const t = performance.now();
    countCommit(() => {
      batch.commit();
    });
    time('commit', t);
  };
  const maybeCommit = () => {
    const t = performance.now();
    countCommit(() => {
      batch.maybeCommit();
    });
    time('commit', t);
  };
  /**
   * Between files: if the main process waits to write, commit and give way. A file's work can finish
   * without ever handing the worker's event loop a turn, and the main process's request is a message
   * waiting in that loop: so a turn first (measured on Windows CI: without it, edits waited 0.9 to
   * 1.5 s for the request to be read).
   */
  const giveWay = async () => {
    if (!ctx.way) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!ctx.way.wanted()) return;
    commit();
    await ctx.way.give();
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
  /** The files given points by this import (Session 55, Q20): within one import, the first points are kept. */
  const pointed = new Set<string>();
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

  /**
   * The library rows for staged media (inside a group): ids by reference, what is missing, and the files given
   * points or markers they had none of (Session 54), told once the group is committed (`told`).
   */
  const storeMedia = (staged: readonly Staged[], kind: SourceKind) => {
    const ids: string[] = [];
    const issues: ImportIssue[] = [];
    const marked: string[] = [];
    /** Files that had other points, given this import's (Session 55, Q20), by name. */
    const replaced: string[] = [];
    /**
     * An import's points for a file (Session 55: the owner's answer to Session 54's question 20): a file the library
     * has already takes them in place of its own, so what is up playing it moves to them. Within one import, the
     * first points a file is given are kept, as before.
     */
    const takePoints = (mediaId: string, name: string, markers: MediaMarkers | null | undefined) => {
      if (!markers || pointed.has(mediaId)) return;
      const took = ctx.media.takeMarkers(mediaId, markers);
      if (took === null) return;
      pointed.add(mediaId);
      if (took === 'same') return;
      marked.push(mediaId);
      if (took === 'replaced') replaced.push(name);
    };
    for (const s of staged) {
      // A page drawn from a document is a picture Drashti made, from that page.
      const source = {
        kind: kind === 'pictures' ? ('drashti' as const) : kind,
        path: s.ref.sourcePath ?? s.ref.originalPath,
      };
      if (s.staged) {
        const stored = ctx.media.addStaged(s.staged, source);
        ids.push(stored.mediaId);
        takePoints(stored.mediaId, stored.name, s.ref.markers);
        // What cannot play: converted by itself (Session 50), or offered for Convert.
        issues.push(...playIssues(s.staged.name, stored));
        continue;
      }
      const id = ctx.media.addMissing(s.ref.originalPath, s.ref.kind, source);
      ids.push(id);
      // Its points kept for when it is found (Session 54 review: Find missing media… fills the item in, points and
      // all), where they were thrown away and it played whole.
      takePoints(id, fileNameOf(s.ref.originalPath), s.ref.markers);
      if (s.issue) issues.push(s.issue);
      issues.push({
        severity: 'warning',
        code: 'missing-media',
        message: `Missing media: ${fileNameOf(s.ref.originalPath)} was not at its original path, next to the file or in the imported folders.`,
        fix: { kind: 'relink-media', mediaId: id },
      });
    }
    // A deck's trims are its own XML's, said with the deck (Session 54, C2).
    if (marked.length > 0 && kind !== 'pictures')
      issues.push({
        severity: 'info',
        code: 'markers-read',
        message: `Start and end points or markers were read for ${plural(marked.length, 'video or sound', 'videos or sounds')}. The older formats' markers follow the community notes on them and are not yet checked against real files: look them over (the media item’s Markers).`,
        fix: null,
      });
    if (replaced.length > 0) {
      const shown = replaced.slice(0, 3).join(', ');
      const more = replaced.length > 3 ? ` and ${plural(replaced.length - 3, 'other', 'others')}` : '';
      const one = replaced.length === 1;
      issues.push({
        severity: 'info',
        code: 'markers-replaced',
        message: `${shown}${more} ${one ? 'was' : 'were'} in the library already, with other start and end points or markers: ${one ? 'it has' : 'they have'} this import’s now, and what is up playing ${one ? 'it' : 'them'} moved to them at once.`,
        fix: null,
      });
    }
    return { ids, issues, count: ids.length, marked };
  };
  /** Files given points (storeMedia's `marked`), told once their group is committed (Session 54). */
  const told = (marked: readonly string[]) => {
    if (marked.length > 0) ctx.onMarked?.([...marked]);
  };

  // ---- presentations ----------------------------------------------------------------

  /** An earlier import of the same file decides what happens to this one: null when it is done with. */
  interface Decided {
    latest: { id: string; name: string } | null;
    choice: ConflictChoice | null;
    /**
     * The same file, imported before as a deck's pictures, coming in again for its animations (Session 54, C
     * review): if they cannot be made after all, the earlier import is kept as it was.
     */
    animate?: boolean;
  }

  /** An unchanged file is skipped. A changed file is kept beside the earlier import by default. */
  const decideEarlier = (
    file: ScannedFile,
    where: Where,
    kind: SourceKind,
    ref: string | null,
    hash: string,
    /** The same file imported before is imported again all the same (a deck that can now have its animations). */
    again?: (id: string) => boolean,
  ): Decided | null => {
    const fileName = basename(file.path);
    const base = { sourcePath: where.sourcePath, format: reportFormat(kind), counts: NO_COUNTS };
    const t = performance.now();
    const earlier = presentations.findImported(kind, ref, where.sourcePath);
    const same =
      earlier.find((e) => e.sourceHash === hash) ??
      (earlier.length === 0 ? presentations.findByHash(kind, hash) : null);
    time('lookup', t);
    // When a deck can now come in with its animations, keep the earlier pictures and any edits beside it.
    if (same && again?.(same.id)) {
      const decided = ctx.options.decisions?.[where.sourcePath] ?? ctx.options.onConflict ?? 'keep-both';
      if (decided === 'ask') {
        record({
          ...base,
          outcome: 'conflict',
          name: same.name,
          target: { kind: 'presentation', id: same.id },
          message: 'It can now come in with its animations: it came in as pictures before.',
          issues: [
            {
              severity: 'warning',
              code: 'deck-can-animate',
              message: `${fileName} can now come in with its animations. Replace “${same.name}” with it (what was changed in it since is lost), or keep both?`,
              fix: { kind: 'choose', sourcePath: where.sourcePath },
            },
          ],
        });
        remember(where, file, same.id);
        return null;
      }
      if (decided !== 'skip')
        return { latest: { id: same.id, name: same.name }, choice: decided, animate: true };
    }
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
      const decided = ctx.options.decisions?.[where.sourcePath] ?? ctx.options.onConflict ?? 'keep-both';
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

  /** The content's revision of a presentation in the library, or null when it is gone. */
  const revisionOf = (id: string): number | null =>
    (ctx.db
      .prepare('SELECT content_rev FROM presentations WHERE id = ? AND deleted_at IS NULL')
      .pluck()
      .get(id) as number | undefined) ?? null;

  /**
   * Write a presentation, and say so in the report. Two writes for a deck whose slides show as their pictures while
   * its animations are made (Session 56): `early`, the pictures (no report line, committed at once, so the operator
   * sees them), then `after` that one, the deck itself in its place, said in the report as the first would have been.
   * Returns where it went, or null.
   */
  const importPresentation = async (
    file: ScannedFile,
    where: Where,
    kind: SourceKind,
    hash: string,
    parsed: ParsedPresentation,
    decidedAlready?: Decided,
    retained: readonly OriginalDescriptor[] = [],
    phase?: { early: true } | { after: { id: string; name: string } },
  ): Promise<{ id: string; name: string; rev: number | null } | null> => {
    const base = { sourcePath: where.sourcePath, format: reportFormat(kind), counts: NO_COUNTS };
    const decided = decidedAlready ?? decideEarlier(file, where, kind, parsed.ref, hash);
    if (!decided) return null;
    const { latest, choice } = decided;
    if ((kind === 'text' || kind === 'docx') && slideCount(parsed) === 0) {
      record({
        ...base,
        outcome: 'failed',
        name: parsed.name,
        target: null,
        message: parsed.issues.find((i) => i.severity === 'error')?.message ?? 'The file has no text.',
        issues: parsed.issues,
      });
      return null;
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
        for (const original of retained) originals.register(original);
        const libraryId = presentations.ensureLibrary(parsed.library ?? ctx.libraryName ?? 'Default');
        const { input, dropped } = toNewPresentation(parsed, libraryId, source, hash, media.ids);
        // A kirtan laid out a box per language: its plain transliteration is told from English by reading.
        for (const g of input.groups) for (const sl of g.slides) sl.elements = readLatinLines(sl.elements);
        const issues = [...parsed.issues, ...media.issues, ...readabilityIssues(input)];
        // A kirtan: from its author field, or its lines in Gujarati or Hindi with another language.
        const kirtan = importedKirtan(
          parsed.kavi ? { ...parsed.kavi, name: nfc(parsed.kavi.name) } : null,
          input.groups,
        );
        // Importing it again keeps the details the operator gave it (filling in a kavi it lacked).
        const kept = choice === 'replace' && latest ? presentations.kirtanDetails(latest.id) : null;
        if (kept) input.kirtan = { ...kept, kavi: kept.kavi ?? kirtan?.details.kavi ?? null };
        else if (kirtan) input.kirtan = kirtan.details;
        if (kirtan) issues.push(kirtan.issue);
        if (dropped > 0) {
          issues.push({
            severity: 'warning',
            code: 'invalid-element',
            message: `${plural(dropped, 'slide element')} could not be read and ${dropped === 1 ? 'was' : 'were'} left out: check the slides, and add what is missing in the slide editor.`,
            fix: null,
          });
        }
        const counts = { ...countsOf(parsed), media: media.count };
        let item: NewImportItem;
        let wrote: { presentationId: string; replaced: boolean };
        const after = phase && 'after' in phase ? phase.after : null;
        if (after && presentations.replace(after.id, input)) {
          // In place of its pictures (Session 56), said as the import of it would have been.
          const replacing = choice === 'replace' && latest !== null;
          item = {
            ...base,
            outcome: replacing ? 'replaced' : choice === 'keep-both' ? 'kept-both' : 'imported',
            name: after.name,
            target: { kind: 'presentation', id: after.id },
            counts,
            message: replacing
              ? 'Replaced the earlier import with the new version.'
              : choice === 'keep-both' && latest
                ? `Kept both; the earlier import is still “${latest.name}”.`
                : null,
            issues,
          };
          wrote = { presentationId: after.id, replaced: true };
        } else if (choice === 'replace' && latest && presentations.replace(latest.id, input)) {
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
          const name = presentations.uniqueName(libraryId, input.name);
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
        for (const original of retained)
          for (const mediaId of media.ids)
            if (ctx.db.prepare("SELECT 1 FROM media WHERE id = ? AND kind = 'image'").get(mediaId))
              originals.registerPreview(original, mediaId);
        // The pictures shown first (Session 56): the report's line comes with the deck itself.
        if (!phase || !('early' in phase)) imports.addItem(ctx.runId, at, item);
        time('write', started);
        // Its content's revision as written, before anyone is told of it (an edit after it is the operator's).
        return { item, wrote, marked: media.marked, rev: revisionOf(wrote.presentationId) };
      },
      {
        committed: ({ item, wrote, marked }) => {
          if (!phase || !('early' in phase)) addToTotals(totals, item);
          ctx.onWrote?.(wrote);
          told(marked);
        },
        failed: (error) => {
          failed(
            where,
            reportFormat(kind),
            parsed.name,
            `Could not write this presentation: ${errorText(error)}`,
            [],
            at,
          );
        },
      },
    );
    if (!result) return null;
    remember(where, file, result.wrote.presentationId);
    // Shown at once (Session 56): its group committed now, not with the next file's.
    if (phase && 'early' in phase) batch.commit();
    return { id: result.wrote.presentationId, name: result.item.name ?? parsed.name, rev: result.rev };
  };

  /**
   * A deck's own videos and sounds as media of their own, where nothing here can make its pictures (Session 54,
   * C2): taken out of it, each imported as a dropped file is (in the Media list, with the time bar). Returns how many.
   */
  const importDeckMedia = async (deck: { deck: PptxDeck; file: string }, where: Where, work: string) => {
    const files = await deckMediaFiles(deck.file, deck.deck, join(work, 'deck-media'));
    for (const path of files) {
      const s = await stat(path);
      await importMedia(
        { path, size: s.size, format: 'media' },
        { ...where, sourcePath: `${where.sourcePath}${BUNDLE_SEP}${basename(path)}` },
      );
    }
    return files.length;
  };

  /**
   * A PDF, PowerPoint or Keynote file as pictures (Session 15): saved as PDF by Keynote or PowerPoint
   * when it is not one, its pages drawn by the main process, then one slide per page. Session 54 (C2): a
   * PowerPoint or Keynote file comes in with its animations where PowerPoint or Keynote can make them
   * (./deck/deck-flow.ts), else as pictures with its own videos and sounds.
   */
  /** The apps a test asked for (the timing check), among those here, in its order; else those here. */
  const onlyAsked = (here: Converter[]): Converter[] =>
    ctx.deckApps ? ctx.deckApps.filter((app) => here.includes(app)) : here;

  const importPictures = async (file: ScannedFile, where: Where) => {
    // Where its time goes, step by step (Session 56): a line in Drashti's log once it is done, for the timing check.
    const steps = new StepTimes();
    const told: Told = { how: 'failed', slides: 0 };
    // A deck's slides written as their pictures while its animations are made (Session 56): should the file end
    // without the deck taking their place, its slides stay as those pictures, their Preparing marks gone.
    const early: EarlyDeck = { shown: null, done: false };
    try {
      await picturesOf(file, where, steps, told, early);
    } finally {
      if (early.shown && !early.done && presentations.clearPreparing(early.shown.id) > 0)
        ctx.onWrote?.({ presentationId: early.shown.id, replaced: true });
      ctx.log?.(
        stepsLine(
          {
            name: basename(file.path),
            kind: extOf(file.path),
            slides: told.slides,
            how: told.how,
            ...(told.shownMs === undefined ? {} : { shownMs: told.shownMs }),
          },
          steps,
        ),
      );
    }
  };

  /**
   * A deck's slides written as their pictures while its animations were made (Session 56) and then changed or deleted
   * by the operator: an edit wins, so they are kept as they are, their Preparing marks gone, and the report says so.
   * Whether it was so.
   */
  const keptAsChanged = (file: ScannedFile, where: Where, early: EarlyDeck): boolean => {
    const shown = early.shown;
    if (!shown || revisionOf(shown.id) === shown.rev) return false;
    early.done = true;
    const gone = revisionOf(shown.id) === null;
    if (!gone && presentations.clearPreparing(shown.id) > 0)
      ctx.onWrote?.({ presentationId: shown.id, replaced: true });
    record({
      sourcePath: where.sourcePath,
      format: 'pictures',
      outcome: gone ? 'skipped' : 'imported',
      name: shown.name,
      target: gone ? null : { kind: 'presentation', id: shown.id },
      counts: NO_COUNTS,
      message: gone
        ? 'It was deleted while its animations were being made, so it stays deleted.'
        : 'It was changed while its animations were being made, so it was kept as it was, as its pictures: import it again for its animations.',
      issues: [],
    });
    if (!gone) remember(where, file, shown.id);
    return true;
  };

  const picturesOf = async (
    file: ScannedFile,
    where: Where,
    steps: StepTimes,
    told: Told,
    early: EarlyDeck,
  ) => {
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
    // A Keynote file saved as a package is a folder (Session 16): not something to copy or hash.
    if (source === 'key' && (await stat(file.path)).isDirectory()) {
      fail(
        'pictures-package',
        'This Keynote file is saved as a package (a folder). Open it in Keynote, choose File > Advanced > Change File Type > Single File, then import it again.',
      );
      return;
    }
    let t = performance.now();
    const sourceDir = dirname(file.path);
    const fromPhone = isInside(resolve(ctx.media.dir, UPLOADS_DIR), resolve(file.path));
    const kept = await steps.time('original', () => originals.stage(file.path, source, ctx.signal));
    if (!kept.ok) {
      fail('original-not-retained', kept.message);
      return;
    }
    const hash = kept.original.sha256;
    const retained: OriginalDescriptor[] = [kept.original];
    const keepEditableKeynote = async (candidate: string): Promise<OriginalDescriptor | null> => {
      const staged = await steps.time('original', () => originals.stage(candidate, 'pptx', ctx.signal));
      if (!staged.ok) return null;
      retained.push(staged.original);
      return staged.original;
    };
    const visibleIndices = (list: readonly PptxSlide[] | null) =>
      list?.flatMap((slide, index) => (slide.hidden ? [] : [index])) ?? [];
    time('read', t);
    // What can make a deck's movie here (Session 54, C2): PowerPoint first for its own files, then Keynote.
    const bakers: Baker[] =
      source === 'pdf' || ctx.baker === false || !ctx.ffmpeg
        ? []
        : ctx.baker === 'stand-in'
          ? source === 'pptx'
            ? ['stand-in']
            : []
          : onlyAsked(convertersFor(source, process.platform, await findConverters()));
    const onAir = ctx.onAir ?? (() => Promise.resolve(false));
    const canBake = bakers.length > 0 && !(await onAir());
    // A deck where nothing moves comes in as its pictures with no movie at all (Session 56): it is never asked to come
    // in again for animations it has none of.
    const moves =
      canBake && source === 'pptx'
        ? await readPptxDeck(kept.file).then(
            (d) => movieChoice(d.slides).moving.size > 0,
            () => true,
          )
        : true;
    // An unchanged deck needs no more drawing, unless its animations can now be imported.
    const decided = decideEarlier(
      file,
      where,
      'pictures',
      null,
      hash,
      (id) => canBake && moves && !presentations.hasDeckSlides(id),
    );
    if (!decided) {
      told.how = 'skipped';
      return;
    }
    const work = await mkdtemp(join(ctx.tempDir ?? tmpdir(), 'drashti-pictures-'));
    try {
      let pdf = kept.file;
      /** The deck as PowerPoint, Keynote and Drashti read it: the file, or a phone's copy with dead links. */
      let deckPath = kept.file;
      let converter: Converter | null = null;
      let firstTried: { converter: Converter; reason: string } | null = null;
      let slides: PptxSlide[] | null = null;
      let keynoteExport: { file: string; slides: readonly PptxSlide[] } | null = null;
      /** The deck as read, for its videos and sounds beside its pictures (Session 54, C2), and why no animations. */
      let deckRead: { deck: PptxDeck; file: string } | null = null;
      const deckIssues: ImportIssue[] = [];
      const addDeckFonts = async (parsed: ParsedPresentation, keynoteCopy?: string) => {
        const pptx = source === 'pptx' ? kept.file : keynoteCopy;
        if (pptx) parsed.issues.push(...(await readDeckFontIssues(pptx)));
      };
      /** The PDF's pages, drawn already as the deck's movie was tried (Session 56). */
      let reuse: PicturesResult | null = null;
      if (source !== 'pdf') {
        // A plainly damaged file never reaches Keynote or PowerPoint, which would ask about it in a
        // window nobody sees and stop answering (Session 16).
        const checked = await steps.time('read', () => checkDeck(source, kept.file));
        if (!checked.ok) {
          fail('pictures-damaged', checked.message);
          return;
        }
        slides = checked.slides;
        // A deck a phone sent (Session 54, C review): its links to files outside it are dead ends in the copy that
        // PowerPoint, Keynote and Drashti read, so nothing else of this computer's comes in through it.
        let read = checked.deck;
        if (source === 'pptx' && fromPhone) {
          deckPath = join(work, basename(file.path));
          if ((await withoutOutsideLinks(kept.file, deckPath)) > 0) read = await readPptxDeck(deckPath);
        }
        // With its animations where PowerPoint or Keynote can make its movie (Session 54, C2).
        t = performance.now();
        const flow = await runDeck(
          {
            source,
            file: deckPath,
            fileName,
            sourcePath: where.sourcePath,
            sourceDir,
            read,
            work,
            bakers,
          },
          {
            ffmpeg: ctx.ffmpeg ?? '',
            onAir,
            signal: ctx.signal,
            slideCount: slides?.length,
            log: ctx.log && ((line) => ctx.log?.(line.startsWith('Deck: ') ? line : `Deck: ${line}`)),
            refocus: ctx.refocus,
            appStarted: ctx.appStarted,
            ended: (pid) => ctx.appEnded?.(pid),
            kept: decided.animate === true,
            ...(ctx.freeBytes ? { freeBytes: ctx.freeBytes } : {}),
            officeCopies: ctx.officeCopies ?? null,
            steps,
            standInLines: ctx.standInLines ?? null,
            standInHold: ctx.standInHold ?? null,
            // The slides that come in as their pictures (Session 56): the PDF the app saved, drawn by the main process.
            drawPdf: ctx.drawPdf,
            // The slides as their pictures at once (Session 56), the ones that move marked as preparing; never in place
            // of pictures asked for again with their animations, which stay untouched until those are made.
            ...(decided.animate
              ? {}
              : {
                  early: async (parsed: ParsedPresentation, indices: number[]) => {
                    parsed.groups
                      .flatMap((g) => g.slides)
                      .forEach((slide, k) => {
                        slide.documentPage = { sha256: hash, ext: source, page: indices[k] ?? k };
                      });
                    // A second app trying after the first could not: in place of the first's.
                    const before = early.shown;
                    const wrote = await importPresentation(
                      file,
                      where,
                      'pictures',
                      hash,
                      parsed,
                      before ? { latest: { id: before.id, name: before.name }, choice: 'replace' } : decided,
                      retained,
                      { early: true },
                    );
                    if (wrote) {
                      early.shown = wrote;
                      told.shownMs ??= Math.round(steps.elapsed());
                    }
                  },
                }),
          },
        );
        time('parse', t);
        if (flow.kind === 'baked') {
          const indices = flow.sourceIndices ?? visibleIndices(slides);
          const pages = flow.parsed.groups.flatMap((group) => group.slides);
          const editablePptx =
            source === 'key' && 'editablePptx' in flow && typeof flow.editablePptx === 'string'
              ? flow.editablePptx
              : undefined;
          const copySlideCount = flow.editablePptxSlideCount ?? 0;
          const sourcePages = new Set(indices);
          const matchesCopy =
            indices.length === pages.length &&
            sourcePages.size === indices.length &&
            [...sourcePages].every((page) => Number.isInteger(page) && page >= 0 && page < copySlideCount);
          let exported: OriginalDescriptor | null = null;
          if (editablePptx && matchesCopy) {
            exported = await keepEditableKeynote(editablePptx);
            if (ctx.signal?.aborted) {
              fail('pictures-cancelled', 'Cancelled while the PowerPoint copy was being kept.');
              return;
            }
          }
          for (const [index, slide] of pages.entries()) {
            slide.documentPage = {
              sha256: exported?.sha256 ?? hash,
              ext: exported?.ext ?? source,
              page: editablePptx && !matchesCopy ? index : (indices[index] ?? index),
            };
          }
          await addDeckFonts(flow.parsed, matchesCopy ? editablePptx : undefined);
          told.how = 'baked';
          told.slides = slideCount(flow.parsed);
          // Its pictures changed or deleted meanwhile: the operator's edit wins (Session 56).
          if (keptAsChanged(file, where, early)) return;
          const earlyShown = early.shown;
          await steps.time('write', () =>
            importPresentation(
              file,
              where,
              'pictures',
              hash,
              flow.parsed,
              decided,
              retained,
              earlyShown ? { after: earlyShown } : undefined,
            ),
          );
          early.done = true;
          told.shownMs ??= Math.round(steps.elapsed());
          return;
        }
        // Asked for its animations in place of its pictures, and they could not be made: the earlier import stays,
        // untouched (Session 54, C review).
        if (decided.animate && decided.latest) {
          record({
            sourcePath: where.sourcePath,
            format: 'pictures',
            outcome: 'skipped',
            name: decided.latest.name,
            target: { kind: 'presentation', id: decided.latest.id },
            counts: NO_COUNTS,
            message: `It could not come in with its animations, so “${decided.latest.name}” was kept as it was: import it again once the reason below is put right.`,
            issues: flow.issues,
          });
          remember(where, file, decided.latest.id);
          return;
        }
        // Cancelled once its slides were shown as their pictures (Session 56): they stay so, said in the report.
        if (flow.cancelled && !early.shown) {
          fail('pictures-cancelled', 'Cancelled while its animations were being made.');
          return;
        }
        deckIssues.push(...flow.issues);
        if (flow.drawn) reuse = flow.drawn;
        if (flow.deck && flow.deckFile) {
          deckRead = { deck: flow.deck, file: flow.deckFile };
          if (source === 'key') keynoteExport = { file: flow.deckFile, slides: flow.deck.slides };
        }
        // A Keynote file's or an old .ppt's notes, from the .pptx made of it as it was tried.
        if (!slides && flow.deck) slides = flow.deck.slides;
        // The pictures the app saved while it tried: no need to ask it again.
        if (flow.pdf) {
          pdf = flow.pdf;
          converter = flow.converter;
        }
        const apps =
          flow.pdf || ctx.converters === false || ctx.converters === 'stand-in'
            ? []
            : onlyAsked(convertersFor(source, process.platform, await findConverters()));
        if (flow.pdf) {
          // Saved already.
        } else if (ctx.converters === 'stand-in' && source === 'pptx') {
          // Tests only: saved as PDF as PowerPoint would (Session 26a, so CI can make decks).
          pdf = await steps.time('app-pdf', () => standInPdf(deckPath, slides, work));
          converter = 'powerpoint';
        } else if (apps.length === 0) {
          // Nothing here makes pictures of it: its own videos and sounds come in as media all the same.
          const brought = deckRead ? await importDeckMedia(deckRead, where, work) : 0;
          failed(where, 'pictures', fileName, noConverterMessage(source), [
            {
              severity: 'error',
              code: 'pictures-no-converter',
              message: noConverterMessage(source),
              fix: null,
            },
            noAppIssue({ media: brought }),
          ]);
          return;
        }
        const failures: { converter: Converter; message: string; reason: string }[] = [];
        for (const app of apps) {
          t = performance.now();
          const converted = await convertToPdf(app, deckPath, work, {
            signal: ctx.signal,
            slideCount: slides?.length,
            log: ctx.log && ((line) => ctx.log?.(`Saving as PDF: ${line}`)),
            refocus: ctx.refocus,
            started: (pid) => ctx.appStarted?.(pid, app === 'keynote' ? 'Keynote' : 'PowerPoint'),
            ended: (pid) => ctx.appEnded?.(pid),
            officeCopies: ctx.officeCopies ?? null,
            steps,
          });
          time('parse', t);
          if (converted.ok) {
            converter = app;
            pdf = converted.pdf;
            if (source === 'key' && converted.editablePptx && converted.slides && !converted.shownOnly)
              keynoteExport = { file: converted.editablePptx, slides: converted.slides };
            // The file's own notes when it could be read; otherwise what the app told.
            if (!slides?.some((sl) => sl.notes !== '') && converted.slides) slides = converted.slides;
            break;
          }
          if (converted.cancelled) {
            fail('pictures-cancelled', 'Cancelled while it was being saved as PDF.');
            return;
          }
          failures.push({ converter: app, message: converted.message, reason: converted.reason });
        }
        const first = failures[0];
        if (!converter) {
          const also = failures
            .slice(1)
            .map(
              (f) =>
                ` ${f.converter === 'keynote' ? 'Keynote' : 'PowerPoint'} could not either (${f.reason}).`,
            )
            .join('');
          fail('pictures-not-converted', `${first?.message ?? ''}${also}`);
          return;
        }
        if (first) firstTried = { converter: first.converter, reason: first.reason };
      }
      let editableOriginal = kept.original;
      if ((source === 'ppt' || source === 'key') && pdf !== kept.file) {
        const convertedOriginal = await steps.time('original', () => originals.stage(pdf, 'pdf', ctx.signal));
        if (!convertedOriginal.ok) {
          fail('converted-original-not-retained', convertedOriginal.message);
          return;
        }
        retained.push(convertedOriginal.original);
        editableOriginal = convertedOriginal.original;
        pdf = convertedOriginal.file;
      }
      t = performance.now();
      const drawPdf = ctx.drawPdf;
      // Drawn already as the deck's movie was made (Session 56): its slides shown as these pictures.
      const drawn =
        reuse ??
        (await steps.time('pictures', () => drawPdf(pdf, join(work, 'pages'), keynoteExport !== null)));
      time('parse', t);
      if (!drawn.ok) {
        fail('pictures-not-drawn', drawn.message);
        return;
      }
      const shifted = keynoteExport !== null && keynotePagesShifted(keynoteExport.slides, drawn);
      const notes = !shifted && slides ? notesForPages(slides, drawn.total) : null;
      const parsed = picturesPresentation(
        fileName,
        drawn,
        drawn.pages.map((p) => notes?.[p.index] ?? ''),
      );
      let editableSlides: readonly PptxSlide[] | null = shifted ? null : slides;
      if (shifted) {
        deckIssues.push({
          severity: 'warning',
          code: 'keynote-pages-out-of-order',
          message:
            'The Keynote PDF and PowerPoint copy have a different page order. Edit slides uses the PDF and its notes.',
          fix: null,
        });
      }
      if (keynoteExport && !shifted) {
        const exportSlides = keynoteExport.slides;
        const shown = visibleIndices(exportSlides);
        if (drawn.total === exportSlides.length || drawn.total === shown.length) {
          const exported = await keepEditableKeynote(keynoteExport.file);
          if (ctx.signal?.aborted) {
            fail('pictures-cancelled', 'Cancelled while the PowerPoint copy was being kept.');
            return;
          }
          if (exported) {
            editableOriginal = exported;
            editableSlides = exportSlides;
          }
        }
      }
      const shownIndices = visibleIndices(editableSlides);
      parsed.groups
        .flatMap((g) => g.slides)
        .forEach((slide, index) => {
          const drawnIndex = drawn.pages[index]?.index ?? index;
          const page =
            source === 'pdf' ||
            editableOriginal.ext === 'pdf' ||
            !editableSlides ||
            drawn.total === editableSlides.length
              ? drawnIndex
              : drawn.total === shownIndices.length
                ? shownIndices[drawnIndex]
                : undefined;
          if (page !== undefined)
            slide.documentPage = { sha256: editableOriginal.sha256, ext: editableOriginal.ext, page };
        });
      parsed.media = parsed.media.map((m, i) => ({
        ...m,
        sourcePath: `${where.sourcePath}#page=${String((drawn.pages[i]?.index ?? i) + 1)}`,
      }));
      // The deck's own videos on its pictures' slides, and a sound that starts with its slide (Session 54, C2).
      const added =
        deckRead && !shifted && drawn.pages.length === drawn.total
          ? await steps.time('deck', () =>
              addDeckMedia(
                parsed,
                deckRead.deck,
                deckRead.file,
                where.sourcePath,
                work,
                ctx.ffmpeg ?? null,
                sourceDir,
              ),
            )
          : { videos: 0, cued: 0, left: 0, unmatched: deckRead ? deckMediaCount(deckRead.deck) : 0 };
      const shown = !shifted ? (slides?.filter((sl) => !sl.hidden) ?? []) : [];
      parsed.issues = picturesIssues({
        source,
        converter,
        firstTried,
        ...(source === 'key' && (editableOriginal.ext === 'pptx' || editableOriginal.ext === 'pdf')
          ? { editableSource: editableOriginal.ext }
          : {}),
        hidden:
          !shifted && slides && shown.length < slides.length && drawn.total === shown.length
            ? slides.length - shown.length
            : 0,
        pages: drawn.pages.length,
        total: drawn.total,
        failed: drawn.failed,
        withNotes: parsed.groups.flatMap((g) => g.slides).filter((sl) => sl.notes !== '').length,
        animated: shown.filter((sl) => sl.animated).length,
        notesUnmatched: !shifted && slides !== null && notes === null && slides.some((sl) => sl.notes !== ''),
      });
      parsed.issues.splice(1, 0, ...deckIssues, ...picturesMediaIssues(added));
      if (!shifted) await addDeckFonts(parsed, keynoteExport?.file);
      told.how = 'pictures';
      told.slides = slideCount(parsed);
      // In place of its slides shown as these pictures while its animations were tried (Session 56), unless changed.
      if (keptAsChanged(file, where, early)) return;
      const earlyShown = early.shown;
      await steps.time('write', () =>
        importPresentation(
          file,
          where,
          'pictures',
          hash,
          parsed,
          decided,
          retained,
          earlyShown ? { after: earlyShown } : undefined,
        ),
      );
      early.done = true;
      told.shownMs ??= Math.round(steps.elapsed());
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  };

  /** A Word file's lyrics (Session 26f): read from the zip, its words through the text file's code. */
  const importDocx = async (file: ScannedFile, where: Where) => {
    const fileName = basename(file.path);
    let t = performance.now();
    const read = await readDocx(file.path, file.path);
    t = time('parse', t);
    if (!read.ok) {
      failed(where, 'text', fileName, read.message, [
        { severity: 'error', code: read.code, message: read.message, fix: null },
      ]);
      return;
    }
    const { sha256: hash } = await sha256File(file.path);
    time('read', t);
    await importPresentation(file, where, 'docx', hash, read.parsed);
  };

  const importText = async (file: ScannedFile, where: Where) => {
    if (extOf(file.path) === 'docx') {
      await importDocx(file, where);
      return;
    }
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
    const base = { sourcePath: where.sourcePath, format: reportFormat(kind), counts: NO_COUNTS };
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
        return { item, marked: media.marked };
      },
      {
        committed: ({ item, marked }) => {
          addToTotals(totals, item);
          told(marked);
        },
        failed: (error) => {
          failed(
            where,
            reportFormat(kind),
            doc.name,
            `Could not write this playlist: ${errorText(error)}`,
            [],
            at,
          );
        },
      },
    );
  };

  /**
   * A props file (Session 55, Part 12: Props are gone from Drashti): left out, and said so in the report, never
   * imported. Props an earlier import kept stay in the library, unseen.
   */
  const skipProps = (where: Where, kind: 'pp6' | 'pp7') => {
    record({
      sourcePath: where.sourcePath,
      format: kind,
      outcome: 'skipped',
      name: basename(where.sourcePath),
      target: null,
      counts: NO_COUNTS,
      message: 'Drashti no longer has props, so this file of props was left out.',
      issues: [],
    });
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
      skipProps(where, 'pp6');
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
    else if (parsed.kind === 'props') skipProps(where, 'pp7');
    else await importPlaylist(where, 'pp7', hash, parsed.playlist);
  };

  const importMedia = async (file: ScannedFile, where: Where) => {
    const t = performance.now();
    const stage = await ctx.media.stage(file.path, ctx.options.maxVideoHeight);
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
          // What cannot play: converted by itself (Session 50), or offered for Convert.
          issues: playIssues(basename(file.path), result),
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

  // ---- what an admin loads: books (Shastra until alpha.15; and, later, calendars and quotes) -----

  const importShastra = (where: Where, fileName: string, hash: string, raw: unknown) => {
    const read = readShastraFile(raw);
    if (!read.ok) {
      failed(where, 'shastra', fileName, read.message);
      return;
    }
    // In one form, NFC (Sessions 31–36, I18N-6).
    const text = nfcDeep(read.text);
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
                }. Find a passage in Books by typing its reference${
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
          failed(where, 'shastra', fileName, `Could not load this book: ${errorText(error)}`, [], at);
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
    // In one form, NFC (Sessions 31–36, I18N-6).
    const calendar = nfcDeep(read.calendar);
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
        'A JSON file that is not a book or a calendar Drashti knows (see docs/shastra-format.md and docs/calendar-format.md).',
      issues: [],
    });
  };

  async function importOne(file: ScannedFile, where: Where): Promise<void> {
    const name = basename(file.path).toLowerCase();
    const ext = extOf(file.path);
    // Simple Mode (Session 55, Part 18): what its one playlist plays, nothing else (lyrics, the other program's files,
    // a Shastra text or a calendar), each said.
    if (ctx.options.simple === true && file.format !== 'media' && file.format !== 'pictures') {
      record({
        sourcePath: where.sourcePath,
        format: file.format,
        outcome: 'unsupported',
        name: basename(file.path),
        target: null,
        counts: NO_COUNTS,
        message: SIMPLE_IMPORT_LEFT_OUT,
        issues: [],
      });
      return;
    }
    if (ext === 'json') {
      await importJson(file, where);
      return;
    }
    // A picture Drashti does not read (Session 55, Part 5: JPEG XL, SVG, a camera's raw picture) says why.
    const unreadPicture = unreadPictureWords(ext);
    const support =
      SUPPORT_FILES[name] ??
      (SUPPORT_EXTENSIONS[ext] ? { format: 'unknown' as const, message: SUPPORT_EXTENSIONS[ext] } : null) ??
      (unreadPicture ? { format: 'unknown' as const, message: unreadPicture } : null) ??
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
        record({
          sourcePath: where.sourcePath,
          format: 'unknown',
          outcome: 'unsupported',
          name: basename(file.path),
          target: null,
          counts: NO_COUNTS,
          message: ext
            ? `Drashti doesn’t read .${ext} files. Save it in a supported format and import it again.`
            : 'This file has no extension Drashti can read. Add its file extension and import it again.',
          issues: [],
        });
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
    ctx.way?.loop(true);
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
      await giveWay();
    }
    // From here on the import writes little: the main process need not wait for it to give way.
    ctx.way?.loop(false);

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
        timings[key] = Math.round(timings[key] ?? 0);
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
