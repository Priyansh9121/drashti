import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineCommand } from '../shared/engine/commands';
import type { DeckEffect, DeckSlide } from '../shared/deck';
import { nativeStepTiming } from '../shared/deck-show';
import type { DeckNativeTransition } from '../shared/deck-transition';
import type { LowerThird, LowerThirdLook } from '../shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../shared/lower-thirds';
import { animationById, animationLength, cutIntoUnits } from '../shared/lower-third-animations';
import { FAMILIES, idFor } from '../shared/lower-third-studio';
import type { Rect, SlideElement, TextStyle, TransitionKind } from '../shared/model';
import {
  caseLine,
  caseRow,
  type CaseRow,
  framePeriod,
  intervalStats,
  jumpFigures,
  type JumpFigures,
  jumpLine,
  type JumpOnScreens,
  measureRun,
  type MotionRun,
  stillIntervals,
  stillLine,
} from '../shared/motion-measure';
import { fitElements } from '../shared/slide-size';
import { cutText, plural } from '../shared/text';
import { PresentationRepo } from './db/presentations';
import { addTone } from './music/perf-music';
import { makePicture, makeVideo, type ScenarioDeps, type ScenarioRun } from './perf-scenarios';
import {
  memoryAdded,
  memoryLine,
  POINT_AT,
  POINTED_LEAD_MS,
  POINTED_LOAD_MS,
  POINTED_ON_AIR_ROW,
  POINTED_ROW,
  POINTED_SAY_MS,
  pointWhileOnAir,
  windowsMemory,
  type WindowsMemory,
} from './perf-pointed';
import { sw } from './switches';

/*
 * The Performance check's animations scenario (Session 57, item 6; DRASHTI_PERF_SCENARIO=animations, the Performance
 * workflow's "scenario"): the owner's "animations on the spot" measured on an audience screen, Mac and Windows, before
 * and after the workers' fixes. The usual check runs first (slide changes every two seconds through the import, as in
 * a sabha); then, the import over, each case is pressed in turn from the operator window (its own bridge, as its keys
 * and buttons do), several times, and the motion probe on the screen (render/motion-probe.ts, under the test switch
 * DRASHTI_TEST_MOTION_PROBE: never in an installed Drashti) says when the screen's frames moved:
 * - every slide transition Drashti offers at its default length (0.8 s, the editor's), on screens that move Calm as
 *   every show's do, and a long one (a 3 s fade); the three Bold moves and Bold's fade on screens moving Bold;
 * - a deck's click (Session 54's clips, made here as the e2e tests' stand-in makes them: no PowerPoint), and its
 *   coming in; and its coming in by a click with the pointer resting on its row a moment first (C3, Session 58: its
 *   first clip loaded ahead at the frame the click starts it from), with what that costs each window in memory;
 * - a lower third in and out: three styles (box, band, glass) and one of the heaviest (letter by letter with a blur,
 *   glass, sparkles behind);
 * - Black-out on and off, and the Wallpaper (a placeholder picture chosen) on and off.
 * Then, each only while there is time left for all of it:
 * - a deck Drashti plays itself (13 Nov 2026, the review of h-p3tr's part B and h-p3fx's Split), as dissolve 800 was
 *   measured (one hall screen, no other window open): by Next its slides come in by its own Wipe (a hard-edged clip
 *   since Q57-28; a mask over the whole slide before), Cover and Uncover (the moving slide shaded, a filter) and Push
 *   (transforms only: the control), then two shapes of its last slide come in and go out by Split (a mask the size of
 *   each), a click each, and four more by Shape (Session 58: a Circle, a Box, a Diamond and a Plus, PowerPoint's soft
 *   edge as masks the size of each, a Box's, a Diamond's and a Plus's two, one inside the other), a click each;
 * then Session 57's leftovers (h-left2's MS-1, DK-6 and DK-2), left out of the two-core streaming check (after3's ran
 * into its 14-minute stop with them):
 * - a slide of an imported, editable PowerPoint table of 250 cells (each cell a text box that measures itself on the
 *   screen), its words fitting their cells and then too long for them, coming on with the editor's fade;
 * - a jump to a deck slide Drashti plays itself (no clip: its effects drawn from its shapes, on the engine's time),
 *   carrying a sound, on two hall screens: when each showed it, when its first effect moved against the engine's own
 *   start, and how far apart the two screens were;
 * - the deck's clicks again with the windows that load nothing ahead open (no Preloader: LIVE's picture, the projector
 *   card, the stage screen's card and a stage screen, the stream's picture), on the two-core run above all.
 * (The opening plays only in the operator window as a person starts Drashti, never in a self-test: the Performance
 * spec measures it on its own, tests/perf/performance.spec.ts.)
 * For each: the delay from the press to the first frame that moved, the length from that frame to the last against
 * its set length, and the intervals between the frames drawn meanwhile (shared/motion-measure.ts). Every figure is in
 * the summary, and with each run's own in DRASHTI_PERF_RAW (animations-<platform>-<plain|streaming>.json). Placeholder
 * words and generated pictures only.
 */

/** What a case watches on the screen (render/motion-probe.ts's tracks). */
type Track = 'slide' | 'deck' | 'nativeDeck' | 'lowerThird' | 'blackout' | 'wallpaper';

/** One press of a case, as it went. */
interface Pressed {
  name: string;
  track: Track;
  setMs: number;
  /** The press, in the operator window (ms since the epoch, this computer's clock). */
  at: number;
  /** The revision it made (-1: refused, or the main process's own when the operator window was gone). */
  rev: number;
  /** Where it was pressed. */
  from: 'operator' | 'main';
  /** When the next press came (its run's frames end there). */
  until: number;
  /** The same press watched on another track besides (a slide's arrival beside its effects): no still frames of its own. */
  also?: true;
  /** A deck slide Drashti plays itself: when the engine put it up, and when its first effect starts, by the engine. */
  engine?: { shownAt: number; effectAt: number };
}

/** A run as the scenario keeps it, with the main process's and the screen's own times. */
interface Measured extends MotionRun {
  name: string;
  setMs: number;
  pressAt: number;
  /** When the main process sent the change (the screen's paint log), and when the screen first drew it. */
  mainAt: number | null;
  paintedAt: number | null;
}

/** What the motion probe gives for a stretch of time (render/motion-probe.ts). */
interface ProbeRecord {
  frames: number[];
  changes: Record<string, number[]>;
}

/** The default length a transition is given (the slide editor's, SlidePanel.tsx and Ribbon.tsx). */
const DEFAULT_MS = 800;
/** One long one. */
const LONG_MS = 3000;
/** Each case is pressed this many times (lower thirds and the deck fewer: theirs take longer). */
const RUNS = 6;
const SHORT_RUNS = 4;
/** After a case has run its length: still for this long before the next press. */
const SETTLE_MS = 700;
/** The deck's clips (as the e2e tests' stand-in's, tests/e2e/deck-stand-in.ts): 1.5 s, the first 0.4 s its transition. */
const CLIP_MS = 1500;
const DECK_TRANSITION_MS = 400;

/** MS-1: a PowerPoint table of 250 cells, the most the editable reader keeps as a table (its 500 objects a slide). */
const TABLE_ROWS = 25;
const TABLE_COLUMNS = 10;
/** A table slide may come late (each cell's box measures itself as it comes): its fade, and long enough after it. */
const TABLE_SETTLE_MS = 1500;
const TABLE_CASES = ['table slide, 250 cells', 'table slide, 250 cells shrinking'] as const;

/**
 * DK-6: a deck slide Drashti plays itself. Its first effect fades its title in with the slide (seen from its first
 * frame), then a line flies in; 1.2 s in all. Each jump goes to a slide of its own, the last first, so none was ever
 * next (the hall screens load what is next ahead): every jump draws a picture for the first time.
 */
const NATIVE_FADE_MS = 1000;
const NATIVE_FLY_AT_MS = 300;
const NATIVE_FLY_MS = 900;
const NATIVE_STEP_MS = Math.max(NATIVE_FADE_MS, NATIVE_FLY_AT_MS + NATIVE_FLY_MS);
/** Each slide's own picture, in hues none of the other pictures has (the library keeps a picture's bytes once). */
const NATIVE_HUES = [20, 80, 160, 300];
/** Long enough after its effects for a slide whose picture took its time. */
const NATIVE_SETTLE_MS = 1500;
const NATIVE_EFFECTS = 'jump to a deck slide Drashti plays: its effects';
const NATIVE_ARRIVES = 'jump to a deck slide Drashti plays: it comes';
/** Screen 2's rows are named so. */
const SECOND = ' (screen 2)';

/** DK-2: the deck in and its two clicks this many times, with the windows that load nothing ahead open. */
const DK2_RUNS = 3;
const DK2_WINDOWS = 'windows without a Preloader';

/**
 * A deck Drashti plays itself, its own transitions (13 Nov 2026): each at 700 ms (PowerPoint's movie that Wipe, Cover
 * and Uncover were drawn after), from the right but Uncover's, up; each row named so in the tables.
 */
const DECK_OWN_MS = 700;
const DECK_OWN: readonly { row: string; name: string; transition: DeckNativeTransition }[] = [
  {
    row: 'deck Drashti plays: its Wipe 700',
    name: 'wipe',
    transition: { kind: 'wipe', deckEffect: 'wipe', direction: 'left', durationMs: DECK_OWN_MS },
  },
  {
    row: 'deck Drashti plays: its Cover 700',
    name: 'cover',
    transition: { kind: 'slide', deckEffect: 'cover', direction: 'left', durationMs: DECK_OWN_MS },
  },
  {
    row: 'deck Drashti plays: its Uncover 700',
    name: 'pull',
    transition: { kind: 'slide', deckEffect: 'uncover', direction: 'up', durationMs: DECK_OWN_MS },
  },
  {
    row: 'deck Drashti plays: its Push 700 (the control)',
    name: 'push',
    transition: { kind: 'slide', deckEffect: 'push', direction: 'left', durationMs: DECK_OWN_MS },
  },
];
/** Its last slide's two shapes, in by Split at its first click and out at its second (PowerPoint's own 0.5 s). */
const DECK_SPLIT_MS = 500;
const DECK_SPLIT_IN = 'deck Drashti plays: shapes in by Split 500';
const DECK_SPLIT_OUT = 'deck Drashti plays: shapes out by Split 500';
/**
 * Then four more of its shapes in by Shape at its third click and out at its fourth (Session 58; PowerPoint's own
 * 0.5 s): a Circle, a Box, a Diamond and a Plus, each outline once, its soft edge drawn by masks (shared/deck-motion.ts,
 * shapeMasks: a Circle's one radial gradient; a Box's, a Diamond's and a Plus's two, one inside the other).
 */
const DECK_SHAPE_MS = 500;
const DECK_SHAPE_IN = 'deck Drashti plays: shapes in by Shape 500';
const DECK_SHAPE_OUT = 'deck Drashti plays: shapes out by Shape 500';
const DECK_SHAPES: readonly NonNullable<DeckEffect['shape']>[] = ['circle', 'box', 'diamond', 'plus'];
/** Its first slide, put up by a cut before each round: only by Next from the slide before is a deck's own played. */
const DECK_OWN_FIRST = '(to the first slide of the deck Drashti plays)';
/** One round of it: its first slide, its four transitions, its four clicks, each then still SETTLE_MS. */
const DECK_OWN_ROUND_MS =
  SETTLE_MS +
  DECK_OWN.length * (DECK_OWN_MS + SETTLE_MS) +
  2 * (DECK_SPLIT_MS + SETTLE_MS) +
  2 * (DECK_SHAPE_MS + SETTLE_MS);

/** How long a screen opened for a case may take to be ready: its page loaded, its fonts in, its warm-up done. */
const SCREEN_LIMIT_MS = 20_000;

const KINDS: readonly TransitionKind[] = [
  'cut',
  'dissolve',
  'fade-black',
  'slide',
  'zoom',
  'wipe',
  'push',
  'zoom-dissolve',
  'lines',
  'words',
];
/** The kinds that move otherwise on screens moving Bold (on Calm ones the three moves fade). */
const BOLD: readonly TransitionKind[] = ['dissolve', 'wipe', 'push', 'zoom-dissolve'];

const WORDS: TextStyle = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: true,
};

const LINES = ['Placeholder name', 'Placeholder title'];
/** A page that does not answer a call within this long is passed over (a press, the probe's read, the Wallpaper). */
const PAGE_LIMIT_MS = 5000;
/** The cases stop pressing after this long, measuring those done: the check's own time limit is 14 min in all. */
const BUDGET_MS = 6 * 60_000;
/**
 * Or once Drashti has been up this long, if that comes first: the check stops it 14 minutes from its start
 * (tests/perf/performance.spec.ts), and the cases measured must be read and written before then (after3's two-core
 * streaming check lost its figures to that stop, 13 Nov 2026).
 */
const UP_TO_MS = 12 * 60_000;

/** When the cases stop pressing, from `now`, Drashti up `upMs`: at their budget's end, or at its 12 minutes up. */
export function casesUntil(now: number, upMs: number): { at: number; by: 'budget' | 'uptime' } {
  const budget = now + BUDGET_MS;
  const uptime = now + UP_TO_MS - upMs;
  return uptime < budget ? { at: uptime, by: 'uptime' } : { at: budget, by: 'budget' };
}

/**
 * Whether Session 57's leftovers (MS-1, DK-6, DK-2) are pressed in a check: in every one but two-core streaming, which
 * ran into its 14-minute stop with them (after3, 13 Nov 2026). Each still only while there is time for it.
 */
export const leftoversIn = (check: { streaming: boolean; twoCores: boolean }): boolean =>
  !(check.streaming && check.twoCores);
/** The lines it writes as it goes (tests/perf/performance.spec.ts prints them). */
export const PROGRESS = 'PERF-ANIMATIONS';

/** A page's answer, or `late` once `ms` have gone by (or it failed): a page that never answers holds nothing up. */
function within<T, L>(answer: Promise<T>, ms: number, late: L): Promise<T | L> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(late);
    }, ms);
    answer.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(late);
      },
    );
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** A page's answer to `code`, or `late` (it never answered, or it was gone). */
function ask<T, L>(win: Pick<BrowserWindow, 'webContents' | 'isDestroyed'> | null, code: string, late: L) {
  if (!win || win.isDestroyed()) return Promise.resolve(late);
  return within(win.webContents.executeJavaScript(code, true) as Promise<T>, PAGE_LIMIT_MS, late);
}

/** The lower thirds it plays: three styles, and one of the heaviest. */
function lowerThirds(): { key: string; lowerThird: LowerThird }[] {
  const made = (key: string, animation: string, look: Partial<LowerThirdLook>) => ({
    key,
    lowerThird: {
      id: `perf-anim-lt-${key}`,
      lines: LINES,
      look: { ...DEFAULT_LOWER_THIRD_LOOK, ...look },
      where: 'both' as const,
      animation,
    },
  });
  const letters = FAMILIES.find((f) => f.family === 'letter-blur');
  return [
    made('box', 'slide-left-steady', { style: 'box' }),
    made('band', 'slide-left-steady', { style: 'band' }),
    made('glass', 'slide-left-steady', { style: 'glass' }),
    made(
      'letters-blur-glass-sparkles',
      letters ? idFor(letters, { direction: null, speed: 'steady', band: 'fade' }) : 'fade-steady',
      { style: 'glass', motion: 'sparkles' },
    ),
  ];
}

/** How long a lower third's in or out is set to take. */
function lowerThirdMs(lt: LowerThird, phase: 'in' | 'out'): number {
  const a = animationById(phase === 'out' ? (lt.outAnimation ?? lt.animation) : lt.animation);
  return animationLength(a, phase, cutIntoUnits(LINES, a).units);
}

/**
 * MS-1: a PowerPoint table over the slide, 25 rows of 10 cells, as PowerPoint writes one (its first row filled, every
 * cell's edges drawn), the words of each cell given; in EMU, on a 16:9 slide.
 */
function tableShape(words: (row: number, column: number) => string): string {
  const [x, y, width, height] = [304_800, 304_800, 11_582_400, 6_248_400];
  const column = Math.floor(width / TABLE_COLUMNS);
  const row = Math.floor(height / TABLE_ROWS);
  const edges = ['lnL', 'lnR', 'lnT', 'lnB']
    .map((side) => `<a:${side} w="6350"><a:solidFill><a:srgbClr val="A0A8B0"/></a:solidFill></a:${side}>`)
    .join('');
  const cell = (r: number, c: number) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="900"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${words(r, c)}</a:t></a:r></a:p></a:txBody><a:tcPr marL="45720" marR="45720" marT="0" marB="0">${edges}${r === 0 ? '<a:solidFill><a:srgbClr val="1F3A5F"/></a:solidFill>' : ''}</a:tcPr></a:tc>`;
  const rows = Array.from(
    { length: TABLE_ROWS },
    (_, r) =>
      `<a:tr h="${String(row)}">${Array.from({ length: TABLE_COLUMNS }, (__, c) => cell(r, c)).join('')}</a:tr>`,
  ).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Placeholder table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${String(x)}" y="${String(y)}"/><a:ext cx="${String(width)}" cy="${String(height)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${`<a:gridCol w="${String(column)}"/>`.repeat(TABLE_COLUMNS)}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** The four tables' words: two that fit their cells, then two too long for them (each box makes its words smaller). */
const TABLE_WORDS: readonly ((row: number, column: number) => string)[] = [
  (r, c) => `Placeholder ${String(r * TABLE_COLUMNS + c + 1)}`,
  (r, c) => `Placeholder item ${String(r * TABLE_COLUMNS + c + 1)}`,
  (r, c) =>
    `Placeholder words in row ${String(r + 1)}, column ${String(c + 1)}, far longer than this cell holds`,
  (r, c) =>
    `More placeholder words for row ${String(r + 1)} and column ${String(c + 1)}, far longer than the cell`,
];

/**
 * MS-1's slides, made as the import keeps a deck's editable copy (import/deck/editable-pptx.ts, then fitted to the
 * library's slide, as native-deck-import.ts does), from a generated deck: placeholder words only, no PowerPoint.
 */
async function tableSlides(
  deps: ScenarioDeps,
  repo: PresentationRepo,
  libraryId: string,
): Promise<{ id: string; cells: number; objects: number }> {
  // The reader and the generated deck's writer only now, never with Drashti's own start (the import's worker has them).
  const [{ readEditablePptx }, { editablePptxFixture, slideXml }] = await Promise.all([
    import('./import/deck/editable-pptx'),
    import('./import/testing/editable-pptx-fixture'),
  ]);
  const folder = join(deps.mediaDir, 'perf');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'animations-tables.pptx');
  writeFileSync(
    file,
    editablePptxFixture({ slides: TABLE_WORDS.map((words) => slideXml(tableShape(words))) }),
  );
  const deck = await readEditablePptx(file, join(folder, 'animations-tables-prepared'));
  const id = repo.insert({
    libraryId,
    name: 'Placeholder perf table slides',
    groups: [
      {
        name: '',
        slides: deck.slides.map((s, i) => ({
          label: `Placeholder table ${String(i + 1)}`,
          background: s.background,
          transition: { kind: 'dissolve' as const, durationMs: DEFAULT_MS },
          elements: fitElements(s.elements, deck, { width: 1920, height: 1080 }),
        })),
      },
    ],
  });
  const first = deck.slides[0]?.elements ?? [];
  return {
    id,
    cells: first.filter((e) => e.kind === 'text' && e.tableCell !== undefined).length,
    objects: first.length,
  };
}

/** DK-6: its effects, on its title (shape 3) and its line (shape 4), with the slide (step 0). */
const NATIVE_MOTION: DeckEffect[] = [
  { shapeId: '3', step: 0, phase: 'in', kind: 'fade', delayMs: 0, durationMs: NATIVE_FADE_MS },
  {
    shapeId: '4',
    step: 0,
    phase: 'in',
    kind: 'fly',
    direction: 'up',
    delayMs: NATIVE_FLY_AT_MS,
    durationMs: NATIVE_FLY_MS,
  },
];

/**
 * The deck Drashti plays itself, its own transitions (13 Nov 2026), as its import keeps a deck it can play from the
 * deck's shapes (import/deck/native-deck-import.ts): its first slide, then one coming in by each of DECK_OWN, every one
 * over the same full-slide picture (a deck's own background, drawn once) with its title and a line; on the last, a
 * shape and words its first two clicks bring in and take out by Split, then two shapes and two words its next two
 * bring in and take out by Shape, each outline once (Session 58). A jump to any of them is a cut.
 */
function deckOwnSlides(picture: string) {
  const words = (id: string, shapeId: string, text: string, frame: Rect, fontSize: number): SlideElement => ({
    id,
    kind: 'text',
    frame,
    text,
    lang: 'en',
    style: { ...WORDS, fontSize, shrinkToFit: true },
    sourceShapeId: shapeId,
  });
  const split = (shapeId: string, axis: 'x' | 'y', inward: boolean): DeckEffect[] =>
    [1, 2].map((step): DeckEffect => ({
      shapeId,
      step,
      phase: step === 1 ? 'in' : 'out',
      kind: 'split',
      splitAxis: axis,
      ...(inward ? { inward: true as const } : {}),
      delayMs: 0,
      durationMs: DECK_SPLIT_MS,
    }));
  const shape = (shapeId: string, outline: NonNullable<DeckEffect['shape']>): DeckEffect[] =>
    [3, 4].map((step): DeckEffect => ({
      shapeId,
      step,
      phase: step === 3 ? 'in' : 'out',
      kind: 'shape',
      shape: outline,
      delayMs: 0,
      durationMs: DECK_SHAPE_MS,
    }));
  // Where Split's shapes were, once they have gone: two rows of two, each outline's own shape or words.
  const shapeAt = (k: number): Rect => ({
    x: k % 2 === 0 ? 160 : 1000,
    y: k < 2 ? 560 : 790,
    width: 760,
    height: 200,
  });
  return [null, ...DECK_OWN].map((own, i) => {
    const last = i === DECK_OWN.length;
    const elements: SlideElement[] = [
      {
        id: 'picture',
        kind: 'image',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
        mediaId: picture,
        fit: 'fill',
        sourceShapeId: '2',
      },
      words(
        'title',
        '3',
        `Placeholder deck title ${String(i + 1)}`,
        { x: 160, y: 120, width: 1600, height: 200 },
        80,
      ),
      words('line', '4', 'A placeholder line on the slide', { x: 160, y: 360, width: 1600, height: 140 }, 56),
      ...(last
        ? [
            {
              id: 'split-shape',
              kind: 'shape' as const,
              shape: 'rectangle' as const,
              fill: '#f3c46bcc',
              cornerRadius: 24,
              opacity: 1,
              frame: { x: 160, y: 600, width: 760, height: 320 },
              outline: { color: '#5a2a48', width: 4 },
              sourceShapeId: '5',
            },
            words(
              'split-words',
              '6',
              'Placeholder words in by Split',
              { x: 1000, y: 600, width: 760, height: 320 },
              64,
            ),
            ...DECK_SHAPES.map((outline, k): SlideElement =>
              k % 2 === 0
                ? {
                    id: `shape-${outline}`,
                    kind: 'shape',
                    shape: 'rectangle',
                    fill: '#5a2a48cc',
                    cornerRadius: 24,
                    opacity: 1,
                    frame: shapeAt(k),
                    outline: { color: '#f3c46b', width: 4 },
                    sourceShapeId: String(7 + k),
                  }
                : words(`shape-${outline}`, String(7 + k), `Placeholder words in by Shape`, shapeAt(k), 56),
            ),
          ]
        : []),
    ];
    const deck: DeckSlide = {
      steps: [],
      media: [],
      ...(own
        ? { transition: { name: own.name, durationMs: DECK_OWN_MS, nativeTransition: own.transition } }
        : {}),
      motion: last
        ? {
            effects: [
              ...split('5', 'x', false),
              ...split('6', 'y', true),
              ...DECK_SHAPES.flatMap((outline, k) => shape(String(7 + k), outline)),
            ].sort((a, b) => a.step - b.step),
            stepsMs: [0, DECK_SPLIT_MS, DECK_SPLIT_MS, DECK_SHAPE_MS, DECK_SHAPE_MS],
            approximate: false,
          }
        : { effects: [], stepsMs: [0], approximate: false },
    };
    return {
      label: `Placeholder deck slide Drashti plays, its own transitions ${String(i + 1)}`,
      transition: { kind: 'cut' as const, durationMs: 0 },
      elements,
      deck,
    };
  });
}

/** A press from the operator window, through its own bridge (as its keys and buttons send it), timed there. */
const PRESS = (command: EngineCommand) => `(async () => {
  const d = globalThis.drashti;
  const at = Date.now();
  const r = await d.engine.dispatch(${JSON.stringify(command)});
  return { at, rev: r.ok ? r.rev : -1 };
})()`;

/** The Wallpaper's picture: a placeholder chosen as the wallpaper from the operator window (as Wallpapers… does). */
const CHOOSE_WALLPAPER = (mediaId: string) => `(async () => {
  const d = globalThis.drashti;
  const made = await d.wallpapers.add([${JSON.stringify(mediaId)}], null);
  if (!made.ok || made.ids.length === 0) return false;
  return (await d.wallpapers.choose(made.ids[0])).ok;
})()`;

/** The displays no screen uses, as Screens has them (the operator window's own bridge). */
const FREE_DISPLAYS = `(async () => {
  const s = await globalThis.drashti.screens.get();
  return s.uses.filter((u) => u.screenId === null).map((u) => u.displayId);
})()`;

/** A display's job, as Screens gives it in one click: the audience picture (a hall screen) or the stage. */
const SET_JOB = (displayId: number, job: 'audience' | 'stage') => `(async () => {
  const r = await globalThis.drashti.screens.setJob(${String(displayId)}, ${JSON.stringify(job)}, { coverOperator: true });
  return r.ok === true;
})()`;

/** What an output's page is: its role, its fonts and warm-up, and whether the motion probe is on there. */
const SCREEN_STATE = `(() => {
  const root = document.querySelector('[data-testid="output-root"]');
  return {
    role: root?.getAttribute('data-role') ?? '',
    fonts: root?.getAttribute('data-fonts') ?? '',
    warmUp: root?.getAttribute('data-warm-up') ?? '',
    probe: typeof window.drashtiMotionProbe?.read === 'function',
  };
})()`;

/** Screens, the projector card on top (the operator window's own key for it, Mod+Shift+S), as the operator opens it. */
const OPEN_SCREENS = (mac: boolean) => `(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', code: 'KeyS', shiftKey: true, ${mac ? 'metaKey' : 'ctrlKey'}: true, bubbles: true, cancelable: true }));
  return true;
})()`;
/** Or its button in the top bar, should the key not open it. */
const CLICK_SCREENS = `(() => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Screens');
  button?.click();
  return button !== undefined;
})()`;
const SHOWS = (selector: string) => `document.querySelector(${JSON.stringify(selector)}) !== null`;
/** The stream's picture without streaming anywhere: what the Stream panel's preview asks for. */
const WATCH_STREAM = `(async () => {
  await globalThis.drashti.stream.watchPreview(true);
  return true;
})()`;

/** An output's page as SCREEN_STATE reads it. */
interface ScreenState {
  role: string;
  fonts: string;
  warmUp: string;
  probe: boolean;
}

/** DK-2: the windows that load nothing ahead (no Preloader), and whether each was open for its deck clicks. */
interface WindowsOpen {
  live: boolean;
  projectorCard: boolean;
  stageCard: boolean;
  stageScreen: boolean;
  streamPicture: boolean;
  /** Why one was not. */
  why: string[];
}

const windowsLine = (w: WindowsOpen) => {
  const names: [keyof Omit<WindowsOpen, 'why'>, string][] = [
    ['live', 'LIVE’s picture'],
    ['projectorCard', 'the projector card'],
    ['stageCard', 'the stage screen’s card'],
    ['stageScreen', 'a stage screen'],
    ['streamPicture', 'the stream’s picture'],
  ];
  const open = names.filter(([k]) => w[k]).map(([, n]) => n);
  const shut = names.filter(([k]) => !w[k]).map(([, n]) => n);
  return `open: ${open.join(', ') || 'none'}; not open: ${shut.join(', ') || 'none'}${w.why.length > 0 ? ` (${w.why.join('; ')})` : ''}`;
};

export function animationsScenario(deps: ScenarioDeps): ScenarioRun {
  const made = Date.now();
  const [backgroundPicture = '', slidePicture = '', wallpaperPicture = ''] = [0, 120, 240].map((hue, i) =>
    makePicture(deps, `animations-picture-${String(i + 1)}`, hue, null),
  );
  // Slides over a picture background, as bold-transitions has them.
  deps.engine.dispatch({
    type: 'setBackground',
    background: { kind: 'media', mediaId: backgroundPicture, media: 'image', fit: 'fill', loop: false },
  });
  const repo = new PresentationRepo(deps.db);
  const libraryId = repo.ensureLibrary('Default');
  // Two slides for each transition (it goes back and forth between them), the long fade last.
  const transitions = [
    ...KINDS.map((kind) => ({ kind, ms: kind === 'cut' ? 0 : DEFAULT_MS })),
    { kind: 'dissolve' as const, ms: LONG_MS },
  ];
  const slidesId = repo.insert({
    libraryId,
    name: 'Placeholder perf animation slides',
    groups: [
      {
        name: '',
        slides: transitions.flatMap((t, i) =>
          [0, 1].map((side) => ({
            label: `Placeholder ${t.kind} ${String(side + 1)}`,
            transition: { kind: t.kind, durationMs: t.ms },
            elements: [
              {
                id: 'picture',
                kind: 'image' as const,
                frame: { x: 1240, y: 80, width: 600, height: 338 },
                mediaId: slidePicture,
                fit: 'fill' as const,
              },
              {
                id: 'words',
                kind: 'text' as const,
                frame: { x: 96, y: 96, width: 1728, height: 888 },
                text: `Placeholder words ${String(i * 2 + side + 1)}\nA second placeholder line`,
                lang: 'en' as const,
                style: WORDS,
              },
            ],
          })),
        ),
      },
    ],
  });
  // A deck's slide as Session 54's import keeps it, made as the e2e tests' stand-in makes one: each step a clip, then
  // its last frame (generated pictures; no PowerPoint).
  const steps = [0, 1, 2].map((i) => ({
    clipId: makeVideo(deps, `animations-deck-step-${String(i)}`, {
      width: 1920,
      height: 1080,
      fps: 30,
      seconds: CLIP_MS / 1000,
      hue: 60 + i * 90,
    }).mediaId,
    // Hues none of the slides' pictures has (0, 120, 240): the library keeps a picture's bytes once (sha256).
    lastId: makePicture(deps, `animations-deck-last-${String(i)}`, 45 + i * 90, null),
  }));
  const deck: DeckSlide = {
    transition: { name: 'push', durationMs: DECK_TRANSITION_MS },
    steps: steps.map((s, i) => ({
      clipId: s.clipId,
      clipMs: CLIP_MS,
      lastId: s.lastId,
      ...(i === 0 ? { transitionMs: DECK_TRANSITION_MS } : {}),
    })),
    media: [],
  };
  const deckId = repo.insert({
    libraryId,
    name: 'Placeholder perf animation deck',
    groups: [
      {
        name: '',
        slides: [
          {
            label: 'Placeholder deck slide',
            elements: [
              {
                id: 'deck-picture-0',
                kind: 'image' as const,
                frame: { x: 0, y: 0, width: 1920, height: 1080 },
                mediaId: steps.at(-1)?.lastId ?? '',
                fit: 'fit' as const,
              },
            ],
            deck,
          },
        ],
      },
    ],
  });
  // DK-6: deck slides Drashti plays itself (no clip; as its import keeps a deck it can play from the deck's shapes),
  // each its own picture, a title and a line its effects bring in, and a sound with the slide (a generated tone).
  const sound = addTone(deps.db, deps.mediaDir, 'animations-deck-sound', 3, 440);
  const nativeDeck: DeckSlide = {
    steps: [],
    motion: { effects: NATIVE_MOTION, stepsMs: [NATIVE_STEP_MS], approximate: false },
    media: [
      {
        kind: 'audio',
        mediaId: sound,
        box: { x: 0.92, y: 0.86, w: 0.04, h: 0.07 },
        loop: false,
        volume: 1,
        start: { step: 0, offsetMs: 0 },
        hideWhenStopped: true,
      },
    ],
  };
  const nativeId = repo.insert({
    libraryId,
    name: 'Placeholder perf deck Drashti plays',
    groups: [
      {
        name: '',
        slides: NATIVE_HUES.map((hue, i) => ({
          label: `Placeholder deck slide Drashti plays ${String(i + 1)}`,
          // A cut: what comes is the slide itself, once its picture can be drawn.
          transition: { kind: 'cut' as const, durationMs: 0 },
          elements: [
            {
              id: 'picture',
              kind: 'image' as const,
              frame: { x: 0, y: 0, width: 1920, height: 1080 },
              mediaId: makePicture(deps, `animations-native-${String(i + 1)}`, hue, null),
              fit: 'fill' as const,
              sourceShapeId: '2',
            },
            {
              id: 'title',
              kind: 'text' as const,
              frame: { x: 160, y: 280, width: 1600, height: 240 },
              text: `Placeholder title ${String(i + 1)}`,
              lang: 'en' as const,
              style: { ...WORDS, shrinkToFit: true },
              sourceShapeId: '3',
            },
            {
              id: 'line',
              kind: 'text' as const,
              frame: { x: 160, y: 600, width: 1600, height: 160 },
              text: 'A placeholder line that flies in',
              lang: 'en' as const,
              style: { ...WORDS, fontSize: 56, shrinkToFit: true },
              sourceShapeId: '4',
            },
          ],
          deck: nativeDeck,
        })),
      },
    ],
  });
  // A deck Drashti plays itself, coming in by its own transitions (13 Nov 2026): every slide over one picture of its
  // own (a hue no other picture has: the library keeps a picture's bytes once).
  const deckOwnId = repo.insert({
    libraryId,
    name: 'Placeholder perf deck Drashti plays, its own transitions',
    groups: [{ name: '', slides: deckOwnSlides(makePicture(deps, 'animations-deck-own', 270, null)) }],
  });
  const pressed: Pressed[] = [];
  const operator = (): BrowserWindow | null => {
    const w = deps.operator?.() ?? null;
    return w && !w.isDestroyed() ? w : null;
  };
  // What it did, as it went: the Performance spec prints these lines (a check stopped at its time limit included).
  const began = Date.now();
  const progress = (what: string) => {
    process.stdout.write(`${PROGRESS} +${((Date.now() - began) / 1000).toFixed(1)} s ${what}\n`);
  };
  /** What it could not do, or left out for want of time: in the summary, the raw figures and as it goes. */
  const notes: string[] = [];
  const note = (what: string) => {
    notes.push(what);
    progress(what);
  };
  progress(`made its slides, deck and pictures (${String(Date.now() - made)} ms)`);
  // MS-1's table slides, made in begin(): before the measured part, by the reader of a deck's editable copy.
  let table: Awaited<ReturnType<typeof tableSlides>> | null = null;
  /** How long each press from the operator window took to come back, and how many in a row never did. */
  const roundTrips: number[] = [];
  let unanswered = 0;
  /** The last press's runs: the next press ends them (their frames end there), unless a case was closed first. */
  let lastPress: Pressed[] = [];
  /** Press a case once, and wait `waitMs` after it. */
  const press = async (
    name: string,
    track: Track,
    setMs: number,
    command: EngineCommand,
    waitMs: number,
    more: {
      /** The same press watched on other tracks besides (a slide's arrival beside its effects). */
      also?: readonly { name: string; track: Track; setMs: number }[];
      /** A deck slide Drashti plays itself: its first effect's delay, its start put by the engine's own clock. */
      firstEffectMs?: number;
    } = {},
  ): Promise<void> => {
    // After three presses in a row the operator window never answered, from the main process.
    const op = unanswered >= 3 ? null : operator();
    let at = Date.now();
    let rev = -1;
    let from: Pressed['from'] = 'main';
    if (op) {
      const asked = Date.now();
      const r = await within(
        op.webContents.executeJavaScript(PRESS(command), true) as Promise<{ at: number; rev: number }>,
        PAGE_LIMIT_MS,
        null,
      );
      roundTrips.push(Date.now() - asked);
      if (r === null) {
        // Never answered: counted from when it was asked, never pressed again from here (it may land late).
        unanswered += 1;
        progress(`the operator window did not answer a press within ${String(PAGE_LIMIT_MS)} ms (${name})`);
        at = asked;
        from = 'operator';
      } else if (r.rev >= 0) {
        unanswered = 0;
        ({ at, rev } = r);
        from = 'operator';
      }
    }
    // Refused there (or no operator window): from the main process instead, and said so.
    if (from === 'main') {
      at = Date.now();
      const r = deps.engine.dispatch(command);
      rev = r.ok ? r.rev : -1;
    }
    // The engine's own record of what went up: a step's clock, as every screen times its effects by it.
    let engine: Pressed['engine'];
    if (more.firstEffectMs !== undefined) {
      const layer = deps.engine.snapshot?.().state.layers.slide ?? null;
      const timing = layer ? nativeStepTiming(layer) : null;
      if (layer && timing) engine = { shownAt: layer.shownAt, effectAt: timing.clipAt + more.firstEffectMs };
    }
    for (const before of lastPress) before.until = at;
    const own: Pressed = {
      name,
      track,
      setMs,
      at,
      rev,
      from,
      until: at + waitMs,
      ...(engine ? { engine } : {}),
    };
    lastPress = [
      own,
      ...(more.also ?? []).map((a): Pressed => ({
        ...own,
        name: a.name,
        track: a.track,
        setMs: a.setMs,
        also: true,
      })),
    ];
    pressed.push(...lastPress);
    await sleep(waitMs);
  };
  /** The case so far is over: what comes next (a screen opening) is no part of its frames. */
  const closeCase = () => {
    const now = Date.now();
    for (const p of lastPress) p.until = Math.min(p.until, now);
    lastPress = [];
  };
  const goLive = (presentationId: string, slideIndex: number): EngineCommand => ({
    type: 'goLive',
    presentationId,
    slideIndex,
  });
  /** Each output's page, as it is now. */
  const screens = () =>
    Promise.all(
      deps.outputs().map(async (window) => ({
        window,
        state: await ask<ScreenState, ScreenState | null>(window, SCREEN_STATE, null),
      })),
    );
  /**
   * A screen opened for a case (DK-6's second hall screen, DK-2's stage screen), given its job as Screens gives it: on
   * `on` (the display a screen of a case before had), else a display no screen uses, the computer's own or a pretend
   * one beside it (CI has one display). Waits until its page is ready to draw the show (a hall screen's warm-up done)
   * with the motion probe on; why not, else.
   */
  const openScreen = async (
    job: 'audience' | 'stage',
    on?: number,
  ): Promise<{ window: BrowserWindow; displayId: number } | string> => {
    const op = operator();
    if (!op) return 'no operator window';
    let free = on === undefined ? await ask<number[], number[]>(op, FREE_DISPLAYS, []) : [on];
    if (free.length === 0 && deps.pretendDisplays) {
      deps.pretendDisplays(1);
      // As Drashti hears of a display plugged in (electron-outputs.ts watchDisplays: 300 ms).
      await sleep(500);
      free = await ask<number[], number[]>(op, FREE_DISPLAYS, []);
    }
    const displayId = free.at(-1);
    if (displayId === undefined) return 'no display for it (no pretend display here)';
    // A new hall screen is a new window; a stage screen may be the same window given another job.
    const before = new Set(job === 'audience' ? deps.outputs() : []);
    if (!(await ask<boolean, boolean>(op, SET_JOB(displayId, job), false))) return 'Screens did not give it';
    const until = Date.now() + SCREEN_LIMIT_MS;
    while (Date.now() < until) {
      const ready = (await screens()).find(
        ({ window, state }) =>
          !before.has(window) &&
          state !== null &&
          state.role === job &&
          state.fonts === 'ready' &&
          state.warmUp !== 'warming' &&
          state.probe,
      );
      if (ready) return { window: ready.window, displayId };
      await sleep(100);
    }
    return `it was not ready within ${String(SCREEN_LIMIT_MS / 1000)} s`;
  };
  /** The motion probe's record of a screen from `from` until `until` (ms since the epoch), or null. */
  const readProbe = (output: BrowserWindow | undefined, from: number, until: number) =>
    ask<ProbeRecord | null, null>(
      output ?? null,
      `window.drashtiMotionProbe ? window.drashtiMotionProbe.read(${String(from)}, ${String(until)}) : null`,
      null,
    );
  return {
    slides: { presentationId: null, everyMs: 2000 },
    begin: async () => {
      progress('the check begins (the import and its slide changes come first)');
      // A fault here leaves the table slides out, saying why: never the check.
      try {
        table = await tableSlides(deps, repo, libraryId);
        progress(
          `made its table slides from a generated deck’s editable copy (${plural(table.cells, 'cell')} as text boxes, ${plural(table.objects, 'object')} a slide)`,
        );
      } catch (error) {
        note(`no table slides: ${cutText(String(error), 200)}`);
      }
    },
    end: async () => {
      progress('the cases begin');
      const streaming = (sw('DRASHTI_PERF_STREAM') ?? '') !== '';
      const twoCores = sw('DRASHTI_PERF_HANDICAP') === '1';
      // The cases stop pressing at this budget, or once Drashti has been up 12 minutes, measuring those done, so the
      // check always ends in its time.
      const until = casesUntil(Date.now(), process.uptime() * 1000);
      const deadline = until.at;
      /** Why a case was not pressed: out of the cases' time, or Drashti up 12 minutes (its check stops at 14). */
      const stopped =
        until.by === 'uptime' ? `Drashti up ${String(UP_TO_MS / 60_000)} minutes` : 'out of time';
      const skipped = new Set<string>();
      /** C3 (Session 58): each pointed run's memory added, by window. */
      const pointedMemory: WindowsMemory[] = [];
      const inTime = (name: string) => {
        if (Date.now() < deadline) return true;
        if (until.by === 'uptime' && skipped.size === 0) note(`${stopped}: no more cases pressed`);
        skipped.add(name);
        return false;
      };
      /** A case of the last ones starts only with time left for all its runs; out of time, it is said. */
      const timeFor = (ms: number, what: string) => {
        if (deadline - Date.now() >= ms) return true;
        note(`${stopped}: no ${what}`);
        return false;
      };
      const output = deps.outputs()[0];
      const probeOn =
        output !== undefined &&
        (await within(
          output.webContents.executeJavaScript(
            'typeof window.drashtiMotionProbe?.read === "function"',
            true,
          ) as Promise<boolean>,
          PAGE_LIMIT_MS,
          false,
        ));
      const op = operator();
      const wallpaper = op
        ? await within(
            op.webContents.executeJavaScript(CHOOSE_WALLPAPER(wallpaperPicture), true) as Promise<boolean>,
            PAGE_LIMIT_MS,
            false,
          )
        : false;
      progress(
        `motion probe ${probeOn ? 'on' : 'NOT on'}; the Wallpaper’s picture ${wallpaper ? 'chosen' : 'NOT chosen'}`,
      );
      // Up first, unmeasured: the slides' picture loads once, as before a show.
      await press('(warm-up)', 'slide', 0, goLive(slidesId, 1), 1500);
      // Each transition back and forth between its two slides, on screens moving Calm.
      progress('slide transitions (Calm)');
      for (const [k, t] of transitions.entries()) {
        const name = `${t.kind} ${t.ms > 0 ? String(t.ms) : ''}`.trim();
        for (let i = 0; i < RUNS && inTime(name); i++)
          await press(name, 'slide', t.ms, goLive(slidesId, k * 2 + (i % 2)), t.ms + SETTLE_MS);
      }
      // The Bold moves, and Bold's fade, on screens moving Bold.
      progress('slide transitions (Bold)');
      deps.setMovement?.('bold');
      await sleep(SETTLE_MS);
      for (const kind of BOLD) {
        const k = KINDS.indexOf(kind);
        const name = `${kind} ${String(DEFAULT_MS)} (Bold)`;
        for (let i = 0; i < RUNS && inTime(name); i++)
          await press(name, 'slide', DEFAULT_MS, goLive(slidesId, k * 2 + (i % 2)), DEFAULT_MS + SETTLE_MS);
      }
      deps.setMovement?.('calm');
      await sleep(SETTLE_MS);
      // The covers: a cut each, on and off.
      progress('Black-out and the Wallpaper');
      for (let i = 0; i < RUNS && inTime('Black-out'); i++) {
        await press('Black-out on', 'blackout', 0, { type: 'setBlackout', on: true }, SETTLE_MS);
        await press('Black-out off', 'blackout', 0, { type: 'setBlackout', on: false }, SETTLE_MS);
      }
      for (let i = 0; i < RUNS && inTime('Wallpaper'); i++) {
        await press('Wallpaper on', 'wallpaper', 0, { type: 'setWallpaper', on: true }, SETTLE_MS);
        await press('Wallpaper off', 'wallpaper', 0, { type: 'setWallpaper', on: false }, SETTLE_MS);
      }
      // Lower thirds in, a moment held, and out.
      progress('lower thirds');
      for (const { key, lowerThird } of lowerThirds()) {
        const inMs = lowerThirdMs(lowerThird, 'in');
        const outMs = lowerThirdMs(lowerThird, 'out');
        for (let i = 0; i < SHORT_RUNS && inTime(`lower third ${key}`); i++) {
          await press(
            `lower third ${key} in`,
            'lowerThird',
            inMs,
            { type: 'showLowerThird', lowerThird },
            inMs + 400,
          );
          await press(
            `lower third ${key} out`,
            'lowerThird',
            outMs,
            { type: 'hideLowerThird' },
            outMs + SETTLE_MS,
          );
        }
      }
      // The deck: in (its first step's clip, the deck's push inside it), then two clicks. A plain slide goes up first,
      // so the deck comes in each time rather than going live again where it already is.
      const away = () => press('(away from the deck)', 'slide', 0, goLive(slidesId, 0), SETTLE_MS);
      progress('the deck');
      for (let i = 0; i < SHORT_RUNS && inTime('the deck'); i++) {
        await away();
        await press('deck slide in (step 0)', 'deck', CLIP_MS, goLive(deckId, 0), CLIP_MS + 800);
        await press('deck click', 'deck', CLIP_MS, { type: 'next' }, CLIP_MS + 800);
        await press('deck click', 'deck', CLIP_MS, { type: 'next' }, CLIP_MS + 800);
      }
      // C3 (Session 58, Q57-26): the cold jump as an operator makes it, the pointer resting on the deck slide's row a
      // moment before the click (perf-pointed.ts), so every hall screen has its first clip waiting at the frame the
      // click starts it from; and what that clip costs each window in memory. Then, for the show's safety, a click
      // whose clip plays on air while a slide is pointed at and let go of again and again (each pointing loads a clip
      // on the screen's page), beside the plain clicks above. Only with time for all its runs.
      const deckRow = { presentationId: deckId, slideIndex: 0, arrangementId: null };
      if (
        timeFor(
          SHORT_RUNS * (SETTLE_MS + POINTED_LEAD_MS + 2 * (CLIP_MS + 800)),
          'deck slide pointed at first',
        )
      ) {
        progress('the deck slide pointed at, then clicked; a click with a slide pointed at meanwhile');
        for (let i = 0; i < SHORT_RUNS && Date.now() < deadline; i++) {
          await away();
          const before = windowsMemory(deps.outputs(), operator(), deps.program?.() ?? null);
          await sleep(POINTED_SAY_MS);
          await ask(operator(), POINT_AT(deckRow), false);
          await sleep(POINTED_LOAD_MS);
          pointedMemory.push(
            memoryAdded(before, windowsMemory(deps.outputs(), operator(), deps.program?.() ?? null)),
          );
          await press(POINTED_ROW, 'deck', CLIP_MS, goLive(deckId, 0), CLIP_MS + 800);
          await ask(operator(), POINT_AT(null), false);
          const churning = pointWhileOnAir(operator, deckRow, CLIP_MS);
          await press(POINTED_ON_AIR_ROW, 'deck', CLIP_MS, { type: 'next' }, CLIP_MS + 800);
          await churning;
        }
      }
      // One more click after the slide has stood still 20 s: Chromium may suspend a paused video after about 15 s, and
      // the next step's clip waits paused at its start. Measured only in time; it never marks the check out of time.
      if (Date.now() < deadline) {
        await away();
        await press('deck slide in, then 20 s still', 'deck', CLIP_MS, goLive(deckId, 0), CLIP_MS + 20_000);
        await press('deck click after 20 s still', 'deck', CLIP_MS, { type: 'next' }, CLIP_MS + 800);
      } else progress(`${stopped}: no click after 20 s still`);
      // A deck Drashti plays itself (13 Nov 2026), as dissolve 800 was measured (one hall screen, no other window
      // open), before the leftovers, so it runs on two cores too: from its first slide (a cut) by Next, its own Wipe,
      // Cover, Uncover and Push, then its last slide's shapes in by Split and out by Split, then in by Shape and out
      // by Shape, a click each. Only when there is time for all its rounds, never marking the check out of time.
      if (
        timeFor(
          SHORT_RUNS * DECK_OWN_ROUND_MS,
          'deck Drashti plays itself (its own transitions, its Splits and Shapes)',
        )
      ) {
        progress(
          'a deck Drashti plays itself: its own Wipe, Cover, Uncover and Push, its shapes in and out by Split and by Shape',
        );
        for (let i = 0; i < SHORT_RUNS && Date.now() < deadline; i++) {
          await press(DECK_OWN_FIRST, 'slide', 0, goLive(deckOwnId, 0), SETTLE_MS);
          for (const own of DECK_OWN)
            await press(own.row, 'slide', DECK_OWN_MS, { type: 'next' }, DECK_OWN_MS + SETTLE_MS);
          for (const row of [DECK_SPLIT_IN, DECK_SPLIT_OUT])
            await press(row, 'nativeDeck', DECK_SPLIT_MS, { type: 'next' }, DECK_SPLIT_MS + SETTLE_MS);
          for (const row of [DECK_SHAPE_IN, DECK_SHAPE_OUT])
            await press(row, 'nativeDeck', DECK_SHAPE_MS, { type: 'next' }, DECK_SHAPE_MS + SETTLE_MS);
        }
      }
      // Session 57's leftovers last (MS-1, DK-6, DK-2), as the click after 20 s still: each only when there is time
      // for all its runs, never marking the check out of time; and never in the two-core streaming check, which ran
      // into its 14-minute stop with them (after3).
      const leftovers = leftoversIn({ streaming, twoCores });
      if (!leftovers)
        note(
          'left out of the two-core streaming check, for its time: the table slides (MS-1), the jump to a deck slide Drashti plays itself (DK-6) and the deck with the windows without a Preloader (DK-2)',
        );
      // MS-1: a slide of 250 cells, each a text box that measures itself as it comes; back and forth, as a fade.
      if (leftovers && !table) note('no table slides to press');
      else if (
        leftovers &&
        table &&
        timeFor(2 * SHORT_RUNS * (DEFAULT_MS + TABLE_SETTLE_MS), 'table slides')
      ) {
        progress('table slides, 250 cells (MS-1)');
        for (const [k, name] of TABLE_CASES.entries())
          for (let i = 0; i < SHORT_RUNS && Date.now() < deadline; i++)
            await press(
              name,
              'slide',
              DEFAULT_MS,
              goLive(table.id, k * 2 + (i % 2)),
              DEFAULT_MS + TABLE_SETTLE_MS,
            );
      }
      // DK-6: a jump to a deck slide Drashti plays itself, with a sound, on two hall screens.
      let second: { window: BrowserWindow; displayId: number } | null = null;
      let secondRecord: ProbeRecord | null = null;
      const jumpsFrom = pressed.length;
      const jumpRunMs = SETTLE_MS + NATIVE_STEP_MS + NATIVE_SETTLE_MS;
      if (leftovers && timeFor(NATIVE_HUES.length * jumpRunMs, 'jump to a deck slide Drashti plays itself')) {
        closeCase();
        const opened = await openScreen('audience');
        if (typeof opened === 'string')
          note(`a jump to a deck slide Drashti plays itself on one screen: ${opened}`);
        else second = opened;
        progress(
          `a jump to a deck slide Drashti plays itself (DK-6), with a sound, on ${plural(second ? 2 : 1, 'hall screen')}`,
        );
        // The last slide first: none was ever next, so each picture is drawn for the first time.
        for (let i = NATIVE_HUES.length - 1; i >= 0 && Date.now() < deadline; i--) {
          await away();
          await press(
            NATIVE_EFFECTS,
            'nativeDeck',
            NATIVE_STEP_MS,
            goLive(nativeId, i),
            NATIVE_STEP_MS + NATIVE_SETTLE_MS,
            {
              also: [{ name: NATIVE_ARRIVES, track: 'slide', setMs: 0 }],
              firstEffectMs: NATIVE_MOTION[0]?.delayMs ?? 0,
            },
          );
        }
        closeCase();
        const jumps = pressed.slice(jumpsFrom).filter((p) => p.name === NATIVE_EFFECTS);
        const first = jumps[0];
        const last = jumps.at(-1);
        // Screen 2's record now: DK-2 gives its display the stage.
        if (second && first && last) {
          secondRecord = await readProbe(second.window, first.at - 2000, last.until + 1000);
          if (!secondRecord) note('no record of screen 2: its motion probe did not answer');
        }
      }
      // DK-2: the deck's clicks again, with every window that loads nothing ahead open (each one more paused clip).
      let windows: WindowsOpen | null = null;
      const dk2RunMs = SETTLE_MS + 3 * (CLIP_MS + 800);
      if (leftovers && timeFor(DK2_RUNS * dk2RunMs, `deck clicks with the ${DK2_WINDOWS} open`)) {
        closeCase();
        windows = await openWindowsWithoutPreloader(second?.displayId);
        progress(`the deck with the ${DK2_WINDOWS} (DK-2): ${windowsLine(windows)}`);
        for (let i = 0; i < DK2_RUNS && Date.now() < deadline; i++) {
          await away();
          await press(
            `deck slide in (step 0), ${DK2_WINDOWS}`,
            'deck',
            CLIP_MS,
            goLive(deckId, 0),
            CLIP_MS + 800,
          );
          await press(`deck click, ${DK2_WINDOWS}`, 'deck', CLIP_MS, { type: 'next' }, CLIP_MS + 800);
          await press(`deck click, ${DK2_WINDOWS}`, 'deck', CLIP_MS, { type: 'next' }, CLIP_MS + 800);
        }
      }
      const trips = [...roundTrips].sort((a, b) => a - b);
      progress(
        `pressed ${String(pressed.length)} times; the operator window answered in median ${String(trips[Math.floor((trips.length - 1) / 2)] ?? '-')} ms, slowest ${String(trips.at(-1) ?? '-')} ms${skipped.size > 0 ? `; out of time, not all pressed: ${[...skipped].join(', ')}` : ''}`,
      );
      const measuredRuns = pressed.slice(1);
      const measured = await measure(output, measuredRuns);
      progress(`measured ${String(measured.runs.length)} runs from ${String(measured.frames)} frames`);
      // Screen 2's runs of the jumps, beside screen 1's.
      const jumpEntries = pressed.slice(jumpsFrom).filter((p) => p.engine !== undefined);
      const secondRuns = secondRecord ? runsOf(secondRecord, jumpEntries, SECOND) : [];
      const allRuns = [...measured.runs, ...secondRuns];
      const rows = rowsOf(allRuns, measured.period);
      const late = rows.filter((r) => r.late).map((r) => r.name);
      const uneven = rows.filter((r) => r.uneven).map((r) => r.name);
      const nativeJump = jumpsOf(jumpEntries, measuredRuns, measured.runs, secondRuns, second !== null);
      // Screen 2's rows are measured beside the case, never what decides the check: its absence is said in the notes.
      const unseen = rows.filter((r) => r.seen === 0 && !r.name.endsWith(SECOND)).map((r) => r.name);
      const unseenSecond = rows.filter((r) => r.seen === 0 && r.name.endsWith(SECOND)).map((r) => r.name);
      if (unseenSecond.length > 0) notes.push(`never seen on screen 2: ${unseenSecond.join(', ')}`);
      keep(streaming, {
        measured,
        rows,
        wallpaper,
        pressed,
        roundTrips,
        skipped: [...skipped],
        notes,
        table,
        nativeJump,
        windows,
        secondRuns,
        // What could stop the cases (their budget, or Drashti up 12 minutes), and whether the leftovers were pressed.
        stops: until.by,
        leftovers,
        // C3 (Session 58): what the deck slide's clip pointed at added to each window's memory, run by run (MB).
        pointedMemory,
      });
      const fromMain = pressed.filter((p) => p.from === 'main').length;
      return {
        checks: [
          {
            name: 'every animation case was seen on the audience screen (the motion probe’s record)',
            ok: probeOn && measured.frames > 0 && unseen.length === 0 && skipped.size === 0,
            detail: !probeOn
              ? 'the motion probe is not on (DRASHTI_TEST_MOTION_PROBE=1, never in an installed Drashti)'
              : unseen.length > 0 || skipped.size > 0
                ? `never seen moving: ${unseen.join(', ') || 'none'}; out of time: ${[...skipped].join(', ') || 'none'}`
                : `${plural(rows.length, 'case')}, ${plural(measured.runs.length + secondRuns.length, 'run')}`,
          },
        ],
        summary: `scenario animations: frame period ${measured.period.toFixed(2)} ms (${String(measured.frames)} frames)${wallpaper ? '' : ', the Wallpaper black (no picture could be chosen)'}${fromMain > 0 ? `, ${String(fromMain)} pressed from the main process` : ''}; ${stillLine(measured.still)}; late: ${late.join(', ') || 'none'}; uneven: ${uneven.join(', ') || 'none'}; ${rows.map(caseLine).join(' | ')}${nativeJump ? `; ${jumpLine(nativeJump.figures)}` : ''}${windows ? `; the deck with the ${DK2_WINDOWS}, ${windowsLine(windows)}` : ''}${pointedMemory.length > 0 ? `; memory a deck slide's clip pointed at added (MB): ${memoryLine(pointedMemory)}` : ''}${notes.length > 0 ? `; notes: ${notes.join('; ')}` : ''}`,
      };
    },
  };

  /**
   * DK-2's windows that load nothing ahead (DeckStep.tsx: each holds the next click's clip itself), opened as an
   * operator would: LIVE's picture (always in the operator window), Screens with the projector card and the stage
   * screen's card, a stage screen, and the stream's picture (its page as the Stream panel's preview asks for it: never
   * streaming anywhere; the streaming check's own stream to FFmpeg on this computer has it open already).
   */
  async function openWindowsWithoutPreloader(display: number | undefined): Promise<WindowsOpen> {
    const why: string[] = [];
    const op = operator();
    const live = await ask<boolean, boolean>(op, SHOWS('[data-testid="live-preview"]'), false);
    if (!live) why.push('LIVE’s picture was not drawn in the operator window');
    // A stage screen first (on the second hall screen's display, if DK-6 had one): the stage screen's card in Screens
    // draws only once a stage screen is set up.
    const stage = await openScreen('stage', display);
    if (typeof stage === 'string') why.push(`a stage screen: ${stage}`);
    const seen = async (selector: string, ms: number) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (await ask<boolean, boolean>(operator(), SHOWS(selector), false)) return true;
        await sleep(100);
      }
      return false;
    };
    await ask<boolean, boolean>(op, OPEN_SCREENS(process.platform === 'darwin'), false);
    let projectorCard = await seen('[data-testid="projector-preview"]', 3000);
    if (!projectorCard) {
      await ask<boolean, boolean>(op, CLICK_SCREENS, false);
      projectorCard = await seen('[data-testid="projector-preview"]', 3000);
    }
    if (!projectorCard) why.push('Screens did not open in the operator window');
    const stageCard = await seen('[data-testid="screens-card-stage"] [data-testid="stage-preview"]', 3000);
    if (!stageCard && typeof stage !== 'string') why.push('the stage screen’s card drew no picture');
    const streamOpen = () => (deps.program?.() ?? null) !== null;
    let streamPicture = streamOpen();
    if (!streamPicture) {
      await ask<boolean, boolean>(op, WATCH_STREAM, false);
      const until = Date.now() + 10_000;
      while (!streamPicture && Date.now() < until) {
        await sleep(100);
        streamPicture = streamOpen();
      }
      if (!streamPicture) why.push('the stream’s page did not open for its preview');
    }
    return { live, projectorCard, stageCard, stageScreen: typeof stage !== 'string', streamPicture, why };
  }
}

/** Each press's run on a screen, from its motion probe's record (the paint log's times left out). */
function runsOf(record: ProbeRecord, entries: readonly Pressed[], suffix = ''): Measured[] {
  const period = framePeriod(record.frames);
  return entries.map((p) => ({
    ...measureRun(
      { frames: record.frames, changes: record.changes[p.track] ?? [] },
      { pressAt: p.at, until: p.until },
      period,
    ),
    name: `${p.name}${suffix}`,
    setMs: p.setMs,
    pressAt: p.at,
    mainAt: null,
    paintedAt: null,
  }));
}

/**
 * DK-6's jumps on each screen: the engine's own times beside each screen's first frame showing the slide and its first
 * moving effect, and their figures. Screen 1's runs are `measured` (one for each of `entries`, in order); screen 2's
 * `second` (the jumps' runs, effects and arrivals alike, in their order). Null with no jump measured.
 */
function jumpsOf(
  jumpEntries: readonly Pressed[],
  entries: readonly Pressed[],
  measured: readonly Measured[],
  second: readonly Measured[],
  twoScreens: boolean,
): { jumps: JumpOnScreens[]; figures: JumpFigures } | null {
  const onScreen1 = new Map(entries.map((p, i): [Pressed, Measured | undefined] => [p, measured[i]]));
  const onScreen2 = new Map(jumpEntries.map((p, i): [Pressed, Measured | undefined] => [p, second[i]]));
  const jumps: JumpOnScreens[] = [];
  for (const effects of jumpEntries) {
    const engine = effects.engine;
    if (effects.also || !engine) continue;
    const arrives = jumpEntries.find((p) => p.also && p.at === effects.at && p.track === 'slide');
    const at = (runs: ReadonlyMap<Pressed, Measured | undefined>, p: Pressed | undefined) =>
      (p ? runs.get(p)?.firstAt : null) ?? null;
    jumps.push({
      shownAt: engine.shownAt,
      effectAt: engine.effectAt,
      arrivedAt: twoScreens ? [at(onScreen1, arrives), at(onScreen2, arrives)] : [at(onScreen1, arrives)],
      movedAt: twoScreens ? [at(onScreen1, effects), at(onScreen2, effects)] : [at(onScreen1, effects)],
    });
  }
  return jumps.length > 0 ? { jumps, figures: jumpFigures(jumps) } : null;
}

/** Every press's run, from the screen's motion probe and its paint log. */
async function measure(
  output: BrowserWindow | undefined,
  pressed: readonly Pressed[],
): Promise<{
  runs: Measured[];
  period: number;
  frames: number;
  /** How evenly the screen drew between the cases, nothing moving: its own baseline. */
  still: CaseRow['intervals'];
  /** The probe's record of the whole stretch, kept with the figures. */
  probe: ProbeRecord | null;
}> {
  const first = pressed[0];
  const last = pressed.reduce<Pressed | undefined>((a, p) => (a && a.until >= p.until ? a : p), undefined);
  const none = { runs: [], period: 1000 / 60, frames: 0, still: null, probe: null };
  if (!output || output.isDestroyed() || !first || !last) return none;
  const read = await within(
    output.webContents.executeJavaScript(
      `window.drashtiMotionProbe ? window.drashtiMotionProbe.read(${String(first.at - 2000)}, ${String(last.until + 1000)}) : null`,
      true,
    ) as Promise<ProbeRecord | null>,
    PAGE_LIMIT_MS * 4,
    null,
  );
  const paints = await within(
    output.webContents.executeJavaScript('globalThis.drashtiPaintLog ?? []', true) as Promise<
      { rev: number; sentAt: number; paintedAt: number }[]
    >,
    PAGE_LIMIT_MS * 4,
    [],
  );
  if (!read) return none;
  const period = framePeriod(read.frames);
  const runs = pressed.map((p): Measured => {
    const run = measureRun(
      { frames: read.frames, changes: read.changes[p.track] ?? [] },
      { pressAt: p.at, until: p.until },
      period,
    );
    const own = paints.find((e) => e.rev === p.rev);
    return {
      ...run,
      name: p.name,
      setMs: p.setMs,
      pressAt: p.at,
      mainAt: own?.sentAt ?? null,
      paintedAt: own?.paintedAt ?? null,
    };
  });
  // Between the cases: from a few frames after each run's last moving frame until a frame before the next press (never
  // while a lower third is up: one's moving background moves on, unwatched; a press watched on a second track counts
  // once, by its first).
  const still = runs.flatMap((r, i) =>
    r.lastAt === null || pressed[i]?.track === 'lowerThird' || pressed[i]?.also
      ? []
      : stillIntervals(read.frames, r.lastAt + period * 3, (pressed[i]?.until ?? r.lastAt) - period),
  );
  return {
    runs,
    period,
    frames: read.frames.length,
    still: intervalStats(still, period),
    probe: read,
  };
}

/** Each case's row, in the order first run (a screen 2's after screen 1's). */
function rowsOf(runs: readonly Measured[], period: number): CaseRow[] {
  const names = [...new Set(runs.map((r) => r.name))];
  return names.map((name) =>
    caseRow(
      name,
      runs.find((r) => r.name === name)?.setMs ?? 0,
      runs.filter((r) => r.name === name),
      period,
    ),
  );
}

/** Every figure, and each run's own, where the Performance workflow keeps the raw times (90 days). */
function keep(streaming: boolean, what: object): void {
  const dir = sw('DRASHTI_PERF_RAW');
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `animations-${process.platform}-${streaming ? 'streaming' : 'plain'}.json`),
      JSON.stringify({ platform: process.platform, handicap: sw('DRASHTI_PERF_HANDICAP') === '1', ...what }),
    );
  } catch {
    // The summary has every row anyway.
  }
}
