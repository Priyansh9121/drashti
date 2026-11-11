import { spawn } from 'node:child_process';
import { ffmpegEnv } from '../../stream/worker/ffmpeg-env';
import type { MoviePlan } from './plan';
import { plannedLength, plannedStarts } from './plan';

/*
 * Tests only (Session 54, C2): a stand-in for PowerPoint's movie of a deck's timed copy, so a test on a computer
 * with neither PowerPoint nor Keynote (CI's) can import a deck "with its animations" and the cut, the steps and
 * the screens in step are tried for real. Turned on by DRASHTI_TEST_DECK_BAKER=1, which a packaged Drashti
 * ignores. It plays the plan exactly, as the timed copy would: each slide one colour, its transition a wipe in
 * from the left, each step's motion a white square crossing the picture, and each step done a mark that stays,
 * so every step ends on a picture of its own. Something that turns for ever turns as a dot going round.
 * 320 × 180 unless asked bigger (the timing check, Session 56: 1920 × 1080, as PowerPoint's own movie is).
 */

/** The movie's size: 320 × 180 unless asked for more lines (16:9). */
export interface StandInSize {
  width: number;
  height: number;
}
export const STAND_IN_SIZE: StandInSize = { width: 320, height: 180 };
/** 16:9 at `lines` lines (even, between 180 and 2160), or the usual size. */
export function standInSize(lines: number | null): StandInSize {
  if (lines === null || !Number.isFinite(lines)) return STAND_IN_SIZE;
  const height = Math.min(2160, Math.max(180, Math.round(lines / 2) * 2));
  return { width: Math.round((height * 16) / 9 / 2) * 2, height };
}
const FPS = 30;

/** A dark colour for a slide, so the marks read on it. */
function colourOf(i: number): [number, number, number] {
  const hue = (i * 67) % 360;
  const c = (n: number) => Math.round(70 + 55 * Math.cos(((hue + n) * Math.PI) / 180));
  return [c(0), c(120), c(240)];
}

function fill(
  frame: Buffer,
  size: StandInSize,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: readonly number[],
): void {
  const { width } = size;
  const x1 = Math.min(width, Math.max(0, Math.round(x0 + w)));
  const y1 = Math.min(size.height, Math.max(0, Math.round(y0 + h)));
  const xs = Math.max(0, Math.round(x0));
  const ys = Math.max(0, Math.round(y0));
  if (x1 <= xs || y1 <= ys) return;
  // One row painted, then copied to the rest.
  const first = (ys * width + xs) * 3;
  for (let x = xs; x < x1; x++) {
    const at = (ys * width + x) * 3;
    frame[at] = rgb[0] ?? 0;
    frame[at + 1] = rgb[1] ?? 0;
    frame[at + 2] = rgb[2] ?? 0;
  }
  for (let y = ys + 1; y < y1; y++) frame.copy(frame, (y * width + xs) * 3, first, first + (x1 - xs) * 3);
}

/** A slide as it looks at `ms` into its own timeline: its colour, its finished steps' marks, what moves now. */
function drawSlide(frame: Buffer, size: StandInSize, plan: MoviePlan, i: number, ms: number): void {
  const slide = plan.slides[i];
  if (!slide) return;
  // Drawn at 320 × 180 and scaled: the same picture at any size.
  const k = size.width / STAND_IN_SIZE.width;
  const box = (x: number, y: number, w: number, h: number, rgb: readonly number[]) => {
    fill(frame, size, x * k, y * k, w * k, h * k, rgb);
  };
  box(0, 0, STAND_IN_SIZE.width, STAND_IN_SIZE.height, colourOf(i));
  let turning: { from: number; turn: number } | null = null;
  for (const [k, step] of slide.steps.entries()) {
    const length = step.endMs - step.startMs;
    if (ms >= step.endMs && (k > 0 || length > 0)) box(12 + k * 22, 12, 16, 16, [255, 255, 255]);
    if (!step.still && length > 0 && ms >= step.startMs && ms < step.endMs) {
      const x = ((ms - step.startMs) / length) * (STAND_IN_SIZE.width - 40);
      box(x, STAND_IN_SIZE.height / 2 - 20, 40, 40, [255, 255, 255]);
    }
    if (step.holdMs && ms >= step.startMs && !turning) turning = { from: step.startMs, turn: step.holdMs };
  }
  // It turns until the last hold is cut (in whole turns), as the timed copy has it.
  const until = slide.endlessUntilMs;
  const stops =
    turning && until !== null
      ? turning.from + Math.ceil((until - turning.from) / turning.turn) * turning.turn
      : 0;
  if (turning && ms < stops) {
    const a = (((ms - turning.from) % turning.turn) / turning.turn) * 2 * Math.PI;
    box(
      STAND_IN_SIZE.width - 60 + 30 * Math.cos(a),
      STAND_IN_SIZE.height - 60 + 30 * Math.sin(a),
      10,
      10,
      [255, 220, 0],
    );
  }
}

/** Make the stand-in movie of `plan` at `out` (MP4, 320 × 180 unless `size` says, 30 frames a second). */
export async function standInMovie(
  ffmpeg: string,
  plan: MoviePlan,
  out: string,
  signal?: AbortSignal,
  size: StandInSize = STAND_IN_SIZE,
): Promise<void> {
  const { width, height } = size;
  const starts = plannedStarts(plan);
  const total = plannedLength(plan);
  const frames = Math.max(1, Math.ceil((total / 1000) * FPS));
  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${String(width)}x${String(height)}`,
      '-r',
      String(FPS),
      '-i',
      '-',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out,
    ],
    { windowsHide: true, env: ffmpegEnv(), stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  const ended = new Promise<number | null>((resolve) => {
    child.on('exit', resolve);
    child.on('error', () => {
      resolve(null);
    });
  });
  const stop = () => child.kill('SIGKILL');
  signal?.addEventListener('abort', stop);
  // An FFmpeg that never started, or stopped, takes no more frames: never wait on it.
  const ffmpegRun = { gone: false };
  void ended.then(() => {
    ffmpegRun.gone = true;
    child.stdin.destroy();
  });
  try {
    const frame = Buffer.alloc(width * height * 3);
    const before = Buffer.alloc(width * height * 3);
    for (let n = 0; n < frames && !signal?.aborted && !ffmpegRun.gone; n++) {
      const t = (n * 1000) / FPS;
      let i = 0;
      while (i + 1 < starts.length && t >= (starts[i + 1] ?? Infinity)) i++;
      const slide = plan.slides[i];
      const start = starts[i] ?? 0;
      const transition = slide?.transitionMs ?? 0;
      const timeline = t - start - transition - plan.settleMs;
      drawSlide(frame, size, plan, i, Math.max(0, timeline));
      if (slide && t < start + transition) {
        // Its transition: the slide wipes in from the left over the last picture of the one before (or black).
        if (i > 0) drawSlide(before, size, plan, i - 1, Number.MAX_SAFE_INTEGER);
        else before.fill(0);
        const edge = Math.round(((t - start) / transition) * width);
        for (let y = 0; y < height; y++) {
          const row = y * width * 3;
          before.copy(frame, row + edge * 3, row + edge * 3, row + width * 3);
        }
      }
      if (!child.stdin.write(frame))
        await new Promise<void>((resolve) => {
          child.stdin.once('drain', resolve);
          child.stdin.once('close', resolve);
        });
    }
    child.stdin.end();
    const code = await ended;
    if (signal?.aborted) throw new Error('stopped');
    if (code !== 0) throw new Error(`The stand-in could not make the movie: ${stderr.trim()}`);
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}
