import { describe, expect, it } from 'vitest';
import type { SimpleFeature } from '../shared/simple-features';
import { SIMPLE_FEATURES_FULL } from '../shared/simple-features';
import { SimpleFeaturesKeeper } from './simple-features';

/*
 * Edit › Simple Mode Features… (alpha.22): which of Pro Mode's tools Simple Mode has, kept with this computer's
 * library as Simple Mode itself is, read back as Drashti starts, and told to the window as it changes.
 */
function keeper(saved: unknown) {
  const kept: (readonly SimpleFeature[])[] = [];
  const told: (readonly SimpleFeature[])[] = [];
  const lines: string[] = [];
  const k = new SimpleFeaturesKeeper({
    saved,
    save: (chosen) => kept.push(chosen),
    changed: (chosen) => told.push(chosen),
    log: (line) => lines.push(line),
  });
  return { k, kept, told, lines };
}

describe('SimpleFeaturesKeeper (alpha.22)', () => {
  it('starts with none; with what was saved, read as the rule reads it', () => {
    expect(keeper(undefined).k.chosen()).toEqual([]);
    expect(keeper(['picture-in-picture', 'messages', 'midi']).k.chosen()).toEqual([
      'messages',
      'picture-in-picture',
    ]);
  });

  it('keeps each change, tells the window, and logs it; a refused one changes nothing', () => {
    const { k, kept, told, lines } = keeper(['stage', 'messages']);
    expect(k.set('timers', true)).toEqual({ ok: true, chosen: ['stage', 'messages', 'timers'] });
    expect(kept).toEqual([['stage', 'messages', 'timers']]);
    expect(told).toEqual([['stage', 'messages', 'timers']]);
    expect(lines.at(-1)).toBe('Simple Mode Features: Timers on (now Stage screen, Messages, Timers)');
    expect(k.set('lower-thirds', true)).toEqual({ ok: false, message: SIMPLE_FEATURES_FULL });
    expect(k.set('midi', true).ok).toBe(false);
    expect(kept).toHaveLength(1);
    expect(told).toHaveLength(1);
    expect(k.set('messages', false)).toEqual({ ok: true, chosen: ['stage', 'timers'] });
    expect(lines.at(-1)).toBe('Simple Mode Features: Messages off (now Stage screen, Timers)');
    expect(k.chosen()).toEqual(['stage', 'timers']);
  });

  it('nothing kept or told when it is already as asked', () => {
    const { k, kept, told } = keeper(['messages']);
    expect(k.set('messages', true)).toEqual({ ok: true, chosen: ['messages'] });
    expect(k.set('timers', false)).toEqual({ ok: true, chosen: ['messages'] });
    expect(kept).toEqual([]);
    expect(told).toEqual([]);
  });
});
