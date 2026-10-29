import { describe, expect, it } from 'vitest';
import { standardAsBoxes } from './stage-layouts';
import { STAGE_FLASH_MS, stageBanner, stageCallSchema, stageFlashOn, withRecent } from './stage-message';

/*
 * The stage message (Session 55, Part 15): the last few a tap away, each once and the newest first; its slow flash as
 * it comes up, in step on every stage screen; and a banner over every stage screen whose layout has no message box.
 */

describe('the stage message', () => {
  it('keeps the last five, each once, the newest first', () => {
    expect(withRecent(undefined, 'A')).toEqual(['A']);
    expect(withRecent(['A', 'B'], 'B')).toEqual(['B', 'A']);
    expect(withRecent(['1', '2', '3', '4', '5'], '6')).toEqual(['6', '1', '2', '3', '4']);
  });

  it('flashes for six seconds from the first whole second it was up, once a second, only when asked', () => {
    const shownAt = 10_250;
    const call = { size: 'standard' as const, flash: true, shownAt };
    expect(stageFlashOn({ ...call, flash: false }, 11_500)).toBe(false);
    expect(stageFlashOn(null, 11_500)).toBe(false);
    const on: boolean[] = [];
    for (let at = 11_000; at < 11_000 + STAGE_FLASH_MS + 2000; at += 1000)
      on.push(stageFlashOn(call, at + 500));
    expect(on).toEqual([true, false, true, false, true, false, false, false]);
  });

  it('shows as a banner over a stage screen whose layout has no message box', () => {
    expect(stageBanner(null)).toBe(true);
    expect(stageBanner({ boxes: [] })).toBe(true);
    let n = 0;
    expect(stageBanner({ boxes: standardAsBoxes(() => `b${String(n++)}`) })).toBe(false);
    expect(stageCallSchema.safeParse({ size: 'huge', flash: true }).success).toBe(true);
    expect(stageCallSchema.safeParse({ size: 'enormous' }).success).toBe(false);
  });
});
