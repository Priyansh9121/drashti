/*
 * Drashti's start in the operator window with the opening over it (Session 57, item 6: the opening starts on time and
 * runs its exact two seconds, smoothly, on Mac and Windows; the window under it is usable no later than before): what
 * may happen when, decided here from what the window knows, so a unit test can hold the order (OpeningAtStart.tsx
 * follows it).
 *
 * The window underneath starts as soon as the opening's black covers it, never later: its controls, its first data
 * and its first drawing are the heaviest work of the start (on CI's Mac they took the main thread for a second at a
 * time). The opening holds, black, until that is done (the window has opened), and until the hall's screens have
 * drawn, as before. The window can still miss frames after it reports that it opened. Give it a short frame interval
 * before the animation so the first visible frame starts near the start of the timeline.
 *
 * And until the window's own GPU warm-up is over (Session 58, C4: Q57-32): its LIVE picture draws every kind of the
 * show's drawing, unseen, as it starts (render/WarmUp.tsx), so the GPU makes each "pipeline" before the show needs it,
 * and while the GPU makes one every window waits (100-600 ms each on CI's Mac, some twenty after the window had opened:
 * the opening's first move came 0.3-3 s late and it lost that much of its two seconds; on this Mac a few ms each, and
 * on a computer without a graphics chip none). Its two seconds then never share the GPU with it.
 *
 * Its two waits have their own limits: the screens' OPENING_HOLD_MS, then it plays still (it never moves beside their
 * warm-up); the window's OPENING_START_HOLD_MS (longer: the window's warm-up is over by its own limit before then),
 * then it moves as it would.
 */

/** What the operator window knows as Drashti starts. */
export interface StartFacts {
  /** The main process's answer: not yet, no opening, or it plays. */
  plan: 'asking' | 'none' | 'plays';
  /** The opening's black has drawn its first frame over the window. */
  covered: boolean;
  /** The hall's screens are still getting ready (the plan's hold, until they have all drawn). */
  screensWarming: boolean;
  /** The window underneath has opened: its controls drawn with their first data, the page then idle (ui/motion.ts). */
  windowOpened: boolean;
  /** The renderer has drawn frames in a row without a long gap after opening, its own GPU warm-up over, fonts idle. */
  windowFrameReady: boolean;
  /** The window's own GPU warm-up (its LIVE picture's, render/WarmUp.tsx) is still drawing. */
  windowWarming: boolean;
  /** It has held for OPENING_HOLD_MS: the screens' limit. */
  waitedOut: boolean;
  /** It has held for OPENING_START_HOLD_MS: the window's limit. */
  startWaitedOut: boolean;
  /** It ended: a key, a click, or by itself. */
  ended: boolean;
}

/**
 * Whether the opening holds, black, nothing moving: until the hall's screens have drawn (OPENING_HOLD_MS at most), and
 * until the window underneath has opened, its own GPU warm-up is over and its frames come on time (OPENING_START_HOLD_MS
 * at most).
 */
export function openingHolds(f: StartFacts): boolean {
  if (f.plan !== 'plays' || f.ended) return false;
  const screens = f.screensWarming && !f.waitedOut;
  const starting = !f.startWaitedOut && (!f.windowOpened || f.windowWarming || !f.windowFrameReady);
  return screens || starting;
}

/** What let it go, for its figures: everything it waits for ready, or a limit with something still not. */
export function releasedBy(f: StartFacts): 'ready' | 'limit' {
  return f.screensWarming || !f.windowOpened || f.windowWarming || !f.windowFrameReady ? 'limit' : 'ready';
}

/** Whether the window underneath may start (the App mounts): at once with no opening, else once its black covers it. */
export function windowMayStart(f: StartFacts): boolean {
  return f.plan === 'none' || f.ended || (f.plan === 'plays' && f.covered);
}

/** Whether it plays still once it moves: the hall's screens had not drawn within OPENING_HOLD_MS. */
export function stillAfterHold(f: Pick<StartFacts, 'waitedOut' | 'screensWarming'>): boolean {
  return f.waitedOut && f.screensWarming;
}

/**
 * How long waiting for its photo may still hold the opening up before the lamp lights in its place (ms, from now), or
 * null for no limit yet: while something else holds it, the photo holds nothing up, and the window starting underneath
 * can keep the page busy for longer than the limit (CI's Mac, Session 57).
 */
export function photoWait(held: boolean, limitMs: number): number | null {
  return held ? null : limitMs;
}

/** Start the app underneath the opening once the black cover can draw. */
export function afterCoverFrame(covered: () => void): () => void {
  let waiting = true;
  const cancel = () => {
    waiting = false;
    cancelAnimationFrame(frame);
    clearTimeout(limit);
  };
  const ready = () => {
    if (!waiting) return;
    cancel();
    covered();
  };
  const frame = requestAnimationFrame(ready);
  // A minimized or covered window can stop getting frames. The black cover is already mounted.
  const limit = setTimeout(ready, 100);
  return cancel;
}
