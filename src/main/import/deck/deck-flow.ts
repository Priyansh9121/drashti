import { mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ImportIssue } from '../../../shared/import';
import type { PictureSource, PicturesResult } from '../../../shared/pictures';
import type { Converter } from '../deck-converters';
import type { ParsedPresentation } from '../model';
import type { PptxDeck, PptxSlide } from '../pictures';
import { type BakeOptions, bakeDeck, type BakeResult } from './bake';
import {
  addNativeDeckMedia,
  bakedPresentation,
  preparingPresentation,
  stillDeckIssue,
  whyPictures,
} from './deck-import';
import {
  applyNativePages,
  compactNativeAssets,
  nativePresentation,
  prepareNativePptx,
} from './native-deck-import';
import { type Baker, movieChoice } from './plan';

/*
 * A PowerPoint or Keynote file at import (Session 54, C2): with its animations where this computer can make them,
 * else as pictures, as before. The apps that can make its movie are tried in turn (PowerPoint first for its own
 * files, then Keynote on a Mac), only while one could not at all; a movie off its plan, the stream on air or a
 * cancel stops there. Then the import (pipeline.ts) writes the deck with its steps, or its pictures: those the app
 * saved as it went, or saved as PDF as before.
 *
 * Only the slides that move go through the movie (Session 56: plan.ts `movieChoice`): the others come in as their
 * pictures, the pages of the PDF the app saved of every shown slide, drawn here; a deck where nothing moves comes in
 * as its pictures straight away, with no movie made at all.
 */

/**
 * Each shown slide's page among a PDF's drawn pages, for the slides in `need` (a saved PDF leaves hidden slides out,
 * unless it has every slide): by the deck's own index; null when a page cannot be matched or was not drawn.
 */
export function pagesOfShown(
  slides: readonly PptxSlide[],
  drawn: { total: number; pages: readonly { index: number; file: string }[] },
  need: ReadonlySet<number>,
): Map<number, string> | null {
  const shown = slides.flatMap((s, i) => (s.hidden ? [] : [i]));
  // The k-th shown slide, the deck's i-th: the PDF's k-th page, or its i-th when it has every slide.
  const byShown = drawn.total === shown.length;
  if (!byShown && drawn.total !== slides.length) return null;
  const pageOf = (k: number, i: number) => (byShown ? k : i);
  const files = new Map(drawn.pages.map((p) => [p.index, p.file]));
  const out = new Map<number, string>();
  for (const [k, i] of shown.entries()) {
    const file = files.get(pageOf(k, i));
    if (file) out.set(i, file);
    else if (need.has(i)) return null;
  }
  return out;
}

export type DeckFlow =
  | { kind: 'baked'; parsed: ParsedPresentation; sourceIndices?: number[]; editablePptx?: string }
  | {
      kind: 'pictures';
      /** The pictures an app saved while it tried (null: save them as PDF as before). */
      pdf: string | null;
      converter: Converter | null;
      /** The deck as it was read, for its videos and sounds, and the file they are in. */
      deck: PptxDeck | null;
      deckFile: string | null;
      /** Why it came in as pictures, for the report (none when nothing here could make its movie). */
      issues: ImportIssue[];
      cancelled: boolean;
      /** The pages of `pdf`, drawn already as the movie was made (Session 56): not drawn again. */
      drawn?: PicturesResult;
    };

export interface DeckFlowRequest {
  source: Exclude<PictureSource, 'pdf'>;
  file: string;
  fileName: string;
  sourcePath: string;
  /** The received file's folder, kept separate from an immutable own copy. */
  sourceDir?: string;
  /** The .pptx as read already (null for an old .ppt or a Keynote file). */
  read: PptxDeck | null;
  /** A folder of its own. */
  work: string;
  /** What can make its movie here, in the order to try. */
  bakers: Baker[];
}

/**
 * Each app by its name. The tests' stand-in makes a deck's movie as PowerPoint does (its plan is PowerPoint's), and is
 * named as PowerPoint, as a real computer's report says (Session 55: the guides' pictures never show the tests' words).
 */
const APP: Record<Baker, string> = {
  powerpoint: 'PowerPoint',
  keynote: 'Keynote',
  'stand-in': 'PowerPoint',
};

export async function runDeck(
  request: DeckFlowRequest,
  options: BakeOptions & {
    onAir: () => Promise<boolean>;
    /** The deck came in as pictures before: if its animations cannot be made, that import is kept as it was. */
    kept?: boolean;
    /** Keynote or PowerPoint started by Drashti itself (Session 31: the leftovers record). */
    appStarted?: (pid: number, app: 'PowerPoint' | 'Keynote') => void;
    /** Draws a PDF's pages as pictures: the slides that come in as their pictures (Session 56). */
    drawPdf?: (pdf: string, outDir: string) => Promise<PicturesResult>;
    /**
     * The slides as their pictures as soon as those are drawn (Session 56), with each one's own index in the deck: the
     * slides that move marked as preparing while their clips are made. The import writes them at once; the deck with
     * its steps (or as its pictures) then takes their place.
     */
    early?: (parsed: ParsedPresentation, indices: number[]) => Promise<void>;
  },
): Promise<DeckFlow> {
  const { source, file, read, bakers } = request;
  const pictures = (
    result: Extract<BakeResult, { ok: false }> | null,
    issues: ImportIssue[],
    drawn?: PicturesResult | null,
  ): DeckFlow => ({
    kind: 'pictures',
    pdf: result?.pdf ?? null,
    ...(drawn && result?.pdf ? { drawn } : {}),
    // The tests' stand-in saves its PDF as PowerPoint does, and is named as PowerPoint (Session 56: it saves one now).
    converter: result?.pdf ? (result.baker === 'stand-in' ? 'powerpoint' : result.baker) : null,
    deck: result?.deck ?? read,
    deckFile: result?.deckFile ?? (source === 'pptx' ? file : null),
    issues,
    cancelled: result?.why.kind === 'cancelled',
  });
  const input = source === 'pptx' && read ? await prepareNativePptx(read, file, request.work) : null;
  const first = bakers[0];
  const deckDir = request.sourceDir ?? dirname(file);
  const withNativeMedia = (parsed: ParsedPresentation, indices: number[]) =>
    read
      ? addNativeDeckMedia(
          parsed,
          read,
          file,
          request.sourcePath,
          join(request.work, 'native-media'),
          options.ffmpeg,
          deckDir,
          indices,
        )
      : Promise.resolve();
  const fromNative = async (): Promise<DeckFlow | null> => {
    if (!input || !read || options.signal?.aborted) return null;
    const parsed = nativePresentation(request.fileName, read, input);
    if (!parsed) return null;
    await withNativeMedia(parsed, input.indices);
    compactNativeAssets(parsed);
    return { kind: 'baked', parsed, sourceIndices: input.indices };
  };
  if (input?.exact || !first) {
    const native = await fromNative();
    if (native) return native;
  }
  if (!first) return pictures(null, []);
  // Nothing on it moves (Session 56): no movie is made; it comes in as its pictures straight away.
  if (read && movieChoice(read.slides).moving.size === 0) return pictures(null, [stillDeckIssue()]);
  // Never while the stream is on air or recording (Session 50's rule for converting).
  if (await options.onAir()) return pictures(null, [whyPictures({ kind: 'on-air' }, first, options.kept)]);
  const tried: { baker: Baker; reason: string }[] = [];
  let last: Extract<BakeResult, { ok: false }> | null = null;
  let drawnLast: PicturesResult | null = null;
  for (const baker of bakers) {
    const work = await mkdtemp(join(request.work, 'bake-'));
    // Every shown slide's picture, drawn as soon as the app has saved the PDF (while the movie is made; on Windows before
    // PowerPoint starts it, Session 57); and (Session 56) the slides written as those pictures at once, the ones that
    // move marked as preparing.
    const early: { drawing: Promise<Drawn | null> | null; written: Promise<void> | null } = {
      drawing: null,
      written: null,
    };
    const result = await bakeDeck(
      baker,
      { source, input: file, read, work },
      {
        ...options,
        started: (pid) => options.appStarted?.(pid, baker === 'keynote' ? 'Keynote' : 'PowerPoint'),
        pdfReady: (pdf, deck) => {
          const draw = options.drawPdf;
          if (!draw || early.drawing) return;
          const pages = join(work, 'pages');
          const drawing = (options.steps?.time('pictures', () => draw(pdf, pages)) ?? draw(pdf, pages)).then(
            (drawn): Drawn => ({ deck, drawn }),
            () => null,
          );
          early.drawing = drawing;
          const write = options.early;
          if (write)
            early.written = drawing
              .then(async (d) => {
                const shown = new Set(d?.deck.slides.flatMap((s, i) => (s.hidden ? [] : [i])) ?? []);
                const each = d?.drawn.ok ? pagesOfShown(d.deck.slides, d.drawn, shown) : null;
                if (!d?.drawn.ok || !each) return;
                const made = preparingPresentation(
                  request.fileName,
                  request.sourcePath,
                  d.deck,
                  each,
                  d.drawn,
                );
                await write(made.parsed, made.indices);
              })
              .catch(() => undefined);
          return early.written ?? undefined;
        },
      },
    );
    // The slides as their pictures are in before anything takes their place.
    await early.written;
    const done = early.drawing ? await early.drawing : null;
    drawnLast = done?.drawn ?? null;
    if (result.ok) {
      // The slides that come in as their pictures (Session 56): the pages of the PDF the app saved, drawn as it worked.
      const choice = result.baked.choice ?? null;
      let still: Map<number, string> | null = null;
      if (choice) {
        const drawPdf = options.drawPdf;
        const pdf = result.pdf;
        const drawn =
          done?.drawn ??
          (pdf && drawPdf
            ? await (options.steps?.time('pictures', () => drawPdf(pdf, join(work, 'pages'))) ??
                drawPdf(pdf, join(work, 'pages')))
            : null);
        still = drawn?.ok
          ? pagesOfShown(result.baked.deck.slides, drawn, new Set([...choice.pictures, ...choice.leadIns]))
          : null;
        if (!still) {
          last = {
            ok: false,
            why: {
              kind: 'cut',
              detail:
                drawn && !drawn.ok ? drawn.message : 'its PDF’s pages did not match its slides one for one',
            },
            pdf: result.pdf,
            deck: result.baked.deck,
            deckFile: result.baked.deckFile,
            baker,
          };
          break;
        }
      }
      const deckFrom = performance.now();
      const parsed = await bakedPresentation(
        request.fileName,
        request.sourcePath,
        result.baked,
        work,
        options.ffmpeg,
        request.sourceDir ?? dirname(file),
        still,
      );
      options.steps?.add('deck', performance.now() - deckFrom);
      const before = tried[0];
      if (before)
        parsed.issues.unshift({
          severity: 'warning',
          code: 'deck-other-app',
          message: `${APP[before.baker]} could not make the deck’s movie (${before.reason}), so ${APP[baker]} did: check that its slides look right.`,
          fix: null,
        });
      // Each slide's own page of the original: every shown slide's, when some were left out of the movie (Session 56).
      const sourceIndices = choice
        ? result.baked.deck.slides.flatMap((slide, index) => (slide.hidden ? [] : [index]))
        : result.baked.plan.slides.map((slide) => slide.index);
      if (input) {
        applyNativePages(parsed, input, sourceIndices);
        await withNativeMedia(parsed, sourceIndices);
        compactNativeAssets(parsed);
      }
      return {
        kind: 'baked',
        parsed,
        sourceIndices,
        ...(source === 'key' ? { editablePptx: result.baked.deckFile } : {}),
      };
    }
    last = result;
    // Only an app that could not do it at all gives way to the next.
    if (result.why.kind !== 'app') break;
    tried.push({ baker, reason: result.why.reason });
  }
  return (
    (last?.why.kind === 'app' && !options.kept ? await fromNative() : null) ??
    pictures(last, last ? [whyPictures(last.why, last.baker, options.kept)] : [], drawnLast)
  );
}

/** The pages of an app's PDF as drawn, and the deck they are of. */
interface Drawn {
  deck: PptxDeck;
  drawn: PicturesResult;
}
