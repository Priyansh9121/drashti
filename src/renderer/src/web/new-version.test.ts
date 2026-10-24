import { describe, expect, it } from 'vitest';
import { ENGINE_STATE_VERSION } from '../../../shared/engine/state';
import { RELOAD_EVERY_MS, shouldReload } from './new-version';

/*
 * A phone's or tablet's page left open while Drashti was updated to a version whose engine state it cannot read
 * (Session 53): it loads itself again, so it reads the new version's, at most once a minute, and only where its
 * pairing carries over. Made-up times only.
 */

const NOW = 1_800_000_000_000;
const other = ENGINE_STATE_VERSION + 1;

describe('a feed page after an update that changes the engine state’s version', () => {
  it('loads itself again for a version it cannot read, never for its own', () => {
    expect(shouldReload({ version: other, pairingKept: true, now: NOW, last: null })).toBe(true);
    // An older Drashti (put back after an update) is another version too.
    expect(shouldReload({ version: ENGINE_STATE_VERSION - 1, pairingKept: true, now: NOW, last: null })).toBe(
      true,
    );
    expect(shouldReload({ version: ENGINE_STATE_VERSION, pairingKept: true, now: NOW, last: null })).toBe(
      false,
    );
    // A message that names no version is not taken for a new one.
    expect(shouldReload({ version: undefined, pairingKept: true, now: NOW, last: null })).toBe(false);
    expect(shouldReload({ version: String(other), pairingKept: true, now: NOW, last: null })).toBe(false);
  });

  it('at most once a minute, so it can never go round in a loop', () => {
    const at = (msAgo: number) =>
      shouldReload({ version: other, pairingKept: true, now: NOW, last: NOW - msAgo });
    expect(at(1000)).toBe(false);
    expect(at(RELOAD_EVERY_MS - 1)).toBe(false);
    expect(at(RELOAD_EVERY_MS)).toBe(true);
    expect(at(10 * RELOAD_EVERY_MS)).toBe(true);
    expect(RELOAD_EVERY_MS).toBe(60_000);
  });

  it('never where its pairing would not carry over (the browser keeps nothing): it would have to pair again', () => {
    expect(shouldReload({ version: other, pairingKept: false, now: NOW, last: null })).toBe(false);
  });
});
