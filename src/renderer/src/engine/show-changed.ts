/*
 * When the show last changed in this window (Session 40): the engine store notes each change it applies, and
 * Lively's motion (ui/motion.ts) starts nothing just after one. A module of its own, with nothing of the bridge,
 * so a page that only moves (the component gallery, a node's window) never takes the engine's part of it.
 */

let at = -Infinity;

/** A change of the show was applied in this window, now. */
export function noteShowChange(): void {
  at = performance.now();
}

/** How long ago the show last changed in this window, in ms (Infinity before any change). */
export function sinceShowChanged(): number {
  return performance.now() - at;
}
