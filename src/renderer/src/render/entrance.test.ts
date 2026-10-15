import { describe, expect, it } from 'vitest';
import { entranceFrame, entranceLength } from './entrance';

/* A message banner's and the ticker band's entrance (Session 27, the design lab's). */

describe('an entrance', () => {
  it('Calm fades in in 250 ms, in place', () => {
    expect(entranceLength('calm')).toBe(250);
    expect(entranceFrame('banner', 'calm', 0)).toEqual({ opacity: 0, offset: 0 });
    expect(entranceFrame('band', 'calm', 125).offset).toBe(0);
    expect(entranceFrame('banner', 'calm', 250)).toEqual({ opacity: 1, offset: 0 });
  });

  it('Bold fades in over 300 ms rising from its edge: up from below, or down from above for a top banner', () => {
    expect(entranceLength('bold')).toBe(300);
    expect(entranceFrame('banner', 'bold', 0)).toEqual({ opacity: 0, offset: 16 });
    expect(entranceFrame('banner-top', 'bold', 0)).toEqual({ opacity: 0, offset: -16 });
    expect(entranceFrame('band', 'bold', 0)).toEqual({ opacity: 0, offset: 24 });
    const mid = entranceFrame('band', 'bold', 100);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.offset).toBeGreaterThan(0);
    expect(mid.offset).toBeLessThan(24);
    expect(entranceFrame('banner', 'bold', 300)).toEqual({ opacity: 1, offset: 0 });
  });
});
