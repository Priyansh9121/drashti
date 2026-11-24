/*
 * The stream page's own frames while Route C hears each sound, against captions-off windows (cap-realc; lead 2's
 * QR-1 A: worse only when every sound's window is worse than both controls, Q59-1).
 *
 * The owner, 24 Nov 2026 (QA23-REALC-2), word for word: "Mac: log frames only (Rec.)". On CI's Mac the verdict failed
 * once in 13 tries with single missed frames that also came with captions off, or on but idle (cap-realc.md). So in
 * this release the Mac's frames are worked out and recorded but never judged; Windows is judged as before. The Mac's
 * verdict returns in the next release with the stream-clock seam and more captions-off pairs.
 */

export interface FrameWindow {
  frames: number;
  period: number;
  p95: number;
  longest: number;
  over15: number;
}

/** A window of frames as the frame meters read them: the gaps' 95th percentile, the longest, those over 1.5 periods. */
export function meter(frames: readonly number[], from: number, to: number, period?: number): FrameWindow {
  const inside = frames.filter((t) => t >= from && t <= to);
  const gaps = inside.slice(1).map((t, i) => t - (inside[i] ?? t));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = period ?? sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    frames: inside.length,
    period: median,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    longest: sorted.at(-1) ?? 0,
    over15: gaps.filter((g) => g > median * 1.5).length,
  };
}

const worseThan = (t: FrameWindow, c: FrameWindow): boolean =>
  t.p95 - c.p95 > 1 || t.longest - c.longest > 1 || t.over15 > c.over15;

/**
 * Whether Route C's windows were worse (every one worse than every captions-off window), and whether that is judged
 * here: everywhere but the Mac (the owner's "Mac: log frames only").
 */
export function framesVerdict(
  platform: NodeJS.Platform,
  trials: readonly FrameWindow[],
  controls: readonly FrameWindow[],
): { judged: boolean; worse: boolean } {
  return {
    judged: platform !== 'darwin',
    worse: trials.every((t) => controls.every((c) => worseThan(t, c))),
  };
}
