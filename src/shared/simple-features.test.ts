import { describe, expect, it } from 'vitest';
import {
  chooseSimpleFeature,
  isSimpleFeature,
  readSimpleFeatures,
  SIMPLE_FEATURES,
  SIMPLE_FEATURES_FULL,
  SIMPLE_FEATURES_MAX,
} from './simple-features';

/*
 * Edit › Simple Mode Features… (alpha.22; the owner, 24 Nov 2026: "the features can be brought to simple mode, only
 * 1-2 and max 3. so that the meaning of simple mode doesnt go away"): up to three of Pro Mode's tools under LIVE,
 * each an on/off switch, none to begin with.
 */
describe('Simple Mode Features (alpha.22)', () => {
  it('offers the tools under Pro Mode’s LIVE that run the show and Simple Mode lacks, in the column’s order, each with its section’s name', () => {
    expect(SIMPLE_FEATURES.map((f) => f.id)).toEqual([
      'stage',
      'messages',
      'timers',
      'lower-thirds',
      'show-a-window',
      'show-a-stream-link',
      'video-inputs',
      'picture-in-picture',
    ]);
    expect(SIMPLE_FEATURES.map((f) => f.name)).toEqual([
      'Stage screen',
      'Messages',
      'Timers',
      'Lower Thirds',
      'Show a Window',
      'Show a Stream Link',
      'Video inputs',
      'Picture in Picture',
    ]);
    // Each says in a line what Simple Mode can do with it; setting up stays Pro Mode's.
    for (const f of SIMPLE_FEATURES) expect(f.line.length, f.id).toBeGreaterThan(20);
    // Not setup or admin tools, and not what Simple Mode has already.
    for (const id of ['midi', 'osc', 'qr-code', 'audio', 'stream', 'screens'])
      expect(isSimpleFeature(id), id).toBe(false);
  });

  it('none to begin with; what was saved is read back in the column’s order, anything unknown or doubled left out, never more than three', () => {
    expect(SIMPLE_FEATURES_MAX).toBe(3);
    expect(readSimpleFeatures(undefined)).toEqual([]);
    expect(readSimpleFeatures(null)).toEqual([]);
    expect(readSimpleFeatures('messages')).toEqual([]);
    expect(readSimpleFeatures(['picture-in-picture', 'messages'])).toEqual([
      'messages',
      'picture-in-picture',
    ]);
    expect(readSimpleFeatures(['messages', 'messages', 'midi', 7, null])).toEqual(['messages']);
    // A file changed by hand with four: the first three in the column's order.
    expect(readSimpleFeatures(['timers', 'stage', 'messages', 'lower-thirds'])).toEqual([
      'stage',
      'messages',
      'timers',
    ]);
  });

  it('turns one on or off; a fourth is refused, saying why, until one is turned off', () => {
    const one = chooseSimpleFeature([], 'messages', true);
    expect(one).toEqual({ ok: true, chosen: ['messages'] });
    const two = chooseSimpleFeature(['messages'], 'stage', true);
    expect(two).toEqual({ ok: true, chosen: ['stage', 'messages'] });
    const three = chooseSimpleFeature(['stage', 'messages'], 'picture-in-picture', true);
    expect(three).toEqual({ ok: true, chosen: ['stage', 'messages', 'picture-in-picture'] });
    expect(chooseSimpleFeature(['stage', 'messages', 'picture-in-picture'], 'timers', true)).toEqual({
      ok: false,
      message: SIMPLE_FEATURES_FULL,
    });
    expect(SIMPLE_FEATURES_FULL).toBe('Up to 3: turn one off first.');
    // One already on stays on (nothing counted twice), with three too.
    expect(chooseSimpleFeature(['stage', 'messages', 'picture-in-picture'], 'messages', true)).toEqual({
      ok: true,
      chosen: ['stage', 'messages', 'picture-in-picture'],
    });
    // Off: gone, and then another can come on.
    const off = chooseSimpleFeature(['stage', 'messages', 'picture-in-picture'], 'messages', false);
    expect(off).toEqual({ ok: true, chosen: ['stage', 'picture-in-picture'] });
    expect(chooseSimpleFeature(['stage', 'picture-in-picture'], 'timers', true)).toEqual({
      ok: true,
      chosen: ['stage', 'timers', 'picture-in-picture'],
    });
    expect(chooseSimpleFeature([], 'messages', false)).toEqual({ ok: true, chosen: [] });
  });

  it('refuses what is not one of them, or not on or off', () => {
    for (const [feature, on] of [
      ['midi', true],
      ['', true],
      [null, true],
      ['messages', 'yes'],
      ['messages', undefined],
    ] as const) {
      const result = chooseSimpleFeature([], feature, on);
      expect(result.ok, String(feature)).toBe(false);
    }
  });
});
