import type { FrameGrid } from '../../../shared/video-cue';
import { engineNow } from '../render/clock';

/** How often the stream's page tells Main its frame grid while a cue waits (ms). */
const TELL_MS = 1000;
/** How many of its last frames its spacing is read from. */
const FRAMES = 16;

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
 * The stream's page (S5, a21-s5): while a cue waits, it tells Main when its frames begin (each animation frame's own
 * begin time, which is the off-screen frame's, on the engine's clock) and how far apart they are, so a manual Go can
 * be placed on them (shared/video-cue.ts goOnStreamFrame). Returns its stop.
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
    const periodMs = frameSpacing(begins);
    if (periodMs !== null && at - told >= TELL_MS) {
      told = at;
      tell({ at, periodMs });
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
