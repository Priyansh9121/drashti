import type { AfterStart } from './go-moment';

/*
 * The operator's LIVE preview (QA23-CUELIVE-1): which of this page's cued pictures have set their rate at Go, so the
 * page's own React work for the moment (render/go-moment.ts) runs after it, never ahead of it. Told by the cued
 * picture's element itself (its rate going above 0 while it plays: render/BackgroundMedia.tsx), so a picture's start
 * is never delayed to tell it.
 */

const started = new Set<string>();
const waiting = new Map<string, Set<() => void>>();

/** This page's cued picture `cueId` has started at Go. */
export function cueStarted(cueId: string): void {
  started.add(cueId);
  const runs = waiting.get(cueId);
  waiting.delete(cueId);
  for (const run of runs ?? []) run();
}

/** Run `run` once this page's cued picture `cueId` has started (at once if it has); returns its cancel. */
export function whenCueStarted(cueId: string, run: () => void): () => void {
  if (started.has(cueId)) {
    run();
    return () => undefined;
  }
  const runs = waiting.get(cueId) ?? new Set<() => void>();
  runs.add(run);
  waiting.set(cueId, runs);
  return () => {
    runs.delete(run);
    if (runs.size === 0 && waiting.get(cueId) === runs) waiting.delete(cueId);
  };
}

/** How long the operator preview's work waits for a cued picture that never starts (it failed): one playback check. */
const NEVER_STARTED_MS = 250;

/** The operator preview's wait for its cued picture `cueId` (render/go-moment.ts). */
export const afterCueStart = (cueId: string): AfterStart => ({
  whenStarted: (run) => whenCueStarted(cueId, run),
  fallbackMs: NEVER_STARTED_MS,
});
