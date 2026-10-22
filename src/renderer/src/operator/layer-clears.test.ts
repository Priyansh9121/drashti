import { describe, expect, it } from 'vitest';
import { KEYMAP, shortcutText } from '../../../shared/keymap';
import { LAYER_CLEARS } from './layer-clears';

/*
 * The layer bar's clears follow the keys (Session 51): left to right Slide F2, Background F3, Props F4,
 * Audio F5, Messages F6, Ticker F7 and Masks F8, so the bar reads as the keyboard does. Session 50 moved
 * the keys to the ones the operators already press and had left the buttons where they were (F6, F7 and
 * F5 out of turn).
 */

const fNumber = (key: string): number => Number(/^F(\d+)$/u.exec(key)?.[1] ?? Number.NaN);

describe('the layer bar’s clears', () => {
  it('go left to right in the order of their keys, F2 to F8', () => {
    expect(LAYER_CLEARS.map((c) => `${c.label} ${shortcutText(c.action, 'darwin')}`)).toEqual([
      'Slide F2',
      'Background F3',
      'Props F4',
      'Audio F5',
      'Messages F6',
      'Ticker F7',
      'Masks F8',
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
