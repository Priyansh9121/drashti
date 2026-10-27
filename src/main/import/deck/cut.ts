import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpegEnv } from '../../stream/worker/ffmpeg-env';
import type { MoviePlan } from './plan';
import { HOLD_SETTLE_MS } from './plan';

/*
 * Cutting a deck's movie into its steps (Session 54, C2, from C1's cut-clips.mjs and its findings: assister/
 * session-54-deck-trial.md, "How exact the cut points are"). FFmpeg (vendor/) reads how much each frame differs
 * from the one before; each slide is found by its transition near where the plan puts it, and each step is cut at
 * its moment, just before its motion starts, measured where it can be seen. A step whose measured start is more than
 * 0.2 s from its plan means the movie did not play as planned: the deck comes in as pictures instead, and the
 * report says so. Each step gets a clip (MP4, H.264, no sound) and its last frame (PNG); a step after which something
 * turns for ever (a spin) gets a one-turn hold to loop while it waits for the next click.
 */

/** A step more than this far from its planned moment sends the deck back to pictures. */
export const MAX_OFFSET_MS = 200;
/** How far from where the plan puts it a slide's transition is looked for (C1: −77 to +157 ms over 20 slides). */
const SLIDE_WINDOW_MS = 600;
/** A step's motion is looked for from this long before its moment to this long after it. */
const STEP_BEFORE_MS = 300;
const STEP_AFTER_MS = 800;
/** A clip starts this long before its step's motion: the click shows its first moving frame at once. */
export const LEAD_MS = 50;
/** A frame moves when the mean difference from the one before (0 to 255, at 192 × 108 in grey) is above this... */
const MOVING_AVG = 0.02;
/** ...or one of its pixels changed this much (a small thing fading in). */
const MOVING_MAX = 16;

export interface MotionFrame {
  /** When the frame shows, ms into the movie. */
  t: number;
  /** How much it differs from the frame before: the mean and the most of any pixel (0 to 255). */
  avg: number;
  max: number;
}

export interface Motion {
  frames: MotionFrame[];
  durationMs: number;
  width: number;
  height: number;
  fps: number;
}

/** A stretch of moving frames. */
export interface MotionRun {
  startMs: number;
  endMs: number;
  /** The biggest mean difference in it. */
  peak: number;
  frames: number;
}

export const moving = (f: MotionFrame): boolean => f.avg > MOVING_AVG || f.max > MOVING_MAX;

/** The moving stretches of a movie (frames that move, a single still frame between them bridged). */
export function motionRuns(frames: readonly MotionFrame[]): MotionRun[] {
  const runs: MotionRun[] = [];
  let open: MotionRun | null = null;
  let still = 0;
  for (const f of frames) {
    if (moving(f)) {
      if (open && still <= 1) {
        open.endMs = f.t;
        open.peak = Math.max(open.peak, f.avg);
        open.frames++;
      } else {
        open = { startMs: f.t, endMs: f.t, peak: f.avg, frames: 1 };
        runs.push(open);
      }
      still = 0;
    } else still++;
  }
  return runs;
}

/** What FFmpeg prints of a movie: its size, rate and length. */
export function parseMovieInfo(stderr: string): Pick<Motion, 'durationMs' | 'width' | 'height' | 'fps'> {
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(stderr);
  const video = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/u.exec(stderr);
  const fps = /Stream #[^\n]*Video:[^\n]*?(\d+(?:\.\d+)?) (?:fps|tbr)/u.exec(stderr);
  return {
    durationMs: d ? Math.round(((Number(d[1]) * 60 + Number(d[2])) * 60 + Number(d[3])) * 1000) : 0,
    width: video ? Number(video[1]) : 0,
    height: video ? Number(video[2]) : 0,
    fps: fps ? Number(fps[1]) : 30,
  };
}

/** Parse signalstats' printed metadata: each frame's time and its difference's mean and most. */
export function parseMotion(stdout: string): MotionFrame[] {
  const frames: MotionFrame[] = [];
  let current: MotionFrame | null = null;
  for (const line of stdout.split('\n')) {
    const at = /pts_time:(-?\d+(?:\.\d+)?)/u.exec(line);
    if (at) {
      current = { t: Math.round(Number(at[1]) * 1000), avg: 0, max: 0 };
      frames.push(current);
      continue;
    }
    const avg = /lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/u.exec(line);
    if (avg && current) current.avg = Number(avg[1]);
    const max = /lavfi\.signalstats\.YMAX=(\d+(?:\.\d+)?)/u.exec(line);
    if (max && current) current.max = Number(max[1]);
  }
  return frames;
}

/** Run FFmpeg, its output gathered; stopped when `signal` says or after `timeoutMs`. */
export function runFfmpeg(
  ffmpeg: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string; stopped: boolean }> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: '', stopped: true });
      return;
    }
    const child = spawn(ffmpeg, args, { windowsHide: true, env: ffmpegEnv() });
    let stdout = '';
    let stderr = '';
    let stopped = false;
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => {
      // Only its last words matter (its errors); a long run's progress is never kept.
      stderr = (stderr + d.toString()).slice(-20_000);
    });
    const stop = () => {
      stopped = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(stop, options.timeoutMs ?? 10 * 60_000);
    options.signal?.addEventListener('abort', stop);
    const done = (code: number | null) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', stop);
      resolve({ code, stdout, stderr, stopped });
    };
    child.on('error', () => {
      done(null);
    });
    child.on('exit', (code) => {
      done(code);
    });
  });
}

/** How much each frame of the movie moves, and the movie's size, rate and length. */
export async function measureMotion(ffmpeg: string, movie: string, signal?: AbortSignal): Promise<Motion> {
  const r = await runFfmpeg(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-protocol_whitelist',
      'file',
      '-i',
      movie,
      '-an',
      '-vf',
      'scale=192:108,format=gray,tblend=all_mode=difference,signalstats,metadata=print:file=-',
      '-f',
      'null',
      '-',
    ],
    { signal },
  );
  if (r.stopped) throw new Error('stopped');
  const info = parseMovieInfo(r.stderr);
  const frames = parseMotion(r.stdout);
  if (r.code !== 0 || frames.length === 0) throw new Error('FFmpeg could not read the movie');
  return { ...info, frames };
}

// ---- where to cut ------------------------------------------------------------------------------------

/** One step's cut: its clip, and its hold when it has one (ms into the movie). */
export interface StepCut {
  fromMs: number;
  toMs: number;
  hold: { fromMs: number; toMs: number } | null;
  /** Step 0 only: how much of the clip is the deck's own transition. */
  transitionMs: number;
}

export interface SlideCut {
  /** Its index among the deck's slides (as the plan has it). */
  index: number;
  steps: StepCut[];
}

/** How each step's measured start compared with its plan. */
export interface Offset {
  /** Which shown slide (from 0) and step. */
  slide: number;
  step: number;
  /** Measured minus planned (ms), or null when nothing could be seen to move. */
  offsetMs: number | null;
}

export interface CutPlan {
  slides: SlideCut[];
  offsets: Offset[];
  /** Shown slides (from 0) whose transition was not found near its planned moment. */
  lostSlides: number[];
  /** The step furthest from its plan, as measured (ms), and where. */
  worst: { slide: number; step: number; offsetMs: number } | null;
}

/** Whether the movie played as planned: every step it could see within 0.2 s, every slide where it should be. */
export const onPlan = (cut: CutPlan): boolean =>
  cut.lostSlides.length === 0 && (cut.worst === null || Math.abs(cut.worst.offsetMs) <= MAX_OFFSET_MS);

/** Find each slide and step in the movie by the plan, and where to cut each. */
export function planCuts(plan: MoviePlan, motion: Motion): CutPlan {
  const frameMs = 1000 / (motion.fps > 0 ? motion.fps : 30);
  const runs = motionRuns(motion.frames);
  const end = motion.durationMs > 0 ? motion.durationMs : (motion.frames[motion.frames.length - 1]?.t ?? 0);
  // Each slide's start: its transition's first moving frame, near where the slide before puts it.
  const starts: number[] = [];
  const lostSlides: number[] = [];
  let predicted = 0;
  plan.slides.forEach((s, i) => {
    // The moving stretch that starts nearest its moment (the slide before is still for a while before it moves on):
    // a transition moves for a few frames at least, a cut for one. Two slides alike look alike all through a fade,
    // their words aside, so no stretch need be big.
    const least = Math.min(3, Math.max(1, Math.floor(s.transitionMs / frameMs)));
    let found: MotionRun | null = null;
    for (const r of runs) {
      const off = Math.abs(r.startMs - frameMs - predicted);
      if (r.frames < least || off > SLIDE_WINDOW_MS) continue;
      if (!found || off < Math.abs(found.startMs - frameMs - predicted)) found = r;
    }
    // The frame before its first change is the transition's first.
    const start = found ? Math.max(0, found.startMs - frameMs) : predicted;
    if (!found && s.transitionMs > 0 && i > 0) lostSlides.push(i);
    starts.push(start);
    predicted = start + s.transitionMs + plan.settleMs + s.advanceMs;
  });
  const offsets: Offset[] = [];
  let worst: CutPlan['worst'] = null;
  const slides = plan.slides.map((s, i): SlideCut => {
    const start = starts[i] ?? 0;
    const timeline = start + s.transitionMs + plan.settleMs;
    const next = i + 1 < starts.length ? (starts[i + 1] ?? end) : end;
    // Where each step's clip starts.
    const from: number[] = s.steps.map((step, k) => {
      if (k === 0) return start;
      const planned = timeline + step.startMs;
      const before = s.steps[k - 1];
      if (step.still) {
        // Nothing moves (it only starts a video or sound): just after the step before has finished.
        offsets.push({ slide: i, step: k, offsetMs: null });
        return Math.max(planned - LEAD_MS, timeline + (before?.endMs ?? 0) + 2 * frameMs);
      }
      // Something turning for ever hides when a step starts: its plan, as it is.
      if (before?.holdMs) {
        offsets.push({ slide: i, step: k, offsetMs: null });
        return planned - LEAD_MS;
      }
      const seen = motion.frames.find(
        (f) =>
          f.t - frameMs >= planned - STEP_BEFORE_MS &&
          f.t - frameMs <= planned + STEP_AFTER_MS &&
          moving(f) &&
          // Not one frame's flicker: the next moves too, or it is a big change.
          (f.max > 4 * MOVING_MAX ||
            motion.frames.some((g) => g.t > f.t && g.t <= f.t + 1.5 * frameMs && moving(g))),
      );
      if (!seen) {
        offsets.push({ slide: i, step: k, offsetMs: null });
        return planned - LEAD_MS;
      }
      const measured = seen.t - frameMs;
      const offsetMs = Math.round(measured - planned);
      offsets.push({ slide: i, step: k, offsetMs });
      if (!worst || Math.abs(offsetMs) > Math.abs(worst.offsetMs)) worst = { slide: i, step: k, offsetMs };
      // A slow start (a fade's first faint frames) is not seen at once: the earlier of the two.
      return Math.min(planned, measured) - LEAD_MS;
    });
    const steps = s.steps.map((step, k): StepCut => {
      const fromMs = Math.max(0, from[k] ?? start);
      const nextFrom = k + 1 < from.length ? (from[k + 1] ?? next) : next - frameMs;
      if (step.holdMs) {
        // Its own effects done, one turn of what keeps turning, from just after them.
        const toMs = Math.min(nextFrom, timeline + step.endMs + HOLD_SETTLE_MS);
        const holdTo = Math.min(nextFrom, toMs + step.holdMs);
        return {
          fromMs,
          toMs: Math.max(fromMs + frameMs, toMs),
          hold: holdTo - toMs >= frameMs ? { fromMs: toMs, toMs: holdTo } : null,
          transitionMs: k === 0 ? s.transitionMs : 0,
        };
      }
      return {
        fromMs,
        toMs: Math.max(fromMs + frameMs, nextFrom),
        hold: null,
        transitionMs: k === 0 ? s.transitionMs : 0,
      };
    });
    return { index: s.index, steps };
  });
  return { slides, offsets, lostSlides, worst };
}

// ---- cutting -------------------------------------------------------------------------------------------

/** The files one step was cut into. */
export interface CutFiles {
  clip: string;
  clipMs: number;
  last: string;
  hold: { file: string; ms: number } | null;
}

const seconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);

/** A stretch of the movie as an MP4 of its own: H.264, no sound, starting on a key frame. */
async function cutStretch(
  ffmpeg: string,
  movie: string,
  fromMs: number,
  toMs: number,
  out: string,
  signal?: AbortSignal,
): Promise<void> {
  const r = await runFfmpeg(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-protocol_whitelist',
      'file',
      '-ss',
      seconds(fromMs),
      '-i',
      movie,
      '-t',
      seconds(toMs - fromMs),
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out,
    ],
    { signal },
  );
  if (r.stopped) throw new Error('stopped');
  if (r.code !== 0)
    throw new Error(`FFmpeg could not cut the movie: ${r.stderr.trim().split('\n').pop() ?? ''}`);
}

/** A clip's very last frame, as a PNG. */
async function lastFrame(ffmpeg: string, clip: string, out: string, signal?: AbortSignal): Promise<void> {
  const r = await runFfmpeg(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.5', '-i', clip, '-update', '1', out],
    { signal },
  );
  if (r.stopped) throw new Error('stopped');
  if (r.code !== 0) throw new Error('FFmpeg could not keep a clip’s last frame');
}

/**
 * Cut every step of every slide into `dir`: `s<slide>-<step>.mp4`, its last frame `…-last.png`, and its hold
 * `…-hold.mp4`. `progress` is told each step done.
 */
export async function cutMovie(
  ffmpeg: string,
  movie: string,
  cuts: CutPlan,
  dir: string,
  options: { signal?: AbortSignal; progress?: (done: number, total: number) => void } = {},
): Promise<CutFiles[][]> {
  await mkdir(dir, { recursive: true });
  const total = cuts.slides.reduce((n, s) => n + s.steps.length, 0);
  let done = 0;
  const out: CutFiles[][] = [];
  for (const slide of cuts.slides) {
    const files: CutFiles[] = [];
    for (const [k, step] of slide.steps.entries()) {
      const name = `s${String(slide.index + 1).padStart(3, '0')}-${String(k)}`;
      const clip = join(dir, `${name}.mp4`);
      const last = join(dir, `${name}-last.png`);
      await cutStretch(ffmpeg, movie, step.fromMs, step.toMs, clip, options.signal);
      await lastFrame(ffmpeg, clip, last, options.signal);
      let hold: CutFiles['hold'] = null;
      if (step.hold) {
        const file = join(dir, `${name}-hold.mp4`);
        await cutStretch(ffmpeg, movie, step.hold.fromMs, step.hold.toMs, file, options.signal);
        hold = { file, ms: Math.round(step.hold.toMs - step.hold.fromMs) };
      }
      files.push({ clip, clipMs: Math.round(step.toMs - step.fromMs), last, hold });
      options.progress?.(++done, total);
    }
    out.push(files);
  }
  return out;
}
