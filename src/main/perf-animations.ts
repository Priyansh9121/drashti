import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineCommand } from '../shared/engine/commands';
import type { DeckSlide } from '../shared/deck';
import type { LowerThird, LowerThirdLook } from '../shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../shared/lower-thirds';
import { animationById, animationLength, cutIntoUnits } from '../shared/lower-third-animations';
import { FAMILIES, idFor } from '../shared/lower-third-studio';
import type { TextStyle, TransitionKind } from '../shared/model';
import {
  caseLine,
  caseRow,
  type CaseRow,
  framePeriod,
  intervalStats,
  measureRun,
  type MotionRun,
  stillIntervals,
  stillLine,
} from '../shared/motion-measure';
import { plural } from '../shared/text';
import { PresentationRepo } from './db/presentations';
import { makePicture, makeVideo, type ScenarioDeps, type ScenarioRun } from './perf-scenarios';
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
 *   coming in;
 * - a lower third in and out: three styles (box, band, glass) and one of the heaviest (letter by letter with a blur,
 *   glass, sparkles behind);
 * - Black-out on and off, and the Wallpaper (a placeholder picture chosen) on and off.
 * (The opening plays only in the operator window as a person starts Drashti, never in a self-test: the Performance
 * spec measures it on its own, tests/perf/performance.spec.ts.)
 * For each: the delay from the press to the first frame that moved, the length from that frame to the last against
 * its set length, and the intervals between the frames drawn meanwhile (shared/motion-measure.ts). Every figure is in
 * the summary, and with each run's own in DRASHTI_PERF_RAW (animations-<platform>-<plain|streaming>.json). Placeholder
 * words and generated pictures only.
 */

/** What a case watches on the screen (render/motion-probe.ts's tracks). */
type Track = 'slide' | 'deck' | 'lowerThird' | 'blackout' | 'wallpaper';

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
}

/** A run as the scenario keeps it, with the main process's and the screen's own times. */
interface Measured extends MotionRun {
  name: string;
  pressAt: number;
  /** When the main process sent the change (the screen's paint log), and when the screen first drew it. */
  mainAt: number | null;
  paintedAt: number | null;
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
/** The lines it writes as it goes (tests/perf/performance.spec.ts prints them). */
export const PROGRESS = 'DRASHTI_PERF_ANIMATIONS';

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
    lastId: makePicture(deps, `animations-deck-last-${String(i)}`, 30 + i * 90, null),
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
  progress(`made its slides, deck and pictures (${String(Date.now() - made)} ms)`);
  /** How long each press from the operator window took to come back, and how many in a row never did. */
  const roundTrips: number[] = [];
  let unanswered = 0;
  /** Press a case once, and wait `waitMs` after it. */
  const press = async (
    name: string,
    track: Track,
    setMs: number,
    command: EngineCommand,
    waitMs: number,
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
    const before = pressed.at(-1);
    if (before) before.until = at;
    pressed.push({ name, track, setMs, at, rev, from, until: at + waitMs });
    await sleep(waitMs);
  };
  const goLive = (presentationId: string, slideIndex: number): EngineCommand => ({
    type: 'goLive',
    presentationId,
    slideIndex,
  });
  return {
    slides: { presentationId: null, everyMs: 2000 },
    begin: () => {
      progress('the check begins (the import and its slide changes come first)');
      return Promise.resolve();
    },
    end: async () => {
      progress('the cases begin');
      // The cases stop pressing at this budget, measuring those done, so the check always ends in its time.
      const deadline = Date.now() + BUDGET_MS;
      const skipped = new Set<string>();
      const inTime = (name: string) => {
        if (Date.now() < deadline) return true;
        skipped.add(name);
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
      // The deck: in (its first step's clip, the deck's push inside it), then two clicks.
      progress('the deck');
      for (let i = 0; i < SHORT_RUNS && inTime('the deck'); i++) {
        await press('deck slide in (step 0)', 'deck', CLIP_MS, goLive(deckId, 0), CLIP_MS + 800);
        await press('deck click', 'deck', CLIP_MS, { type: 'next' }, CLIP_MS + 800);
        await press('deck click', 'deck', CLIP_MS, { type: 'next' }, CLIP_MS + 800);
      }
      const trips = [...roundTrips].sort((a, b) => a - b);
      progress(
        `pressed ${String(pressed.length)} times; the operator window answered in median ${String(trips[Math.floor((trips.length - 1) / 2)] ?? '-')} ms, slowest ${String(trips.at(-1) ?? '-')} ms${skipped.size > 0 ? `; out of time, not all pressed: ${[...skipped].join(', ')}` : ''}`,
      );
      const measured = await measure(output, pressed.slice(1));
      progress(`measured ${String(measured.runs.length)} runs from ${String(measured.frames)} frames`);
      const rows = rowsOf(measured.runs, pressed.slice(1), measured.period);
      const late = rows.filter((r) => r.late).map((r) => r.name);
      const uneven = rows.filter((r) => r.uneven).map((r) => r.name);
      const streaming = (sw('DRASHTI_PERF_STREAM') ?? '') !== '';
      keep(streaming, { measured, rows, wallpaper, pressed, roundTrips, skipped: [...skipped] });
      const unseen = rows.filter((r) => r.seen === 0).map((r) => r.name);
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
                : `${plural(rows.length, 'case')}, ${plural(measured.runs.length, 'run')}`,
          },
        ],
        summary: `scenario animations: frame period ${measured.period.toFixed(2)} ms (${String(measured.frames)} frames)${wallpaper ? '' : ', the Wallpaper black (no picture could be chosen)'}${fromMain > 0 ? `, ${String(fromMain)} pressed from the main process` : ''}; ${stillLine(measured.still)}; late: ${late.join(', ') || 'none'}; uneven: ${uneven.join(', ') || 'none'}; ${rows.map(caseLine).join(' | ')}`,
      };
    },
  };
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
  probe: { frames: number[]; changes: Record<string, number[]> } | null;
}> {
  const first = pressed[0];
  const last = pressed.at(-1);
  const none = { runs: [], period: 1000 / 60, frames: 0, still: null, probe: null };
  if (!output || output.isDestroyed() || !first || !last) return none;
  const read = await within(
    output.webContents.executeJavaScript(
      `window.drashtiMotionProbe ? window.drashtiMotionProbe.read(${String(first.at - 2000)}, ${String(last.until + 1000)}) : null`,
      true,
    ) as Promise<{ frames: number[]; changes: Record<string, number[]> } | null>,
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
      pressAt: p.at,
      mainAt: own?.sentAt ?? null,
      paintedAt: own?.paintedAt ?? null,
    };
  });
  // Between the cases: from a few frames after each run's last moving frame until a frame before the next press (never
  // while a lower third is up: one's moving background moves on, unwatched).
  const still = runs.flatMap((r, i) =>
    r.lastAt === null || pressed[i]?.track === 'lowerThird'
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

/** Each case's row, in the order first pressed. */
function rowsOf(runs: readonly Measured[], pressed: readonly Pressed[], period: number): CaseRow[] {
  const names = [...new Set(pressed.map((p) => p.name))];
  return names.map((name) =>
    caseRow(
      name,
      pressed.find((p) => p.name === name)?.setMs ?? 0,
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
