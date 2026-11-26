import { describe, expect, it } from 'vitest';
import { emptyLayers } from '../../../shared/engine/state';
import { KEYMAP, shortcutText } from '../../../shared/keymap';
import { clearLook, clearTrace, LAYER_CLEARS, TRACE_TIMING, traceFrames } from './layer-clears';

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
 * before the show's state is known). Its place along the bar is kept either way (LayerBar.tsx), so no button beside it
 * moves. As it lights up or goes out a trace beside it grows or shrinks once, transform and opacity only, over a
 * token of the motion table between 120 and 250 ms; never as the window opens, from the first state the window hears,
 * or with interface motion Off or the computer set to reduce motion. The clear itself changes at once (Session 25).
 */

/** The motion table's times (app.css; src/main/motion.test.ts holds each token to its value). */
const TABLE_MS: Readonly<Record<string, number>> = { 'dur-move': 180, 'dur-exit': 150 };
const tokenMs = (name: string): number => TABLE_MS[name] ?? Number.NaN;
const CAN = { moves: true, opened: true } as const;

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

describe('a clear’s trace as it lights up or goes out', () => {
  it('grows as it lights up and shrinks as it goes out', () => {
    expect(clearTrace('compact', 'lit', CAN)).toBe('grow');
    expect(clearTrace('lit', 'compact', CAN)).toBe('shrink');
  });

  it('plays nothing when nothing changed, from the first state the window hears, as the window opens, or with motion off', () => {
    expect(clearTrace('lit', 'lit', CAN)).toBeNull();
    expect(clearTrace('compact', 'compact', CAN)).toBeNull();
    expect(clearTrace(null, 'lit', CAN)).toBeNull();
    expect(clearTrace('compact', 'lit', { moves: true, opened: false })).toBeNull();
    expect(clearTrace('compact', 'lit', { moves: false, opened: true })).toBeNull();
    expect(clearTrace('lit', 'compact', { moves: false, opened: true })).toBeNull();
  });

  it('moves only transform and opacity, from the compact size to the lit one (or back), fading out', () => {
    const grow = traceFrames('grow', 0.4);
    const shrink = traceFrames('shrink', 0.4);
    for (const frames of [grow, shrink]) {
      expect(frames).toHaveLength(2);
      for (const frame of frames) expect(Object.keys(frame).sort()).toEqual(['opacity', 'transform']);
      expect(Number(frames[0]?.opacity)).toBeGreaterThan(0);
      expect(Number(frames[1]?.opacity)).toBe(0);
    }
    expect(grow.map((f) => f.transform)).toEqual(['scaleX(0.4)', 'scaleX(1)']);
    expect(shrink.map((f) => f.transform)).toEqual(['scaleX(1)', 'scaleX(0.4)']);
    // A room narrower than the compact button, or none measured, never scales past its size or to nothing.
    expect(traceFrames('grow', 2).map((f) => f.transform)).toEqual(['scaleX(1)', 'scaleX(1)']);
    expect(traceFrames('grow', Number.NaN).map((f) => f.transform)).toEqual(['scaleX(1)', 'scaleX(1)']);
  });

  it('takes a token of the motion table for its time and curve, quick: 120 to 250 ms', () => {
    for (const trace of ['grow', 'shrink'] as const) {
      const { time, curve } = TRACE_TIMING[trace];
      expect(time, trace).toMatch(/^dur-/u);
      expect(['ease-out', 'ease-in-out'], `${trace}'s curve`).toContain(curve);
      const ms = tokenMs(time);
      expect(ms, `${trace}: --${time}`).toBeGreaterThanOrEqual(120);
      expect(ms, `${trace}: --${time}`).toBeLessThanOrEqual(250);
    }
    // Going out is quicker than lighting up (the motion table: an exit about 70% of its entrance).
    expect(tokenMs(TRACE_TIMING.shrink.time)).toBeLessThan(tokenMs(TRACE_TIMING.grow.time));
  });
});
