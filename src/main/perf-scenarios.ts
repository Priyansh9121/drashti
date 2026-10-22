import type { BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandResult, EngineCommand } from '../shared/engine/commands';
import type { MaskLayer } from '../shared/engine/state';
import type { Movement } from '../shared/looks';
import type { TextStyle, TransitionKind } from '../shared/model';
import type { PictureLook } from '../shared/picture-look';
import type { Db } from './db/database';
import { PresentationRepo } from './db/presentations';
import { FIRST_BOLD_MARK } from '../shared/perf-marks';
import type { PerfCheck } from './perftest';
import { cutText, plural } from '../shared/text';

/*
 * The performance check's heavy cases (Session 15: speed on modest
 * hardware), chosen with DRASHTI_PERF_SCENARIO. Each runs while the usual
 * slide changes and the big import go on, with its own load on the screens:
 *
 * - video-1080p30: a 1080p30 video background (masks-video without its mask, to compare);
 * - masks-video: a 1080p30 video background with a mask up over it;
 * - video-1080p60 and video-4k: a 1080p60, or a 4K (3840 × 2160) 30 fps, video background;
 * - dissolves-video: slides that each bring a different 1080p30 video
 *   background, dissolving into each other every two seconds;
 * - three-outputs: three outputs (with DRASHTI_WINDOWED_OUTPUTS and two extra
 *   displays) and a 1080p30 background, with the stream, a recording and the
 *   music when those are asked for too.
 * - enhanced-pictures (Session 26e): slides of 1080p pictures, each zoomed and
 *   with every enhancement (brightness, contrast, colour, sharpening), changed
 *   at the plain check's pace through the import: the screens must draw them
 *   with their looks.
 * - bold-transitions (Session 27): slides of placeholder words and a picture,
 *   each coming on by another of the Bold kinds (push, wipe, zoom, line by line,
 *   word by word, the fade) over a picture background, every screen group
 *   moving Bold from when the measured part begins: each screen must draw nine
 *   in ten of its transitions' frames (the dissolves' smoothness), and with a
 *   trace (DRASHTI_PERF_PROFILE) the GPU must make no new pipeline during the
 *   first Bold transition (the screens warmed it up, render/WarmUp.tsx).
 * - live-window (Session 48): another app's window live as the background on two
 *   outputs (DRASHTI_WINDOWED_OUTPUTS, one extra display) and the stream in its
 *   Slides layout (where words over the camera would hide it), when
 *   DRASHTI_PERF_STREAM asks for it: a placeholder window with a moving test
 *   pattern stands in for a meeting's (DRASHTI_TEST_WINDOW_STANDIN=1, never
 *   packaged). Each screen must draw it live; how many of its frames each drew
 *   is said. With DRASHTI_PERF_NO_WINDOW=1 the same, with no window put up: what it
 *   costs is the difference.
 *
 * The videos are FFmpeg's test pattern with a tone, made by the bundled
 * FFmpeg in the check's throwaway library. Besides the usual checks, each
 * screen's background video must show nine in ten of its frames: a computer
 * that cannot decode and draw it in time drops them. The slides change every
 * two seconds, as in a sabha: the plain check's change every 40 ms is a test
 * of the import, and on CI's Mac it alone cost a 1080p30 background half its
 * frames, mask or none.
 */

export const PERF_SCENARIOS = [
  'video-1080p30',
  'masks-video',
  'video-1080p60',
  'video-4k',
  'dissolves-video',
  'three-outputs',
  'enhanced-pictures',
  'bold-transitions',
  'live-window',
] as const;
export type PerfScenario = (typeof PERF_SCENARIOS)[number];

export const isPerfScenario = (s: string | undefined): s is PerfScenario =>
  (PERF_SCENARIOS as readonly string[]).includes(s ?? '');

export interface ScenarioDeps {
  db: Db;
  mediaDir: string;
  ffmpeg: string | null;
  engine: { dispatch(command: EngineCommand): CommandResult };
  outputs: () => BrowserWindow[];
  /** Every picture's sharpened copy made (Session 26f). */
  sharpened?: () => Promise<void>;
  /** Every screen group in the live Look to move this way (Session 27). */
  setMovement?: (movement: Movement) => void;
  /** live-window (Session 48): open the placeholder window and put it up as the background; false if it cannot. */
  showPlaceholderWindow?: () => Promise<boolean>;
  /** The stream's page, while it is open (it draws the window too). */
  program?: () => Pick<BrowserWindow, 'webContents'> | null;
  /** live-window without the window (DRASHTI_PERF_NO_WINDOW): the same screens and stream, to compare. */
  withoutWindow?: boolean;
  /** live-window: the stream shows what the hall does (its Slides layout), the window included. */
  streamSlides?: () => void;
}

/** What the slide changes go through (null: the usual three text slides), and how often. */
export interface ScenarioSlides {
  presentationId: string | null;
  everyMs: number;
  /** How many slides it goes round (three when left out). */
  count?: number;
}

/** As an operator changes slides: every two seconds, not the plain check's 25 a second. */
const AS_IN_A_SABHA: ScenarioSlides = { presentationId: null, everyMs: 2000 };

export interface ScenarioRun {
  /** The slides to change, and how often. */
  slides: ScenarioSlides;
  /** Start counting each screen's video frames (as the measured part begins). */
  begin(): Promise<void>;
  /** The scenario's own checks and figures, once the measured part is over. */
  end(): Promise<{ checks: PerfCheck[]; summary: string }>;
}

interface Video {
  mediaId: string;
  fps: number;
}

/** A video FFmpeg makes (its test pattern, a tone), as a media item in the check's library. */
function makeVideo(
  deps: ScenarioDeps,
  name: string,
  v: { width: number; height: number; fps: number; seconds: number; hue: number },
): Video {
  if (!deps.ffmpeg) throw new Error('The scenarios need the bundled FFmpeg (node scripts/fetch-ffmpeg.mjs).');
  mkdirSync(join(deps.mediaDir, 'perf'), { recursive: true });
  const path = `perf/${name}.mp4`;
  const r = spawnSync(
    deps.ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${String(v.width)}x${String(v.height)}:rate=${String(v.fps)}`,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:sample_rate=48000',
      '-t',
      String(v.seconds),
      '-vf',
      `hue=h=${String(v.hue)}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      String(v.fps),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      join(deps.mediaDir, path),
    ],
    { stdio: 'pipe' },
  );
  if (r.status !== 0)
    throw new Error(`FFmpeg could not make the scenario’s video: ${cutText(r.stderr.toString(), 200)}`);
  const mediaId = randomUUID();
  deps.db
    .prepare("INSERT INTO media (id, kind, name, path, width, height) VALUES (?, 'video', ?, ?, ?, ?)")
    .run(mediaId, `Placeholder perf ${name}`, path, v.width, v.height);
  return { mediaId, fps: v.fps };
}

/** A 1080p picture FFmpeg makes (its test pattern, turned in hue), as a media item with every enhancement. */
function makeEnhancedPicture(deps: ScenarioDeps, name: string, hue: number): string {
  return makePicture(deps, name, hue, {
    zoom: 1.2,
    x: 0.05,
    y: 0,
    brightness: 0.1,
    contrast: 0.15,
    colour: 0.3,
    sharpness: 0.5,
  });
}

/** A 1080p JPEG of FFmpeg's test pattern, as a media item in the check's library, with a look or none. */
function makePicture(deps: ScenarioDeps, name: string, hue: number, look: PictureLook | null): string {
  if (!deps.ffmpeg) throw new Error('The scenarios need the bundled FFmpeg (node scripts/fetch-ffmpeg.mjs).');
  mkdirSync(join(deps.mediaDir, 'perf'), { recursive: true });
  const path = `perf/${name}.jpg`;
  const r = spawnSync(
    deps.ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1920x1080:rate=1',
      '-frames:v',
      '1',
      '-vf',
      `hue=h=${String(hue)}`,
      join(deps.mediaDir, path),
    ],
    { stdio: 'pipe' },
  );
  if (r.status !== 0)
    throw new Error(`FFmpeg could not make the scenario’s picture: ${cutText(r.stderr.toString(), 200)}`);
  const mediaId = randomUUID();
  // Its sha256, as an imported picture has: its sharpened copy is named by it (Session 26f).
  const sha256 = createHash('sha256')
    .update(readFileSync(join(deps.mediaDir, path)))
    .digest('hex');
  deps.db
    .prepare(
      "INSERT INTO media (id, kind, name, path, sha256, width, height, look) VALUES (?, 'image', ?, ?, ?, 1920, 1080, ?)",
    )
    .run(mediaId, `Placeholder perf ${name}`, path, sha256, look ? JSON.stringify(look) : null);
  return mediaId;
}

/**
 * How many pictures each screen draws with a look, how many of those from their sharpened copies (Session
 * 26f), and how many filters the page draws that are not plain CSS ones (none: no SVG filter at all).
 */
const LOOKS = `(() => {
  const all = [...document.querySelectorAll('[data-look-picture]')];
  const svg = document.querySelectorAll('filter, feConvolveMatrix').length +
    [...document.querySelectorAll('[style]')].filter((el) => el.style.filter.includes('url(')).length;
  return {
    looked: all.length,
    sharpened: all.filter((el) => el.hasAttribute('data-sharpened') && el.querySelector('img[src^="drashti-media://sharp/"]')).length,
    svg,
  };
})()`;

/**
 * Each screen's slide transitions, frame by frame (Session 27): how many there were, the frames drawn while
 * they ran, for how long, and the longest wait for a frame. The first is marked for a trace (what the GPU
 * made while it ran: perf-watch.ts, gpuPipelines).
 */
const TRANSITIONS = `(() => {
  const s = { transitions: 0, frames: 0, ms: 0, worst: 0 };
  window.drashtiTransitionFrames = s;
  let on = false;
  let last = 0;
  let start = 0;
  const tick = (t) => {
    const fading = document.querySelector('[data-layer="slide"][data-fading="true"]') !== null;
    if (fading && !on) {
      on = true;
      start = t;
      last = t;
      s.transitions += 1;
      if (s.transitions === 1) performance.mark('${FIRST_BOLD_MARK}');
    } else if (fading) {
      s.frames += 1;
      s.worst = Math.max(s.worst, t - last);
      last = t;
    } else if (on) {
      on = false;
      s.ms += t - start;
      if (s.transitions === 1) performance.mark('${FIRST_BOLD_MARK}-end');
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;
const TRANSITIONS_READ = `(() => window.drashtiTransitionFrames ?? null)()`;

/** A mask that shows only an ellipse in the middle: its edge is drawn over the video on every frame. */
const ELLIPSE: MaskLayer = {
  id: 'perf-mask',
  name: 'Placeholder perf mask',
  width: 1920,
  height: 1080,
  mode: 'show',
  shapes: [{ id: 'perf-ellipse', kind: 'ellipse', frame: { x: 160, y: 60, width: 1600, height: 960 } }],
};

/**
 * Each screen's background videos: for each, the frames it presented
 * (requestVideoFrameCallback's presentedFrames) from its first frame to its
 * last, against how many its rate gives in that time. Each video counts for
 * the time it played, so the two videos of a dissolve are not counted twice.
 */
const COUNT = `(() => {
  const g = globalThis;
  g.drashtiPerfFrames = [];
  const watched = new WeakSet();
  const watch = () => {
    for (const v of document.querySelectorAll('[data-layer="background"] video')) {
      if (watched.has(v)) continue;
      watched.add(v);
      const f = { first: null, last: null, firstFrames: 0, lastFrames: 0, callbacks: 0 };
      g.drashtiPerfFrames.push(f);
      const on = (now, meta) => {
        f.callbacks++;
        if (f.first === null) { f.first = now; f.firstFrames = meta.presentedFrames; }
        f.last = now;
        f.lastFrames = meta.presentedFrames;
        v.requestVideoFrameCallback(on);
      };
      v.requestVideoFrameCallback(on);
    }
  };
  watch();
  g.drashtiPerfFramesWatch = setInterval(watch, 250);
})()`;

const READ = `(() => {
  const g = globalThis;
  clearInterval(g.drashtiPerfFramesWatch);
  const all = (g.drashtiPerfFrames ?? []).filter((f) => f.first !== null && f.last > f.first);
  return {
    videos: all.length,
    frames: all.reduce((n, f) => n + Math.max(f.callbacks, f.lastFrames - f.firstFrames + 1), 0),
    seconds: all.reduce((n, f) => n + (f.last - f.first) / 1000, 0),
  };
})()`;

export function startScenario(name: PerfScenario, deps: ScenarioDeps): ScenarioRun {
  const background = (v: Video) => {
    deps.engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: v.mediaId, media: 'video', fit: 'fill', loop: true },
    });
  };
  let fps = 30;
  let slides: ScenarioSlides = AS_IN_A_SABHA;
  switch (name) {
    case 'video-1080p30': {
      background(
        makeVideo(deps, 'video-1080p30', { width: 1920, height: 1080, fps: 30, seconds: 20, hue: 0 }),
      );
      break;
    }
    case 'masks-video': {
      const v = makeVideo(deps, 'video-1080p30', { width: 1920, height: 1080, fps: 30, seconds: 20, hue: 0 });
      background(v);
      deps.engine.dispatch({ type: 'setMask', mask: ELLIPSE });
      break;
    }
    case 'video-1080p60': {
      const v = makeVideo(deps, 'video-1080p60', {
        width: 1920,
        height: 1080,
        fps: 60,
        seconds: 20,
        hue: 90,
      });
      fps = 60;
      background(v);
      break;
    }
    case 'video-4k': {
      const v = makeVideo(deps, 'video-4k30', { width: 3840, height: 2160, fps: 30, seconds: 20, hue: 180 });
      background(v);
      break;
    }
    case 'dissolves-video': {
      const videos = [0, 120, 240].map((hue, i) =>
        makeVideo(deps, `video-dissolve-${String(i + 1)}`, {
          width: 1920,
          height: 1080,
          fps: 30,
          seconds: 20,
          hue,
        }),
      );
      const repo = new PresentationRepo(deps.db);
      const presentationId = repo.insert({
        libraryId: repo.ensureLibrary('Default'),
        name: 'Placeholder perf video slides',
        transition: { kind: 'dissolve', durationMs: 1000 },
        groups: [
          {
            name: '',
            slides: videos.map((v, i) => ({
              elements: [],
              label: `Placeholder video ${String(i + 1)}`,
              cues: [
                {
                  kind: 'background' as const,
                  label: 'Placeholder video',
                  mediaId: v.mediaId,
                  props: { media: 'video', fit: 'fill', loop: true },
                },
              ],
            })),
          },
        ],
      });
      slides = { presentationId, everyMs: 2000 };
      break;
    }
    case 'three-outputs': {
      background(
        makeVideo(deps, 'video-1080p30', { width: 1920, height: 1080, fps: 30, seconds: 20, hue: 60 }),
      );
      break;
    }
    case 'enhanced-pictures': {
      const pictures = [0, 120, 240].map((hue, i) =>
        makeEnhancedPicture(deps, `picture-${String(i + 1)}`, hue),
      );
      const repo = new PresentationRepo(deps.db);
      const presentationId = repo.insert({
        libraryId: repo.ensureLibrary('Default'),
        name: 'Placeholder perf enhanced pictures',
        groups: [
          {
            name: '',
            slides: pictures.map((mediaId, i) => ({
              label: `Placeholder picture ${String(i + 1)}`,
              elements: [
                {
                  id: 'picture',
                  kind: 'image' as const,
                  frame: { x: 0, y: 0, width: 1920, height: 1080 },
                  mediaId,
                  fit: 'fill' as const,
                },
              ],
            })),
          },
        ],
      });
      // The plain check's pace (25 changes a second through the import): the pictures are the load.
      slides = { presentationId, everyMs: 40 };
      return {
        slides,
        // The pictures' sharpened copies are made first (once each, as after their looks are kept).
        begin: async () => {
          await deps.sharpened?.();
        },
        end: async () => {
          const seen = await Promise.all(
            deps.outputs().map(
              (w) =>
                w.webContents.executeJavaScript(LOOKS, true).catch(() => null) as Promise<{
                  looked: number;
                  sharpened: number;
                  svg: number;
                } | null>,
            ),
          );
          const ok =
            seen.length > 0 &&
            seen.every((s) => s !== null && s.looked > 0 && s.sharpened > 0 && s.svg === 0);
          return {
            checks: [
              {
                name: 'every screen drew its picture with its look (zoomed, every enhancement, its sharpened copy, no SVG filter)',
                ok,
                detail: seen
                  .map((s) =>
                    s
                      ? `${String(s.looked)} looked, ${String(s.sharpened)} sharpened, ${String(s.svg)} SVG filters`
                      : 'none',
                  )
                  .join('; '),
              },
            ],
            summary: `scenario ${name}: ${plural(seen.length, 'screen')}, pictures with looks ${seen.map((s) => String(s?.looked ?? 0)).join(', ')}`,
          };
        },
      };
    }
    case 'bold-transitions':
      return boldTransitions(deps);
    case 'live-window':
      return liveWindow(deps);
  }
  return {
    slides,
    begin: async () => {
      await Promise.all(
        deps.outputs().map((w) => w.webContents.executeJavaScript(COUNT, true).catch(() => undefined)),
      );
    },
    end: async () => {
      const counts = await Promise.all(
        deps.outputs().map(
          (w) =>
            w.webContents.executeJavaScript(READ, true).catch(() => null) as Promise<{
              videos: number;
              frames: number;
              seconds: number;
            } | null>,
        ),
      );
      // Frames presented against the videos' own rate, over the time each played.
      const kept = counts.map((c) =>
        c && c.seconds > 0 ? Math.min(1, c.frames / (c.seconds * fps + c.videos)) : 0,
      );
      const worst = kept.length > 0 ? Math.min(...kept) : 0;
      const percent = (k: number) => `${String(Math.round(k * 100))}%`;
      return {
        checks: [
          {
            name: `every screen showed 9 in 10 of the background video’s frames (${String(fps)} fps)`,
            ok: worst >= 0.9,
            detail: kept.map(percent).join(', '),
          },
        ],
        summary: `scenario ${name}: ${plural(counts.length, 'screen')}, video frames shown ${kept.map(percent).join(', ')} of ${String(fps)} a second`,
      };
    },
  };
}

/** Each screen's live window: frames it presented (requestVideoFrameCallback), from the first to the last. */
const WINDOW_COUNT = `(() => {
  const g = globalThis;
  const f = { first: null, last: null, firstFrames: 0, lastFrames: 0, callbacks: 0 };
  g.drashtiWindowFrames = f;
  const watch = () => {
    const v = document.querySelector('[data-kind="window"] video');
    if (!v || v === g.drashtiWindowVideo) return;
    g.drashtiWindowVideo = v;
    const on = (now, meta) => {
      f.callbacks++;
      if (f.first === null) { f.first = now; f.firstFrames = meta.presentedFrames; }
      f.last = now;
      f.lastFrames = meta.presentedFrames;
      v.requestVideoFrameCallback(on);
    };
    v.requestVideoFrameCallback(on);
  };
  watch();
  g.drashtiWindowWatch = setInterval(watch, 250);
})()`;

const WINDOW_READ = `(() => {
  const g = globalThis;
  clearInterval(g.drashtiWindowWatch);
  const f = g.drashtiWindowFrames;
  const state = document.querySelector('[data-kind="window"]')?.getAttribute('data-window-state') ?? 'none';
  if (!f || f.first === null || !(f.last > f.first)) return { state, perSecond: 0 };
  return { state, perSecond: Math.max(f.callbacks, f.lastFrames - f.firstFrames + 1) / ((f.last - f.first) / 1000) };
})()`;

/**
 * live-window (Session 48): the placeholder window up as the background before the measured part, on every
 * output and the stream's page; slides change every two seconds over it, as in a sabha.
 */
function liveWindow(deps: ScenarioDeps): ScenarioRun {
  const screens = (): Pick<BrowserWindow, 'webContents'>[] => {
    const program = deps.program?.() ?? null;
    return [...deps.outputs(), ...(program ? [program] : [])];
  };
  const state = (w: Pick<BrowserWindow, 'webContents'>) =>
    w.webContents
      .executeJavaScript(
        `document.querySelector('[data-kind="window"]')?.getAttribute('data-window-state') ?? ''`,
        true,
      )
      .catch(() => '') as Promise<string>;
  if (deps.withoutWindow)
    return {
      slides: AS_IN_A_SABHA,
      begin: () => {
        deps.streamSlides?.();
        return Promise.resolve();
      },
      end: () =>
        Promise.resolve({
          checks: [],
          summary: `scenario live-window without the window (to compare): ${plural(screens().length, 'screen')}`,
        }),
    };
  return {
    slides: AS_IN_A_SABHA,
    begin: async () => {
      deps.streamSlides?.();
      if (!(await deps.showPlaceholderWindow?.()))
        throw new Error(
          'The live-window scenario needs DRASHTI_TEST_WINDOW_STANDIN=1 (a placeholder to show).',
        );
      for (let i = 0; i < 150; i++) {
        if ((await Promise.all(screens().map(state))).every((s) => s === 'live')) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await Promise.all(
        screens().map((w) => w.webContents.executeJavaScript(WINDOW_COUNT, true).catch(() => undefined)),
      );
    },
    end: async () => {
      const seen = await Promise.all(
        screens().map(
          (w) =>
            w.webContents.executeJavaScript(WINDOW_READ, true).catch(() => null) as Promise<{
              state: string;
              perSecond: number;
            } | null>,
        ),
      );
      const shown = seen.map((s) => (s ? `${s.state} ${s.perSecond.toFixed(1)}/s` : 'none'));
      return {
        checks: [
          {
            name: 'every screen drew the window live (the outputs, and the stream when it is on)',
            ok: seen.length > 0 && seen.every((s) => s !== null && s.state === 'live' && s.perSecond > 0),
            detail: shown.join(', '),
          },
        ],
        summary: `scenario live-window: ${plural(seen.length, 'screen')} (the stream's page last when on), window frames ${shown.join(', ')}`,
      };
    },
  };
}

const BOLD_WORDS: TextStyle = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: true,
};

/**
 * bold-transitions (Session 27): placeholder words and a picture on each slide, each coming on by another
 * kind, over a picture background; every group moves Bold from the measured part's start, so its first
 * slide change (to the second slide: a push) is the show's first Bold transition.
 */
function boldTransitions(deps: ScenarioDeps): ScenarioRun {
  const pictures = [0, 120, 240].map((hue, i) =>
    makePicture(deps, `bold-picture-${String(i + 1)}`, hue, null),
  );
  deps.engine.dispatch({
    type: 'setBackground',
    background: { kind: 'media', mediaId: pictures[0] ?? '', media: 'image', fit: 'fill', loop: false },
  });
  const kinds: TransitionKind[] = ['dissolve', 'push', 'wipe', 'zoom-dissolve', 'lines', 'words'];
  const repo = new PresentationRepo(deps.db);
  const presentationId = repo.insert({
    libraryId: repo.ensureLibrary('Default'),
    name: 'Placeholder perf Bold slides',
    groups: [
      {
        name: '',
        slides: kinds.map((kind, i) => ({
          label: `Placeholder Bold ${String(i + 1)}`,
          transition: { kind, durationMs: 700 },
          elements: [
            {
              id: 'picture',
              kind: 'image' as const,
              frame: { x: 1240, y: 80, width: 600, height: 338 },
              mediaId: pictures[i % pictures.length] ?? '',
              fit: 'fill' as const,
            },
            {
              id: 'words',
              kind: 'text' as const,
              frame: { x: 96, y: 96, width: 1728, height: 888 },
              text: `Placeholder words ${String(i + 1)}\nA second placeholder line`,
              lang: 'en' as const,
              style: BOLD_WORDS,
            },
          ],
        })),
      },
    ],
  });
  return {
    slides: { presentationId, everyMs: 2000, count: kinds.length },
    begin: async () => {
      deps.setMovement?.('bold');
      await Promise.all(
        deps.outputs().map((w) => w.webContents.executeJavaScript(TRANSITIONS, true).catch(() => undefined)),
      );
    },
    end: async () => {
      const seen = await Promise.all(
        deps.outputs().map(
          (w) =>
            w.webContents.executeJavaScript(TRANSITIONS_READ, true).catch(() => null) as Promise<{
              transitions: number;
              frames: number;
              ms: number;
              worst: number;
            } | null>,
        ),
      );
      // Frames drawn while they ran, against 60 a second over their time.
      const kept = seen.map((t) => (t && t.ms > 0 ? Math.min(1, t.frames / (t.ms / (1000 / 60))) : 0));
      const worst = kept.length > 0 ? Math.min(...kept) : 0;
      const percent = (k: number) => `${String(Math.round(k * 100))}%`;
      const detail = seen
        .map((t, i) =>
          t
            ? `${plural(t.transitions, 'transition')}, ${percent(kept[i] ?? 0)} of their frames, longest wait ${String(Math.round(t.worst))} ms`
            : 'none',
        )
        .join('; ');
      return {
        checks: [
          {
            name: "every screen drew 9 in 10 of its Bold transitions' frames (60 a second)",
            ok: worst >= 0.9 && seen.every((t) => t !== null && t.transitions > 0),
            detail,
          },
        ],
        summary: `scenario bold-transitions: ${plural(seen.length, 'screen')}, ${detail}`,
      };
    },
  };
}
