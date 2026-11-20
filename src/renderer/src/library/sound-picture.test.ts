import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_PLAYBACK_SETTINGS } from '../../../shared/playback-settings';
import { KEEP_AFTER_MS, playbackKeeper } from './sound-picture';

/*
 * Sound and picture…'s keeping (alpha.20, slice 6a; x55's find before its merge): a change is kept a moment after the
 * last one, and one made just before the window closes is kept at once as it closes, never dropped.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('keeping a file’s Sound and picture settings', () => {
  it('keeps the last of quick changes once, a moment after them', () => {
    const sent: unknown[] = [];
    const keeper = playbackKeeper(
      'v',
      (id, next) => {
        sent.push([id, next.bassDb]);
        return Promise.resolve({ ok: true as const });
      },
      () => undefined,
    );
    keeper.keep({ ...NO_PLAYBACK_SETTINGS, bassDb: 3 });
    keeper.keep({ ...NO_PLAYBACK_SETTINGS, bassDb: 6 });
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(KEEP_AFTER_MS);
    expect(sent).toEqual([['v', 6]]);
  });

  it('keeps a change made just before the window closes, at once as it closes', () => {
    const sent: unknown[] = [];
    const keeper = playbackKeeper(
      'v',
      (id, next) => {
        sent.push([id, next.trebleDb]);
        return Promise.resolve({ ok: true as const });
      },
      () => undefined,
    );
    keeper.keep({ ...NO_PLAYBACK_SETTINGS, trebleDb: -12 });
    keeper.close();
    expect(sent).toEqual([['v', -12]]);
    // And never twice.
    vi.advanceTimersByTime(KEEP_AFTER_MS * 2);
    expect(sent).toHaveLength(1);
    // Closed with nothing waiting: nothing sent.
    keeper.close();
    expect(sent).toHaveLength(1);
  });
});
