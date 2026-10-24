import { ENGINE_STATE_VERSION } from '../../../shared/engine/state';

/*
 * A phone's or tablet's page left open while Drashti was updated (Session 53). Its code reads one version of the
 * engine's state; after an update that changes it, every message is of a version it cannot read (the mirror says
 * 'incompatible' and leaves its copy as it was), so the page would say Connected over the old picture for good,
 * its Next naming the old run. Drashti serves its own pages (no-cache, their files named by their contents), so
 * loading the page again gets the new version's, which reads it; the pairing, kept in the browser's storage,
 * carries over. Never where the browser keeps nothing: the pairing is then this page's alone, and loading it again
 * would send the device back to pairing. At most once a minute, so it can never go round in a loop.
 */

/** The least time between two reloads for a new version. */
export const RELOAD_EVERY_MS = 60_000;

/**
 * Whether to load the page again now: the feed's engine message is of a version this page cannot read, the
 * pairing carries over, and the last such reload (`last`, or null) was a minute ago or more.
 */
export function shouldReload({
  version,
  pairingKept,
  now,
  last,
}: {
  version: unknown;
  pairingKept: boolean;
  now: number;
  last: number | null;
}): boolean {
  if (typeof version !== 'number' || version === ENGINE_STATE_VERSION || !pairingKept) return false;
  return last === null || now - last >= RELOAD_EVERY_MS;
}
