import type { AfterStart } from './go-moment';

/*
 * The operator's LIVE preview (QA23-CUELIVE-1): which of this page's cued pictures have set their rate at Go, so the
 * page's own React work for the moment (render/go-moment.ts) runs after it, never ahead of it. Told by the cued
 * picture's element itself (its rate going above 0 while it plays: render/BackgroundMedia.tsx), so a picture's start
 * is never delayed to tell it.
 *
 * golive (alpha.24, joined run 2's Mac M6, video-cue-crossfade:306): released at LIVE's rate, the operator window's Go
 * work ran for about 100 ms right over LIVE's first moving frames, so no rendering step came until the third was shown
 * and LIVE's frames were shown at 33 ms steps. So two signs: 'rate' (its rate set at Go: LIVE's own picture's
 * activation, its opacity, as before) and 'shown' (its first moving frame presented on this page: the window's other Go
 * work, LIVE's scene keeper and the Screens previews). Both wait 250 ms past Go at the most, as before.
 */

/** What a wait for LIVE's cued picture waits for: its rate set at Go, or its first moving frame shown after that. */
export type CueStartSign = 'rate' | 'shown';

const signs: Record<CueStartSign, Set<string>> = { rate: new Set(), shown: new Set() };
/** Cues whose wait ended without their picture's start (it failed, say): let go of for good, whatever the clock. */
const gaveUp = new Set<string>();
const waiting: Record<CueStartSign, Map<string, Set<() => void>>> = { rate: new Map(), shown: new Map() };

/**
 * Whether a cued picture has started at Go, by its element: its rate above 0 while it plays (a prepared start's rate set
 * at Go; a start with no lead plays at its rate). Its rate 0 with play() (the Go lead's warm-up), or a rate while paused,
 * is not a start.
 */
export const startedNow = (v: { playbackRate: number; paused: boolean }): boolean =>
  v.playbackRate > 0 && !v.paused;

/** LIVE's wait for cue `cueId` ended without its picture's start: its scene is let go of, whatever the clock says. */
export function cueGaveUp(cueId: string): void {
  gaveUp.add(cueId);
}

/** Whether this page's cued picture `cueId` has started at Go. */
export const isCueStarted = (cueId: string): boolean => signs.rate.has(cueId);

function tell(sign: CueStartSign, cueId: string): void {
  signs[sign].add(cueId);
  const runs = waiting[sign].get(cueId);
  waiting[sign].delete(cueId);
  for (const run of runs ?? []) run();
}

/** This page's cued picture `cueId` has started at Go (its rate). */
export function cueStarted(cueId: string): void {
  tell('rate', cueId);
}

/** This page's cued picture `cueId` has shown its first moving frame after its start (a start shown is a start too). */
export function cueShown(cueId: string): void {
  tell('rate', cueId);
  tell('shown', cueId);
}

/** Run `run` once this page's cued picture `cueId` has given `sign` (at once if it has); returns its cancel. */
export function whenCueStarted(cueId: string, run: () => void, sign: CueStartSign = 'rate'): () => void {
  if (signs[sign].has(cueId)) {
    run();
    return () => undefined;
  }
  const runs = waiting[sign].get(cueId) ?? new Set<() => void>();
  runs.add(run);
  waiting[sign].set(cueId, runs);
  return () => {
    runs.delete(run);
    if (runs.size === 0 && waiting[sign].get(cueId) === runs) waiting[sign].delete(cueId);
  };
}

/**
 * How long the operator window's Go work waits for a cued picture that never starts (it failed) or never shows a moving
 * frame (one that holds still at Go, a page that draws nothing): one playback check.
 */
const NEVER_STARTED_MS = 250;

/**
 * The operator window's wait for its cued picture `cueId` (render/go-moment.ts): 'rate' for LIVE's own picture's
 * activation, 'shown' for the window's other Go work (LIVE's scene keeper, the Screens previews).
 */
export const afterCueStart = (cueId: string, sign: CueStartSign = 'rate'): AfterStart => ({
  whenStarted: (run) => whenCueStarted(cueId, run, sign),
  fallbackMs: NEVER_STARTED_MS,
  gaveUp: () => cueGaveUp(cueId),
});

/**
 * For LIVE's scene keeper (render/cued-start.ts): still held past Go `at` while its picture has not given `sign` ('shown'
 * for the keeper, golive), 250 ms at most; once its wait has given up (on the page's steady clock), never again,
 * whatever `now` (Date.now()) says.
 */
export const heldUntilStarted = (
  cueId: string,
  at: number,
  now: number,
  sign: CueStartSign = 'rate',
): boolean => !signs[sign].has(cueId) && !gaveUp.has(cueId) && now < at + NEVER_STARTED_MS;

/** LIVE's scene keeper's wait (render/useCuedStart.ts): past LIVE's first moving frame shown (golive). */
export const heldUntilShown = (cueId: string, at: number, now: number): boolean =>
  heldUntilStarted(cueId, at, now, 'shown');

/** A frame past where the picture was held by more than this (seconds) is a moving one. */
const MOVED_S = 0.001;

/** What the first moving frame's watch reads of LIVE's cued picture's element. */
export type MovingVideo = Pick<HTMLVideoElement, 'requestVideoFrameCallback' | 'cancelVideoFrameCallback'>;

/**
 * LIVE's cued picture, started (its rate): tell `shown` once, on the first frame presented past `from` (where it was
 * held, its trimmed frame); never for the held frame itself. Its stop.
 */
export function watchFirstMove(v: MovingVideo, from: number, shown: () => void): () => void {
  let done = false;
  let asked = 0;
  const look: VideoFrameRequestCallback = (_now, frame) => {
    if (done) return;
    if (frame.mediaTime > from + MOVED_S) {
      done = true;
      shown();
      return;
    }
    asked = v.requestVideoFrameCallback(look);
  };
  asked = v.requestVideoFrameCallback(look);
  return () => {
    done = true;
    v.cancelVideoFrameCallback(asked);
  };
}

/** What LIVE's teller reads of its cued picture's element. */
export type TellingVideo = MovingVideo &
  Pick<
    HTMLVideoElement,
    'playbackRate' | 'paused' | 'currentTime' | 'addEventListener' | 'removeEventListener'
  >;

/**
 * The operator's LIVE preview (render/BackgroundMedia.tsx, its cued picture's `tellStart`): tell this page when cue
 * `cueId`'s picture has started at Go (its rate above 0 while it plays), and then when its first moving frame is
 * presented past where it was held (golive). Its stop, for the effect's cleanup.
 */
export function tellCueStart(v: TellingVideo, cueId: string): () => void {
  let heldAt: number | null = null;
  let stopWatch: (() => void) | null = null;
  const told = () => {
    if (!startedNow(v)) {
      // Held (the Go lead's warm-up at rate 0): where its trimmed frame is.
      heldAt = v.currentTime;
      return;
    }
    cueStarted(cueId);
    stopWatch ??= watchFirstMove(v, heldAt ?? v.currentTime, () => {
      cueShown(cueId);
    });
  };
  v.addEventListener('ratechange', told);
  v.addEventListener('playing', told);
  return () => {
    v.removeEventListener('ratechange', told);
    v.removeEventListener('playing', told);
    stopWatch?.();
  };
}
