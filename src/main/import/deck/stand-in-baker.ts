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
 */

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 30;

/** A dark colour for a slide, so the marks read on it. */
function colourOf(i: number): [number, number, number] {
  const hue = (i * 67) % 360;
  const c = (n: number) => Math.round(70 + 55 * Math.cos(((hue + n) * Math.PI) / 180));
  return [c(0), c(120), c(240)];
}

function fill(frame: Buffer, x0: number, y0: number, w: number, h: number, rgb: readonly number[]): void {
  const x1 = Math.min(WIDTH, Math.max(0, Math.round(x0 + w)));
  const y1 = Math.min(HEIGHT, Math.max(0, Math.round(y0 + h)));
  const xs = Math.max(0, Math.round(x0));
  for (let y = Math.max(0, Math.round(y0)); y < y1; y++)
    for (let x = xs; x < x1; x++) {
      const at = (y * WIDTH + x) * 3;
      frame[at] = rgb[0] ?? 0;
      frame[at + 1] = rgb[1] ?? 0;
      frame[at + 2] = rgb[2] ?? 0;
    }
}

/** A slide as it looks at `ms` into its own timeline: its colour, its finished steps' marks, what moves now. */
function drawSlide(frame: Buffer, plan: MoviePlan, i: number, ms: number): void {
  const slide = plan.slides[i];
  if (!slide) return;
  fill(frame, 0, 0, WIDTH, HEIGHT, colourOf(i));
  let turning: { from: number; turn: number } | null = null;
  for (const [k, step] of slide.steps.entries()) {
    const length = step.endMs - step.startMs;
    if (ms >= step.endMs && (k > 0 || length > 0)) fill(frame, 12 + k * 22, 12, 16, 16, [255, 255, 255]);
    if (!step.still && length > 0 && ms >= step.startMs && ms < step.endMs) {
      const x = ((ms - step.startMs) / length) * (WIDTH - 40);
      fill(frame, x, HEIGHT / 2 - 20, 40, 40, [255, 255, 255]);
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
    fill(frame, WIDTH - 60 + 30 * Math.cos(a), HEIGHT - 60 + 30 * Math.sin(a), 10, 10, [255, 220, 0]);
  }
}

/** Make the stand-in movie of `plan` at `out` (MP4, 320 × 180, 30 frames a second). */
export async function standInMovie(
  ffmpeg: string,
  plan: MoviePlan,
  out: string,
  signal?: AbortSignal,
): Promise<void> {
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
      `${String(WIDTH)}x${String(HEIGHT)}`,
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
  try {
    const frame = Buffer.alloc(WIDTH * HEIGHT * 3);
    const before = Buffer.alloc(WIDTH * HEIGHT * 3);
    for (let n = 0; n < frames && !signal?.aborted; n++) {
      const t = (n * 1000) / FPS;
      let i = 0;
      while (i + 1 < starts.length && t >= (starts[i + 1] ?? Infinity)) i++;
      const slide = plan.slides[i];
      const start = starts[i] ?? 0;
      const transition = slide?.transitionMs ?? 0;
      const timeline = t - start - transition - plan.settleMs;
      drawSlide(frame, plan, i, Math.max(0, timeline));
      if (slide && t < start + transition) {
        // Its transition: the slide wipes in from the left over the last picture of the one before (or black).
        if (i > 0) drawSlide(before, plan, i - 1, Number.MAX_SAFE_INTEGER);
        else before.fill(0);
        const edge = Math.round(((t - start) / transition) * WIDTH);
        for (let y = 0; y < HEIGHT; y++) {
          const row = y * WIDTH * 3;
          before.copy(frame, row + edge * 3, row + edge * 3, row + WIDTH * 3);
        }
      }
      if (!child.stdin.write(frame)) await new Promise((resolve) => child.stdin.once('drain', resolve));
    }
    child.stdin.end();
    const code = await ended;
    if (signal?.aborted) throw new Error('stopped');
    if (code !== 0) throw new Error(`The stand-in could not make the movie: ${stderr.trim()}`);
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}
