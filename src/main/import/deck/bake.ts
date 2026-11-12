import { copyFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { PictureSource } from '../../../shared/pictures';
import { readInfo } from '../../convert/read-info';
import {
  CONVERT_LIMITS,
  type ConvertFailed,
  type ConvertLimits,
  type ConvertOptions,
  deckOnWindows,
  exists,
  firstLine,
  type MacSession,
  sleep,
  withMacSession,
} from '../deck-converters';
import { type PptxDeck, readPptxDeck } from '../pictures';
import {
  type CutFiles,
  cutMovie,
  type CutPlan,
  DiskFull,
  measureMotion,
  OnAir,
  onPlan,
  planCuts,
} from './cut';
import { diskFreeBytes } from '../media-store';
import { keynoteMusic } from './keynote-music';
import {
  type Baker,
  inMovie,
  keynotePlan,
  leavesOut,
  type MovieChoice,
  movieChoice,
  type MoviePlan,
  plannedLength,
  powerPointPlan,
} from './plan';
import { macProgress, NO_PROGRESS_MS, noProgress } from './progress';
import { standInMovie, standInSize } from './stand-in-baker';
import { standInPdf } from '../stand-in-converter';
import { writeTimedCopy } from './timed-copy';

/*
 * A deck shown as it was, made at import (Session 54, C2, from C1's trial: assister/session-54-deck-trial.md, "Way 2:
 * Baked by export"). The deck's own app makes a movie of it, which is cut into its steps:
 *
 * - PowerPoint (a Mac's by AppleScript, Windows' through its automation) is given the timed copy
 *   (./timed-copy.ts) and saves it as a movie; an old .ppt is saved as a .pptx first.
 * - Keynote (a Mac with no PowerPoint, or a Keynote file) makes its own PowerPoint copy (for the steps and the
 *   media's files), says each slide's movies' and sounds' volume and loop, has them deleted from its open copy
 *   (never saved), and makes the movie at its own fixed timing.
 * - Each app saves the deck as PDF too: the pictures, should the movie not do.
 * - The stand-in (tests) plays the plan as the timed copy would.
 *
 * Then, never while the stream is on air or recording (Session 50's rule for converting), FFmpeg finds the steps
 * in the movie and cuts them (./cut.ts). Started by Drashti, the app runs hidden and is quit afterwards; one the
 * operator had open is left as it was. Every step has a time limit, as saving a PDF has.
 */

/** What Keynote says of a slide's movie or sound (its PowerPoint copy leaves out the loop). */
export interface KeynoteMedia {
  /** The slide, from 1, hidden ones counted. */
  slide: number;
  kind: 'video' | 'audio';
  /** Where it sits, as fractions of the slide. */
  box: { x: number; y: number; w: number; h: number } | null;
  /** 0 to 1. */
  volume: number;
  loop: boolean;
}

/** A deck made into its steps. */
export interface BakedDeck {
  baker: Baker;
  /** The deck the steps were read from: the file itself, its .pptx (an old .ppt), or Keynote's own copy. */
  deckFile: string;
  deck: PptxDeck;
  plan: MoviePlan;
  cuts: CutPlan;
  /** Each shown slide's steps' files, in the plan's order. */
  files: CutFiles[][];
  /** How long the app and the cut took, in ms. */
  bakeMs: number;
  movie: { width: number; height: number; fps: number; durationMs: number };
  keynoteMedia: KeynoteMedia[];
  /**
   * Which slides went through the movie (Session 56), when not every shown slide did: the rest come in as their
   * pictures (`pdf` has every shown slide); null or left out when every one did.
   */
  choice?: MovieChoice | null;
}

/** Why a deck came in as pictures instead. */
export type BakeFailure =
  /** On air as it was about to start, or (`during`) gone on air while it was made: stopped there. */
  | { kind: 'on-air'; during?: boolean }
  /** Too little free space on the disk: `neededBytes` more than the 2 GB always kept free (C review). */
  | { kind: 'disk'; neededBytes: number }
  | { kind: 'cancelled' }
  | { kind: 'app'; reason: string; message: string; notAllowed?: boolean }
  | { kind: 'off-plan'; cuts: CutPlan }
  | { kind: 'cut'; detail: string }
  | { kind: 'nothing'; detail: string };

export type BakeResult =
  | { ok: true; baked: BakedDeck; pdf: string | null }
  | {
      ok: false;
      why: BakeFailure;
      /** The pictures the app saved meanwhile, when it did. */
      pdf: string | null;
      /** The deck as it was read (an old .ppt's .pptx, Keynote's copy), when it was. */
      deck: PptxDeck | null;
      deckFile: string | null;
      baker: Baker;
    };

export interface BakeOptions extends ConvertOptions {
  /** No progress on the movie for this long, and it is given up on (tests make it short). */
  stallMs?: number;
  ffmpeg: string;
  /** The stream is on air or recording: then nothing is converted (Session 50). */
  onAir?: () => Promise<boolean>;
  /** How far it has got, in a few words. */
  progress?: (note: string) => void;
  /** The free space on the disk of a folder (tests give their own). */
  freeBytes?: (dir: string) => number;
  /** Tests only (Session 56's timing check): the stand-in's movie this many lines high (else 180). */
  standInLines?: number | null;
  /** Tests only (Session 56): the stand-in makes its movie only once this file is there (a deck seen preparing). */
  standInHold?: string | null;
  /**
   * The PDF of every shown slide is saved, before the movie is made, and the deck as read (Session 56): the slides can
   * show as their pictures while their animations are made. Once, by every app and the stand-in. On Windows (Session
   * 57) PowerPoint's movie starts only once what this returns has settled: the pictures drawn and written first.
   */
  pdfReady?: (pdf: string, deck: PptxDeck) => void | Promise<void>;
}

/** Always kept free on the disk, as converting keeps it (Session 50). */
export const KEEP_FREE_BYTES = 2 * 1024 ** 3;

/**
 * What making a deck's animations may take on the disk (C review): its timed copy and its own media taken out
 * (twice the deck), and its movie and its cut steps (about 3 MB a second of movie, the cut steps at the movie's
 * picture twice over).
 */
export function bakeBytes(deckBytes: number, plannedMs: number): number {
  return 2 * deckBytes + Math.ceil((3_000_000 * plannedMs) / 1000);
}

/** A movie the app (or the stand-in) made, and what it was made from. */
type Made =
  | {
      ok: true;
      movie: string;
      deckFile: string;
      deck: PptxDeck;
      plan: MoviePlan;
      pdf: string | null;
      keynoteMedia: KeynoteMedia[];
      /** Which slides went through the movie, when not every shown slide did (its PDF has them all). */
      choice: MovieChoice | null;
    }
  | {
      ok: false;
      failed: ConvertFailed | { kind: 'nothing'; detail: string };
      pdf: string | null;
      deck: PptxDeck | null;
      deckFile: string | null;
    };

const movieLimit = (limits: ConvertLimits, plan: MoviePlan) =>
  limits.movieMs + limits.perMovieSecondMs * Math.ceil(plannedLength(plan) / 1000);

/** A movie that has not appeared by then is never coming (C review: PowerPoint asking something nobody sees). */
export const MOVIE_APPEARS_MS = 120_000;
/** A movie that has not grown for this long, and does not read as one, has stopped being written. */
export const MOVIE_STALLS_MS = 60_000;

/**
 * Wait for PowerPoint's movie: its `save as movie` answers at once and the file grows meanwhile. It is done when
 * its size has held for 2 s and it is as long as planned, or its size has held for 10 s and it reads as a movie.
 * It is given up on when it has not appeared within 2 minutes, or has not grown for a minute without reading as
 * a movie (Session 54, C review), or at the time limit.
 */
export async function settledMovie(
  ffmpeg: string,
  path: string,
  plannedMs: number,
  options: { limitMs: number; appearMs?: number; stallMs?: number; signal?: AbortSignal },
): Promise<'done' | 'never' | 'stalled' | 'timeout' | 'stopped'> {
  const { signal } = options;
  const started = Date.now();
  const until = started + options.limitMs;
  let last = -1;
  let held = 0;
  let grew = started;
  while (Date.now() < until) {
    if (signal?.aborted) return 'stopped';
    const size = await stat(path).then(
      (s) => s.size,
      () => 0,
    );
    held = size > 0 && size === last ? held + 1 : 0;
    if (size !== last) grew = Date.now();
    last = size;
    if (size === 0 && Date.now() - started > (options.appearMs ?? MOVIE_APPEARS_MS)) return 'never';
    if (held >= 4 && held % 4 === 0) {
      const info = await readInfo(ffmpeg, path, { timeoutMs: 30_000 });
      const length = info.durationMs ?? 0;
      if (length >= plannedMs - 1500 || (held >= 20 && length > 0)) return 'done';
    }
    if (size > 0 && Date.now() - grew > (options.stallMs ?? MOVIE_STALLS_MS)) return 'stalled';
    await sleep(500, signal);
  }
  return signal?.aborted ? 'stopped' : 'timeout';
}

/** Wait a moment for a file an app said it wrote. */
async function written(path: string, signal?: AbortSignal): Promise<boolean> {
  for (let i = 0; i < 40 && !exists(path); i++) await sleep(250, signal);
  return exists(path);
}

// ---- PowerPoint on a Mac --------------------------------------------------------------------------

async function powerPointOnMac(
  source: PictureSource,
  input: string,
  read: PptxDeck | null,
  work: string,
  options: BakeOptions,
): Promise<Made> {
  const limits = options.limits ?? CONVERT_LIMITS;
  let deck = read;
  let deckFile = source === 'pptx' ? input : null;
  let pdf: string | null = null;
  const result = await withMacSession(
    'powerpoint',
    input,
    work,
    limits,
    options,
    async (s: MacSession): Promise<Made | ConvertFailed> => {
      const seconds = (slides: number) =>
        Math.ceil((limits.saveMs + limits.perSlideMs * Math.max(slides, 1)) / 1000);
      if (source === 'ppt') {
        // An old .ppt: PowerPoint saves it as a .pptx first, which is read for the steps.
        const opened = await s.open(input);
        if (!opened.ok) return opened.failed;
        await s.hide();
        // Under the copy's own name, as PowerPoint then calls it: still Drashti's, and closed by that name (Session
        // 54, C review: as deck.pptx it stayed open, and the PowerPoint Drashti started with it).
        const { copy } = opened.document;
        const inApp = join(dirname(copy), `${basename(copy, extname(copy))}.pptx`);
        const saved = await s.tell(
          [
            'save presentation (item 1 of argv) in (POSIX file (item 2 of argv)) as save as Open XML presentation',
            'return ""',
          ],
          [opened.document.doc, inApp],
          seconds(opened.document.slides),
        );
        if (saved.code !== 0) return s.fromError(saved, 'saving it as a .pptx', 'save it as a .pptx');
        if (!(await written(inApp, s.signal)))
          return s.fromError(saved, 'saving it as a .pptx', 'save it as a .pptx');
        await s.savedAs(opened.document, inApp);
        deckFile = join(work, 'deck.pptx');
        await copyFile(inApp, deckFile);
        await s.close(opened.document);
        deck = await readPptxDeck(deckFile);
        s.log('saved as a .pptx');
      }
      if (!deck || !deckFile)
        return {
          ok: false,
          reason: 'no deck',
          message: 'The deck could not be read: save it again in PowerPoint or Keynote and import that.',
        };
      // Only the slides that move go through the movie (Session 56), when any do not: the rest come in as their
      // pictures, so the PDF is then saved from a copy with every shown slide, and the movie from one with them hidden.
      const deckPath = deckFile;
      const choice = movieChoice(deck.slides);
      const leaving = leavesOut(choice);
      const all = powerPointPlan(deck.slides);
      const plan = leaving ? powerPointPlan(deck.slides, 'powerpoint', inMovie(choice)) : all;
      if (plan.slides.length === 0)
        return {
          ok: false,
          failed: { kind: 'nothing', detail: 'every slide is hidden' },
          pdf,
          deck,
          deckFile,
        };
      const timedCopy = async (file: string, of: MoviePlan, hide: Iterable<number>) => {
        const copyFrom = performance.now();
        await writeTimedCopy(deckPath, file, of, hide);
        options.steps?.add('timed-copy', performance.now() - copyFrom);
      };
      /** The pictures of the copy open as `document`, saved as PDF into the import's folder (null: they were not). */
      const savePdf = async (document: { doc: string; slides: number; copy: string }) => {
        const pdfInApp = join(dirname(document.copy), 'pictures.pdf');
        const pdfFrom = performance.now();
        const savedPdf = await s.tell(
          ['save presentation (item 1 of argv) in (POSIX file (item 2 of argv)) as save as PDF', 'return ""'],
          [document.doc, pdfInApp],
          seconds(document.slides),
        );
        let saved: string | null = null;
        if (savedPdf.code === 0 && (await written(pdfInApp, s.signal))) {
          saved = join(work, 'pictures.pdf');
          await copyFile(pdfInApp, saved);
        } else s.log(`could not save it as PDF: ${firstLine(savedPdf.stderr)}`);
        options.steps?.add('app-pdf', performance.now() - pdfFrom);
        return saved;
      };
      if (leaving) {
        // Every shown slide's picture first, from the timed copy of them all, which then closes.
        const allCopy = join(work, 'timed-all.pptx');
        await timedCopy(allCopy, all, []);
        const openedAll = await s.open(allCopy);
        if (!openedAll.ok) return openedAll.failed;
        await s.hide();
        pdf = await savePdf(openedAll.document);
        await s.close(openedAll.document);
        if (!pdf)
          return {
            ok: false,
            reason: 'it did not save the slides as PDF',
            message:
              'PowerPoint could not save the deck’s pictures: save the deck again in PowerPoint and import that.',
          };
        void options.pdfReady?.(pdf, deck);
      }
      // The timed copy, opened as any copy is (in PowerPoint's own folder): the slides that come in as their pictures
      // hidden in it, so the movie leaves them out.
      const timed = join(work, 'timed.pptx');
      await timedCopy(timed, plan, leaving ? choice.pictures : []);
      const opened = await s.open(timed);
      if (!opened.ok) return opened.failed;
      // PowerPoint shows itself as it opens a document: hidden while it works.
      await s.hide();
      const { doc } = opened.document;
      const inside = dirname(opened.document.copy);
      // The pictures first (a moment): should the movie not do, the deck comes in as them.
      if (!leaving) {
        pdf = await savePdf(opened.document);
        if (pdf) void options.pdfReady?.(pdf, deck);
      }
      // The movie: asked for, then written in the background.
      const movieInApp = join(inside, 'movie.mov');
      const movieFrom = performance.now();
      options.progress?.('PowerPoint is making the movie');
      const asked = await s.tell(
        [
          'save presentation (item 1 of argv) in (POSIX file (item 2 of argv)) as save as movie',
          'return "asked"',
        ],
        [doc, movieInApp],
        60,
      );
      if (asked.code !== 0) return s.fromError(asked, 'making its movie', 'make its movie');
      const limitMs = movieLimit(limits, plan);
      const waited = await settledMovie(options.ffmpeg, movieInApp, plannedLength(plan), {
        limitMs,
        signal: s.signal,
      });
      if (waited === 'never' || waited === 'stalled')
        return {
          ok: false,
          reason:
            waited === 'never'
              ? 'it had not started writing the movie after 2 minutes'
              : 'it stopped writing the movie for a minute',
          message: 'PowerPoint did not make the deck’s movie.',
        };
      if (waited !== 'done') {
        if (waited === 'stopped')
          return { ok: false, reason: 'cancelled', message: 'Cancelled.', cancelled: true };
        return {
          ok: false,
          reason: `PowerPoint did not finish the movie within ${String(Math.round(limitMs / 60_000))} minutes`,
          message: 'PowerPoint did not finish the deck’s movie in time.',
        };
      }
      const movie = join(work, 'movie.mov');
      await copyFile(movieInApp, movie);
      options.steps?.add('movie', performance.now() - movieFrom);
      s.log('made the movie');
      await s.close(opened.document);
      return {
        ok: true,
        movie,
        deckFile,
        deck,
        plan,
        pdf,
        keynoteMedia: [],
        choice: leaving ? choice : null,
      };
    },
  );
  return 'movie' in result
    ? result
    : 'failed' in result
      ? result
      : { ok: false, failed: result, pdf, deck, deckFile };
}

// ---- Keynote --------------------------------------------------------------------------------------

/** Keynote's lines about each slide's movies and sounds: `slide`, kind, place and size (points), volume, repeat. */
export function parseKeynoteMedia(text: string): KeynoteMedia[] {
  const lines = text.split(/\r?\n/u).filter((l) => l.trim() !== '');
  const [, w = '0', h = '0'] = (lines[0] ?? '').split('\t');
  const width = Number(w);
  const height = Number(h);
  const out: KeynoteMedia[] = [];
  for (const line of lines.slice(1)) {
    const [slide, kind, x, y, bw, bh, volume, repeat] = line.split('\t');
    const n = Number(slide);
    if (!Number.isInteger(n) || (kind !== 'video' && kind !== 'audio')) continue;
    const box =
      width > 0 && height > 0 && [x, y, bw, bh].every((v) => v !== undefined && Number.isFinite(Number(v)))
        ? { x: Number(x) / width, y: Number(y) / height, w: Number(bw) / width, h: Number(bh) / height }
        : null;
    const v = Number(volume);
    out.push({
      slide: n,
      kind,
      box,
      volume: Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 1,
      // "loop" and "loop back and forth" both play on.
      loop: (repeat ?? '').trim().startsWith('loop'),
    });
  }
  return out;
}

const KEYNOTE_MEDIA_SCRIPT = [
  'set d to document id (item 1 of argv)',
  'set res to "size" & tab & ((width of d) as text) & tab & ((height of d) as text) & linefeed',
  'set n to 0',
  'repeat with s in slides of d',
  'set n to n + 1',
  'repeat with m in movies of s',
  'set p to position of m',
  'set res to res & (n as text) & tab & "video" & tab & ((item 1 of p) as text) & tab & ((item 2 of p) as text) & tab & ((width of m) as text) & tab & ((height of m) as text) & tab & ((movie volume of m) as text) & tab & ((repetition method of m) as text) & linefeed',
  'end repeat',
  'repeat with c in audio clips of s',
  'set entry to (n as text) & tab & "audio"',
  'try',
  'set p to position of c',
  'set entry to entry & tab & ((item 1 of p) as text) & tab & ((item 2 of p) as text) & tab & ((width of c) as text) & tab & ((height of c) as text)',
  'on error',
  'set entry to entry & tab & "" & tab & "" & tab & "" & tab & ""',
  'end try',
  'set res to res & entry & tab & ((clip volume of c) as text) & tab & ((repetition method of c) as text) & linefeed',
  'end repeat',
  'end repeat',
  'return res',
];

async function keynoteOnMac(
  input: string,
  read: PptxDeck | null,
  work: string,
  options: BakeOptions,
): Promise<Made> {
  const limits = options.limits ?? CONVERT_LIMITS;
  let deck: PptxDeck | null = null;
  let deckFile: string | null = null;
  let pdf: string | null = null;
  const result = await withMacSession(
    'keynote',
    input,
    work,
    limits,
    options,
    async (s: MacSession): Promise<Made | ConvertFailed> => {
      const opened = await s.open(input);
      if (!opened.ok) return opened.failed;
      await s.hide();
      const { doc, slides, copy } = opened.document;
      const inside = dirname(copy);
      const seconds = Math.ceil((limits.saveMs + limits.perSlideMs * Math.max(slides, 1)) / 1000);
      // Keynote's copy of a PowerPoint file kept in Drashti's own folder before anything in it changes (Session 54,
      // C review): once its movies are taken out, macOS would otherwise save it by itself into the operator's Keynote
      // documents, iCloud Drive's, a copy of every deck imported.
      if (extname(copy).toLowerCase() !== '.key') {
        const kept = join(inside, `${basename(copy, extname(copy))}.key`);
        const saved = await s.tell(
          ['save (document id (item 1 of argv)) in (POSIX file (item 2 of argv))', 'return ""'],
          [doc, kept],
          seconds,
        );
        if (saved.code !== 0)
          s.log(`could not keep its copy in Drashti’s folder: ${firstLine(saved.stderr)}`);
      }
      // Its own PowerPoint copy: the steps and their lengths as Keynote has them, and the media's files.
      const ownCopy = join(inside, 'keynote.pptx');
      const exported = await s.tell(
        [
          'export (document id (item 1 of argv)) to (POSIX file (item 2 of argv)) as Microsoft PowerPoint',
          'return ""',
        ],
        [doc, ownCopy],
        seconds,
      );
      if (exported.code !== 0 || !(await written(ownCopy, s.signal)))
        return s.fromError(exported, 'saving it as PowerPoint', 'save it as PowerPoint');
      deckFile = join(work, 'keynote.pptx');
      await copyFile(ownCopy, deckFile);
      // Its sounds across slides as the deck plays them (Session 54, keynote-music.ts): a .pptx's own say across how
      // many slides, how loud and whether they loop; a .key's soundtrack plays across the whole deck, at full volume.
      deck = keynoteMusic(await readPptxDeck(deckFile), { original: read, movieSound: null });
      const choice = movieChoice(deck.slides);
      let leaving = leavesOut(choice);
      const all = keynotePlan(deck.slides);
      if (all.slides.length === 0)
        return {
          ok: false,
          failed: { kind: 'nothing', detail: 'every slide is skipped' },
          pdf,
          deck,
          deckFile,
        };
      // What Keynote says of the movies and sounds, then they go from its copy (never saved).
      const told = await s.tell(KEYNOTE_MEDIA_SCRIPT, [doc], seconds);
      if (told.code !== 0) s.log(`could not tell its movies and sounds: ${firstLine(told.stderr)}`);
      const keynoteMedia = told.code === 0 ? parseKeynoteMedia(told.stdout) : [];
      const pdfInApp = join(inside, 'pictures.pdf');
      const pdfFrom = performance.now();
      const savedPdf = await s.tell(
        [
          'export (document id (item 1 of argv)) to (POSIX file (item 2 of argv)) as PDF with properties {PDF image quality:Best, skipped slides:false}',
          'return ""',
        ],
        [doc, pdfInApp],
        seconds,
      );
      if (savedPdf.code === 0 && (await written(pdfInApp, s.signal))) {
        pdf = join(work, 'pictures.pdf');
        await copyFile(pdfInApp, pdf);
        void options.pdfReady?.(pdf, deck);
      }
      options.steps?.add('app-pdf', performance.now() - pdfFrom);
      // Only the slides that move go through the movie (Session 56): the rest, which come in as their pictures, are
      // skipped in Keynote's copy (never saved), which its movie leaves out. Asked back: if Keynote did not skip them
      // all, none is, and every slide goes through the movie as before.
      if (leaving && !pdf) leaving = false;
      if (leaving) {
        const numbers = [...choice.pictures].map((i) => String(i + 1));
        const skipping = (on: boolean) => [
          'set d to document id (item 1 of argv)',
          'set c to 0',
          'repeat with i from 2 to (count of argv)',
          'set n to (item i of argv) as integer',
          `set skipped of slide n of d to ${on ? 'true' : 'false'}`,
          `if (skipped of slide n of d) is ${on ? 'true' : 'false'} then set c to c + 1`,
          'end repeat',
          'return c as text',
        ];
        const skipped = await s.tell(skipping(true), [doc, ...numbers], seconds);
        if (skipped.code !== 0 || Number(skipped.stdout.trim()) !== numbers.length) {
          s.log(`could not skip the slides that come in as pictures: ${firstLine(skipped.stderr)}`);
          await s.tell(skipping(false), [doc, ...numbers], seconds);
          leaving = false;
        }
      }
      const plan = leaving ? keynotePlan(deck.slides, inMovie(choice)) : all;
      const deleted = await s.tell(
        [
          'set d to document id (item 1 of argv)',
          'repeat with s in slides of d',
          'delete every movie of s',
          'delete every audio clip of s',
          'end repeat',
          'return ""',
        ],
        [doc],
        seconds,
      );
      if (deleted.code !== 0)
        return s.fromError(deleted, 'taking out its movies and sounds', 'take out its movies and sounds');
      options.progress?.('Keynote is making the movie');
      const movieInApp = join(inside, 'movie.m4v');
      const movieFrom = performance.now();
      // Its export answers only once the movie is made: watched meanwhile, and given up on after a minute with no
      // progress, neither the movie growing nor Keynote at work (Session 54, C review).
      const pids = await s.pids();
      const watching = new AbortController();
      const stalled = new AbortController();
      const before = await macProgress(pids, movieInApp);
      const startedAt = Date.now();
      void noProgress(() => macProgress(pids, movieInApp), {
        signal: watching.signal,
        stallMs: options.stallMs ?? NO_PROGRESS_MS,
      }).then((r) => {
        if (r === 'stalled') stalled.abort();
      });
      const made = await s.tell(
        [
          'export (document id (item 1 of argv)) to (POSIX file (item 2 of argv)) as QuickTime movie with properties {movie format:format1080p}',
          'return ""',
        ],
        [doc, movieInApp],
        Math.ceil(movieLimit(limits, plan) / 1000),
        stalled.signal,
      );
      watching.abort();
      if (stalled.signal.aborted && !s.signal?.aborted)
        return s.stuck('making its movie (no progress for a minute)');
      const after = await macProgress(pids, movieInApp);
      if (before.cpuMs !== null && after.cpuMs !== null)
        s.log(
          `used ${String(after.cpuMs - before.cpuMs)} ms of processor time making the movie in ${String(Date.now() - startedAt)} ms`,
        );
      if (made.code !== 0 || !(await written(movieInApp, s.signal)))
        return s.fromError(made, 'making its movie', 'make its movie');
      const movie = join(work, 'movie.m4v');
      await copyFile(movieInApp, movie);
      options.steps?.add('movie', performance.now() - movieFrom);
      s.log('made the movie');
      await s.close(opened.document);
      return { ok: true, movie, deckFile, deck, plan, pdf, keynoteMedia, choice: leaving ? choice : null };
    },
  );
  return 'movie' in result
    ? result
    : 'failed' in result
      ? result
      : { ok: false, failed: result, pdf, deck, deckFile };
}

// ---- PowerPoint on Windows ----------------------------------------------------------------------------

async function powerPointOnWindows(
  source: PictureSource,
  input: string,
  read: PptxDeck | null,
  work: string,
  options: BakeOptions,
): Promise<Made> {
  const limits = options.limits ?? CONVERT_LIMITS;
  let deck = read;
  let deckFile = source === 'pptx' ? input : null;
  if (source === 'ppt') {
    deckFile = join(work, 'deck.pptx');
    const saved = await deckOnWindows({ input, pptx: deckFile }, work, options);
    if (!saved.ok) return { ok: false, failed: saved, pdf: null, deck: null, deckFile: null };
    deck = await readPptxDeck(deckFile);
  }
  if (!deck || !deckFile)
    return {
      ok: false,
      failed: {
        kind: 'nothing',
        detail: 'the deck could not be read: save it again in PowerPoint or Keynote and import that',
      },
      pdf: null,
      deck,
      deckFile,
    };
  // Only the slides that move go through the movie (Session 56), when any do not: the PDF is then saved from a copy
  // with every shown slide first, and the movie from one with the rest hidden.
  const choice = movieChoice(deck.slides);
  const leaving = leavesOut(choice);
  const plan = leaving
    ? powerPointPlan(deck.slides, 'powerpoint', inMovie(choice))
    : powerPointPlan(deck.slides);
  if (plan.slides.length === 0)
    return {
      ok: false,
      failed: { kind: 'nothing', detail: 'every slide is hidden' },
      pdf: null,
      deck,
      deckFile,
    };
  const timed = join(work, 'timed.pptx');
  const pdf = join(work, 'pictures.pdf');
  // Every shown slide's picture first, in a run of PowerPoint of its own (Session 56): the PDF of the timed copy of them
  // all, so that the slides show as their pictures while the movie is made, and those left out of the movie come in so.
  {
    const all = join(work, 'timed-all.pptx');
    const copyFrom = performance.now();
    await writeTimedCopy(deckFile, all, powerPointPlan(deck.slides));
    options.steps?.add('timed-copy', performance.now() - copyFrom);
    const pdfFrom = performance.now();
    const saved = await deckOnWindows({ input: all, pdf }, work, {
      ...options,
      slideCount: deck.slides.length,
    });
    options.steps?.add('app-pdf', performance.now() - pdfFrom);
    if (!saved.ok || !exists(pdf))
      return {
        ok: false,
        failed: saved.ok
          ? {
              ok: false,
              reason: 'it did not save the slides as PDF',
              message:
                'PowerPoint could not save the deck’s pictures: save the deck again in PowerPoint and import that.',
            }
          : saved,
        pdf: null,
        deck,
        deckFile,
      };
    // Let the library show the pictures before starting the Windows movie process.
    await options.pdfReady?.(pdf, deck);
    // Cancelled, or on air, while they were drawn (Session 57, the part 3 review's LOW-2): no timed copy, no movie.
    if (options.signal?.aborted)
      return {
        ok: false,
        failed: { ok: false, reason: 'cancelled', message: 'Cancelled.', cancelled: true },
        pdf,
        deck,
        deckFile,
      };
  }
  const copyFrom = performance.now();
  await writeTimedCopy(deckFile, timed, plan, leaving ? choice.pictures : []);
  options.steps?.add('timed-copy', performance.now() - copyFrom);
  const movie = join(work, 'movie.mp4');
  options.progress?.('PowerPoint is making the movie');
  // One run of PowerPoint for the movie (its start and the movie): the movie's step, as one.
  const movieFrom = performance.now();
  const made = await deckOnWindows(
    {
      input: timed,
      movie,
      movieLimitMs: movieLimit(limits, plan),
      stallMs: NO_PROGRESS_MS,
    },
    work,
    { ...options, slideCount: deck.slides.length },
  );
  options.steps?.add('movie', performance.now() - movieFrom);
  const pictures = exists(pdf) ? pdf : null;
  if (!made.ok) return { ok: false, failed: made, pdf: pictures, deck, deckFile };
  return {
    ok: true,
    movie,
    deckFile,
    deck,
    plan,
    pdf: pictures,
    keynoteMedia: [],
    choice: leaving ? choice : null,
  };
}

// ---- the stand-in (tests) -----------------------------------------------------------------------------

async function standIn(
  input: string,
  read: PptxDeck | null,
  work: string,
  options: BakeOptions,
): Promise<Made> {
  if (!read)
    return {
      ok: false,
      failed: { kind: 'nothing', detail: 'not a .pptx' },
      pdf: null,
      deck: null,
      deckFile: null,
    };
  // Only the slides that move go through the movie (Session 56), when any do not: the rest come in as their
  // pictures, saved as PDF first as PowerPoint saves them (every shown slide).
  const choice = movieChoice(read.slides);
  const leaving = leavesOut(choice);
  const plan = powerPointPlan(read.slides, 'stand-in', leaving ? inMovie(choice) : undefined);
  if (plan.slides.length === 0)
    return {
      ok: false,
      failed: { kind: 'nothing', detail: 'every slide is hidden' },
      pdf: null,
      deck: read,
      deckFile: input,
    };
  // Every shown slide's picture first, as PowerPoint saves them (Session 56).
  const pdfFrom = performance.now();
  const pdf = await standInPdf(input, read.slides, work);
  options.steps?.add('app-pdf', performance.now() - pdfFrom);
  void options.pdfReady?.(pdf, read);
  // Held by a test until it has seen the slides preparing (Session 56).
  const hold = options.standInHold;
  if (hold) while (!exists(hold) && !options.signal?.aborted) await sleep(100, options.signal);
  const movie = join(work, 'movie.mp4');
  const movieFrom = performance.now();
  await standInMovie(options.ffmpeg, plan, movie, options.signal, standInSize(options.standInLines ?? null));
  options.steps?.add('movie', performance.now() - movieFrom);
  return {
    ok: true,
    movie,
    deckFile: input,
    deck: read,
    plan,
    pdf,
    keynoteMedia: [],
    choice: leaving ? choice : null,
  };
}

// ---- the bake -----------------------------------------------------------------------------------------

/**
 * Make a deck into its steps with `baker`: its movie, then the cut. `read` is the deck as read already (a .pptx);
 * `work` a folder of its own, where everything made is left for the import to take.
 */
export async function bakeDeck(
  baker: Baker,
  request: { source: PictureSource; input: string; read: PptxDeck | null; work: string },
  options: BakeOptions,
): Promise<BakeResult> {
  const started = Date.now();
  const { source, input, read, work } = request;
  const platform = options.platform ?? process.platform;
  // The stream going on air or recording while the app makes the movie stops it there (Session 50's rule): looked
  // at every 2 s, as the app's long steps give no turn to ask between.
  // Room on the disk first (C review): its movie and steps, besides the 2 GB always kept free; and the disk going
  // under those 2 GB while it is made stops it, as the stream going on air does.
  const free = options.freeBytes ?? diskFreeBytes;
  const deckBytes = await stat(input).then(
    (s) => s.size,
    () => 0,
  );
  const need = bakeBytes(deckBytes, read ? plannedLength(powerPointPlan(read.slides)) : 0);
  const short = KEEP_FREE_BYTES + need - free(work);
  if (short > 0)
    return {
      ok: false,
      why: { kind: 'disk', neededBytes: short },
      pdf: null,
      deck: read,
      deckFile: null,
      baker,
    };
  const airing = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, airing.signal]) : airing.signal;
  const stop = { full: false };
  const watch =
    baker !== 'stand-in'
      ? setInterval(() => {
          if (free(work) < KEEP_FREE_BYTES) {
            stop.full = true;
            airing.abort();
          }
          void options.onAir?.().then((on) => {
            if (on) airing.abort();
          });
        }, 2000)
      : null;
  const onAirNow = () => airing.signal.aborted && !stop.full;
  const disk: BakeFailure = { kind: 'disk', neededBytes: need };
  let made: Made;
  try {
    const appOptions = { ...options, signal };
    made =
      baker === 'stand-in'
        ? await standIn(input, read, work, appOptions)
        : baker === 'keynote'
          ? await keynoteOnMac(input, read, work, appOptions)
          : platform === 'win32'
            ? await powerPointOnWindows(source, input, read, work, appOptions)
            : await powerPointOnMac(source, input, read, work, appOptions);
  } catch (error) {
    if (stop.full) return { ok: false, why: disk, pdf: null, deck: read, deckFile: null, baker };
    if (onAirNow())
      return {
        ok: false,
        why: { kind: 'on-air', during: true },
        pdf: null,
        deck: read,
        deckFile: null,
        baker,
      };
    if (options.signal?.aborted)
      return { ok: false, why: { kind: 'cancelled' }, pdf: null, deck: read, deckFile: null, baker };
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      why: { kind: 'app', reason: detail, message: detail },
      pdf: null,
      deck: read,
      deckFile: null,
      baker,
    };
  } finally {
    if (watch) clearInterval(watch);
  }
  if (!made.ok) {
    const f = made.failed;
    const why: BakeFailure =
      'kind' in f
        ? f
        : stop.full
          ? disk
          : onAirNow()
            ? { kind: 'on-air', during: true }
            : f.cancelled
              ? { kind: 'cancelled' }
              : {
                  kind: 'app',
                  reason: f.reason,
                  message: f.message,
                  ...(f.notAllowed ? { notAllowed: true } : {}),
                };
    return { ok: false, why, pdf: made.pdf, deck: made.deck, deckFile: made.deckFile, baker };
  }
  const failed = (why: BakeFailure): BakeResult => ({
    ok: false,
    why,
    pdf: made.pdf,
    deck: made.deck,
    deckFile: made.deckFile,
    baker,
  });
  // Never while the stream is on air or recording: the cut is FFmpeg's work (Session 50).
  if (await options.onAir?.()) return failed({ kind: 'on-air' });
  try {
    options.progress?.('Finding the steps in the movie');
    const findFrom = performance.now();
    const motion = await measureMotion(options.ffmpeg, made.movie, options.signal);
    // Keynote's movie silent: a .key's soundtrack Keynote copied is Off, so it never plays (keynote-music.ts).
    const deck =
      baker === 'keynote' && !motion.sound
        ? keynoteMusic(made.deck, { original: read, movieSound: false })
        : made.deck;
    const cuts = planCuts(made.plan, motion);
    options.steps?.add('find-steps', performance.now() - findFrom);
    options.log?.(
      `Deck: ${String(cuts.offsets.length)} steps checked, the furthest ${cuts.worst ? `${String(cuts.worst.offsetMs)} ms (slide ${String(cuts.worst.slide + 1)}, step ${String(cuts.worst.step)})` : 'not measured'}; slides not found: ${cuts.lostSlides.map((i) => String(i + 1)).join(', ') || 'none'}`,
    );
    if (!onPlan(cuts)) return failed({ kind: 'off-plan', cuts });
    const cutFrom = performance.now();
    // A lead-in is in the movie only for the slide after it (Session 56): never cut.
    const leadIns = new Set(
      made.plan.slides.flatMap((slide, i) => (made.choice?.leadIns.has(slide.index) ? [i] : [])),
    );
    const files = await cutMovie(options.ffmpeg, made.movie, cuts, join(work, 'steps'), {
      leadIns,
      signal: options.signal,
      progress: (done, total) => {
        options.progress?.(`Cutting step ${String(done)} of ${String(total)}`);
      },
      onAir: options.onAir,
      // Under the 2 GB always kept free, the cut stops too.
      full: () => free(work) < KEEP_FREE_BYTES,
    });
    options.steps?.add('cut', performance.now() - cutFrom);
    return {
      ok: true,
      pdf: made.pdf,
      baked: {
        baker,
        deckFile: made.deckFile,
        deck,
        plan: made.plan,
        cuts,
        files,
        bakeMs: Date.now() - started,
        movie: { width: motion.width, height: motion.height, fps: motion.fps, durationMs: motion.durationMs },
        keynoteMedia: made.keynoteMedia,
        choice: made.choice,
      },
    };
  } catch (error) {
    if (error instanceof OnAir) return failed({ kind: 'on-air', during: true });
    if (error instanceof DiskFull) return failed(disk);
    if (options.signal?.aborted) return failed({ kind: 'cancelled' });
    return failed({ kind: 'cut', detail: error instanceof Error ? error.message : String(error) });
  }
}
