import { describe, expect, it } from 'vitest';
import { dipsAndOvershoots, frameLight, luminance, saturatedRed, swings } from './flash';

/* The design lab's flash check, ported (Session 27): the same maths on the same kind of series. */

describe('a frame’s light', () => {
  it('is WCAG’s relative luminance: white 1, black 0, pure red 0.2126, and a grey of the same light', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 0, 0)).toBeCloseTo(0.2126, 6);
    // The grey a strobe could swap with saturated red without the light changing.
    expect(Math.abs(luminance(127, 127, 127) - luminance(255, 0, 0))).toBeLessThan(0.002);
    expect(saturatedRed(255, 0, 0)).toBe(true);
    expect(saturatedRed(200, 30, 30)).toBe(false);
    expect(saturatedRed(20, 2, 2)).toBe(false);
  });

  it('is measured over the frame and each quarter, every second pixel, with the share of saturated red', () => {
    // 4 × 4: the left half white, the right half pure red.
    const rgba: number[] = [];
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) rgba.push(...(x < 2 ? [255, 255, 255, 255] : [255, 0, 0, 255]));
    const light = frameLight(rgba, 4, 4);
    expect(light.quad[0]).toBeCloseTo(1, 6);
    expect(light.quad[1]).toBeCloseTo(0.2126, 6);
    expect(light.quad[2]).toBeCloseTo(1, 6);
    expect(light.quad[3]).toBeCloseTo(0.2126, 6);
    expect(light.mean).toBeCloseTo((1 + 0.2126) / 2, 6);
    expect(light.red).toBe(0.5);
  });
});

describe('swings, as the lab counts them', () => {
  const ramp = (from: number, to: number, n: number) =>
    Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

  it('a dissolve from a dark slide to a bright one is one swing', () => {
    expect(swings(ramp(0.02, 0.9, 30), 60)).toEqual({ legs: 1, worst: 1 });
  });

  it('a fade through black between two bright slides is two (down, then up again)', () => {
    expect(swings([...ramp(0.9, 0, 10), ...ramp(0, 0.9, 10)], 60)).toEqual({ legs: 2, worst: 2 });
  });

  it('a strobe is many swings in one second; a wobble under 10% is none; bright-only swings do not count', () => {
    const strobe = Array.from({ length: 60 }, (_, i) => (Math.floor(i / 6) % 2 === 0 ? 0.02 : 0.9));
    expect(swings(strobe, 60).worst).toBeGreaterThan(3);
    expect(
      swings(
        Array.from({ length: 60 }, (_, i) => 0.4 + (i % 2) * 0.05),
        60,
      ).legs,
    ).toBe(0);
    expect(
      swings(
        Array.from({ length: 60 }, (_, i) => (Math.floor(i / 6) % 2 === 0 ? 0.85 : 0.99)),
        60,
      ).legs,
    ).toBe(0);
  });

  it('counts the most in any one second, by where each swing ends', () => {
    // Four swings, two in the first second and two more than a second later.
    const series = [
      ...ramp(0, 0.5, 5),
      ...ramp(0.5, 0, 5),
      ...Array<number>(70).fill(0),
      ...ramp(0, 0.5, 5),
      ...ramp(0.5, 0, 5),
    ];
    expect(swings(series, 60)).toEqual({ legs: 4, worst: 2 });
  });
});

describe('dips and overshoots', () => {
  it('a plain dissolve between the same light neither dips nor overshoots; a dimmed middle dips', () => {
    expect(dipsAndOvershoots([0.5, 0.5, 0.5, 0.5])).toEqual({ dips: false, overshoots: false });
    expect(dipsAndOvershoots([0.5, 0.4, 0.5])).toEqual({ dips: true, overshoots: false });
    expect(dipsAndOvershoots([0.2, 0.7, 0.6])).toEqual({ dips: false, overshoots: true });
  });
});
