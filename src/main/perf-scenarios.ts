import type { BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandResult, EngineCommand } from '../shared/engine/commands';
import type { MaskLayer } from '../shared/engine/state';
import type { Db } from './db/database';
import { PresentationRepo } from './db/presentations';
import type { PerfCheck } from './perftest';

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
}

/** What the slide changes go through (null: the usual three text slides), and how often. */
export interface ScenarioSlides {
  presentationId: string | null;
  everyMs: number;
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
    throw new Error(`FFmpeg could not make the scenario's video: ${r.stderr.toString().slice(0, 200)}`);
  const mediaId = randomUUID();
  deps.db
    .prepare("INSERT INTO media (id, kind, name, path, width, height) VALUES (?, 'video', ?, ?, ?, ?)")
    .run(mediaId, `Placeholder perf ${name}`, path, v.width, v.height);
  return { mediaId, fps: v.fps };
}

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
            name: `every screen showed 9 in 10 of the background video's frames (${String(fps)} fps)`,
            ok: worst >= 0.9,
            detail: kept.map(percent).join(', '),
          },
        ],
        summary: `scenario ${name}: ${String(counts.length)} screen(s), video frames shown ${kept.map(percent).join(', ')} of ${String(fps)} a second`,
      };
    },
  };
}
