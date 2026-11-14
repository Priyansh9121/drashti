import type { OpeningFigures } from '../../../shared/opening';

/*
 * The opening's own figures as Drashti starts (Session 58, C4: Q57-32, the Mac's full two seconds, measured on the
 * owner's Mac as well as on CI): how long it held its black and what let it go, how soon after that the operator
 * window first drew it moving, how long it then ran and its longest frame. They are read as the Performance check's
 * motion probe reads the opening (render/motion-probe.ts): at every frame the window draws, from when it might move
 * until its two seconds are over. Main writes them in the log as it ends, so any start can be read afterwards.
 */

/** A frame the window drew while the opening might move: when it began, and how far into its two seconds it was. */
export interface OpeningFrame {
  /** When the frame began (requestAnimationFrame's time, ms on the page's clock). */
  at: number;
  /** How far into its two seconds the opening was at that frame (ms); null before it has started. */
  progress: number | null;
}

/** Ms, whole, for the log. */
const whole = (ms: number): number => Math.round(ms);

/**
 * The figures from its frames: `askedAt` when the main process said it plays, `releasedAt` when it might move (both on
 * the page's clock), `releasedBy` what let it go, `end` its whole length (ms). A frame moves once its progress is past
 * nothing; the run is over at the first frame at its end, and it ran from its first moving frame to that one and that
 * frame's own time (the frames' middle gap), as the Performance check counts a length (shared/motion-measure.ts). What
 * it never got to (a key ended it first) is null.
 */
export function openingFigures(
  frames: readonly OpeningFrame[],
  p: { askedAt: number; releasedAt: number; releasedBy: OpeningFigures['releasedBy']; end: number },
): OpeningFigures {
  const first = frames.findIndex((f) => f.progress !== null && f.progress > 0);
  const firstFrame = first < 0 ? undefined : frames[first];
  const last =
    first < 0 ? -1 : frames.findIndex((f, i) => i >= first && f.progress !== null && f.progress >= p.end);
  const lastFrame = last < 0 ? undefined : frames[last];
  const gaps: number[] = [];
  if (first >= 0)
    for (let i = first + 1; i <= (last < 0 ? frames.length - 1 : last); i++)
      gaps.push((frames[i]?.at ?? 0) - (frames[i - 1]?.at ?? 0));
  const sorted = [...gaps].sort((a, b) => a - b);
  const period = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    heldMs: whole(p.releasedAt - p.askedAt),
    releasedBy: p.releasedBy,
    movedAfterMs: firstFrame ? whole(Math.max(0, firstFrame.at - p.releasedAt)) : null,
    firstAtMs: firstFrame && firstFrame.progress !== null ? whole(firstFrame.progress) : null,
    ranMs: firstFrame && lastFrame ? whole(lastFrame.at - firstFrame.at + period) : null,
    longestFrameMs: sorted.length > 0 ? whole(sorted.at(-1) ?? 0) : null,
  };
}
