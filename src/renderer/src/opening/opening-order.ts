/*
 * Drashti's start in the operator window with the opening over it (Session 57, item 6: the opening starts on time and
 * runs its exact two seconds, smoothly, on Mac and Windows; the window under it is usable no later than before): what
 * may happen when, decided here from what the window knows, so a unit test can hold the order (OpeningAtStart.tsx
 * follows it).
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
  /** It has held for OPENING_HOLD_MS. */
  waitedOut: boolean;
  /** It ended: a key, a click, or by itself. */
  ended: boolean;
}

/** Whether the opening holds, black, nothing moving: never beside the hall's screens' warm-up, for OPENING_HOLD_MS at most. */
export function openingHolds(f: StartFacts): boolean {
  return f.plan === 'plays' && !f.ended && !f.waitedOut && f.screensWarming;
}

/** Whether the window underneath may start (the App mounts): during the opening's black hold, once it covers the window. */
export function windowMayStart(f: StartFacts): boolean {
  return f.plan === 'none' || f.ended || (f.plan === 'plays' && f.covered && openingHolds(f));
}

/** Whether it plays still once it moves: the hall's screens had not drawn within OPENING_HOLD_MS. */
export function stillAfterHold(f: StartFacts): boolean {
  return f.waitedOut && f.screensWarming;
}
