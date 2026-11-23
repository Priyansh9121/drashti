import type { FrameGrid } from '../../../shared/video-cue';
import { engineNow } from '../render/clock';

/**
 * How often the stream's page tells Main its frame grid while a cue waits (ms): a Go is placed from the newest grid,
 * about 150 ms ahead, so at most about 12 frames on from the frame it was fitted at.
 */
const TELL_MS = 250;
/** How many of its last frames the grid is fitted over (two seconds at 30 a second). */
const FRAMES = 60;
/** The fewest frames a grid is fitted from. */
const FEWEST = 8;

/** The usual spacing of frames begun at these times (ms): their middle gap, so a frame it missed does not count. */
export function frameSpacing(begins: readonly number[]): number | null {
  const gaps = begins
    .slice(1)
    .map((t, i) => t - (begins[i] ?? t))
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  if (gaps.length < 4) return null;
  return gaps[Math.floor(gaps.length / 2)] ?? null;
}

/**
 * The grid of frames begun at these times: their spacing and the newest frame's place on it, fitted by least squares
 * over all of them (a missed frame counted as missed), so its spacing is their average, not one whole-millisecond gap
 * (a22-cue: CI's off-screen frames come 33.3-34.2 ms apart on average). Null from fewer than 8 frames.
 */
export function fitGrid(begins: readonly number[]): FrameGrid | null {
  if (begins.length < FEWEST) return null;
  const rough = frameSpacing(begins);
  const last = begins.at(-1);
  if (rough === null || last === undefined) return null;
  // Each frame's number counted back from the newest (0), a missed frame leaving its number unused.
  const n = begins.map((t) => Math.round((t - last) / rough));
  const count = begins.length;
  const meanN = n.reduce((a, b) => a + b, 0) / count;
  const meanT = begins.reduce((a, b) => a + b, 0) / count;
  let across = 0;
  let spread = 0;
  for (let i = 0; i < count; i++) {
    const dn = (n[i] ?? 0) - meanN;
    across += dn * ((begins[i] ?? 0) - meanT);
    spread += dn * dn;
  }
  if (!(spread > 0)) return null;
  const periodMs = across / spread;
  return { at: meanT - meanN * periodMs, periodMs };
}

/**
 * The stream's page (S5, a21-s5): while a cue waits, it tells Main when its frames begin (each animation frame's own
 * begin time, which is the off-screen frame's, on the engine's clock) and how far apart they are, fitted over its last
 * two seconds and told four times a second (a22-cue), so a manual Go can be placed on them (shared/video-cue.ts
 * goOnStreamFrame). Returns its stop.
 */
export function watchFrameGrid(tell: (grid: FrameGrid) => void): () => void {
  const begins: number[] = [];
  let told = Number.NEGATIVE_INFINITY;
  let frame = 0;
  const tick = (began: DOMHighResTimeStamp) => {
    // eslint-disable-next-line no-restricted-properties -- a length of time: how long ago this frame began, to put its begin on the engine's clock
    const at = engineNow() - Math.max(0, performance.now() - began);
    begins.push(at);
    if (begins.length > FRAMES) begins.shift();
    if (at - told >= TELL_MS) {
      const grid = fitGrid(begins);
      if (grid) {
        told = at;
        tell(grid);
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
