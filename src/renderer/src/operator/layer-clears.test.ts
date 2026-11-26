import { describe, expect, it } from 'vitest';
import { emptyLayers } from '../../../shared/engine/state';
import { KEYMAP, shortcutText } from '../../../shared/keymap';
import { clearLook, LAYER_CLEARS } from './layer-clears';

/*
 * The layer bar's clears follow the keys (Session 51): left to right Slide F2, Background F3, Audio F5,
 * Messages F6 and Ticker F7, so the bar reads as the keyboard does (Session 55, Part 13: Props F4 and Masks F8
 * went with Props and Masks). Session 50 moved the keys to the ones the operators already press and had left the
 * buttons where they were (F6, F7 and F5 out of turn).
 */

const fNumber = (key: string): number => Number(/^F(\d+)$/u.exec(key)?.[1] ?? Number.NaN);

describe('the layer bar’s clears', () => {
  it('go left to right in the order of their keys, F2 to F7, F4 among none (Session 55)', () => {
    expect(LAYER_CLEARS.map((c) => `${c.label} ${shortcutText(c.action, 'darwin')}`)).toEqual([
      'Slide F2',
      'Background F3',
      'Audio F5',
      'Messages F6',
      'Ticker F7',
    ]);
  });

  it('keep to their keys’ order on both systems, each key an F key', () => {
    for (const platform of ['darwin', 'win32']) {
      const numbers = LAYER_CLEARS.map((c) => fNumber(shortcutText(c.action, platform)));
      expect(numbers.every((n) => Number.isInteger(n))).toBe(true);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    }
  });

  it('are every clear of one layer the keymap has, each once', () => {
    const ofOneLayer = KEYMAP.map((b) => b.action).filter((a) => a.startsWith('clear') && a !== 'clearAll');
    expect([...LAYER_CLEARS.map((c) => c.action)].sort()).toEqual([...ofOneLayer].sort());
    expect(new Set(LAYER_CLEARS.map((c) => c.layer)).size).toBe(LAYER_CLEARS.length);
  });
});

/*
 * What is up, at a glance (alpha.24, the owner's calmer window): a layer's clear is lit, its words and key with LIVE's
 * edge and dot, while its layer has something on the screens, and compact, its icon alone, while it has nothing (or
 * before the show's state is known). Its place along the bar is kept either way (LayerBar.tsx), so the clears never
 * move. It changes at once, in the same frame as the screens, and nothing moves with it (bottom-bar.spec.ts).
 */

describe('a layer’s clear, lit or compact', () => {
  it('is lit while its layer has something on the screens, compact while it has nothing', () => {
    const empty = emptyLayers();
    for (const { layer } of LAYER_CLEARS) expect(clearLook(empty, layer), layer).toBe('compact');
    expect(clearLook({ ...empty, slide: {} as never }, 'slide')).toBe('lit');
    expect(clearLook({ ...empty, background: {} as never }, 'background')).toBe('lit');
    expect(clearLook({ ...empty, audio: {} as never }, 'audio')).toBe('lit');
    expect(clearLook({ ...empty, messages: [{ id: 'm', text: 'Placeholder' }] }, 'messages')).toBe('lit');
    expect(clearLook({ ...empty, ticker: {} as never }, 'ticker')).toBe('lit');
    // Only its own layer lights it.
    expect(clearLook({ ...empty, slide: {} as never }, 'background')).toBe('compact');
  });

  it('is compact before the show’s state is known', () => {
    expect(clearLook(undefined, 'slide')).toBe('compact');
    expect(clearLook(null, 'ticker')).toBe('compact');
  });
});
