import { describe, expect, it } from 'vitest';
import { blockAsItStands } from './live-stand';

/*
 * Whether the LIVE block stands still is judged by its height as it is while it stands (alpha.24, the uilook piece; CI's
 * Windows, 1024 × 645 with the live column at 380 px: small-window.spec.ts:46's Audio toggle never stood still). While
 * the whole column scrolls, a scrollbar that takes room narrows the block, and its picture (16:9) is shorter by as
 * much: judged by that, the block would stand, widen, grow, stop standing and narrow again, round and round. Made-up
 * sizes in CSS pixels.
 */

describe('blockAsItStands', () => {
  it('is the block’s own height while nothing narrows it (standing, or a scrollbar that takes no room)', () => {
    expect(blockAsItStands({ block: 380, scrollbar: 0, picture: { width: 348, height: 196 } })).toBe(380);
  });

  it('adds back what a scrollbar beside it took from its picture, at the picture’s own shape', () => {
    // An 11 px scrollbar: the 16:9 picture 337 wide is 6.2 px shorter than at 348, rounded up.
    expect(blockAsItStands({ block: 360, scrollbar: 11, picture: { width: 337, height: 190 } })).toBe(367);
    // A 4:3 picture: three quarters of the scrollbar's width.
    expect(blockAsItStands({ block: 300, scrollbar: 16, picture: { width: 240, height: 180 } })).toBe(312);
  });

  it('so the choice never flips: 504 px of column, 140 px wanted under the block', () => {
    const column = 504;
    const stands = (block: number) => column - block >= 140;
    // Standing, the block is 367 px: 137 px under it, too little, so the whole column scrolls.
    expect(stands(blockAsItStands({ block: 367, scrollbar: 0, picture: { width: 348, height: 196 } }))).toBe(
      false,
    );
    // Scrolling, a scrollbar makes it 360 px; judged as it would stand, it still does not stand.
    expect(stands(blockAsItStands({ block: 360, scrollbar: 11, picture: { width: 337, height: 190 } }))).toBe(
      false,
    );
  });

  it('takes no picture (none drawn yet) as nothing to add back', () => {
    expect(blockAsItStands({ block: 200, scrollbar: 11, picture: null })).toBe(200);
    expect(blockAsItStands({ block: 200, scrollbar: 11, picture: { width: 0, height: 0 } })).toBe(200);
  });
});

/*
 * The review of uilook 6e6d4fea2, SHOULD-2: the estimate mixes rounded heights and widths (the block's and the picture's
 * offsetHeight, the picture's offsetWidth), so where what the scrollbar takes is a few hundredths over a whole number
 * the ceil can come out 1 px under what standing gives back, and in that 1 px band of window heights the choice would
 * flip again. A sweep, a pixel at a time: pictures of every usual shape, widths a column gives, scrollbars that take
 * room, the block's other parts at fractional heights, laid out as Chromium rounds them.
 */
describe('blockAsItStands, swept a pixel at a time', () => {
  const round = (x: number) => Math.floor(x + 0.5);
  const SHAPES = [
    [1920, 1080],
    [1366, 768],
    [1280, 800],
    [1024, 768],
    [1280, 1024],
    [1000, 563],
  ] as const;

  it('never stands again from scrolling at a height where standing would not stand (the choice never flips)', () => {
    const flips: string[] = [];
    for (const [w, h] of SHAPES)
      for (let width = 300; width < 400; width += 0.5)
        for (const bar of [11, 15, 16, 17])
          for (let rest = 150; rest < 151; rest += 0.05) {
            // Standing: the block and its picture as laid out, no scrollbar beside them.
            const standing = round(rest + (width * h) / w);
            // Scrolling: the scrollbar narrows the picture, and the block is shorter by as much as it took.
            const narrow = width - bar;
            const block = round(rest + (narrow * h) / w);
            const judged = blockAsItStands({
              block,
              scrollbar: bar,
              picture: { width: round(narrow), height: round((narrow * h) / w) },
            });
            // Each column height, a pixel at a time, round where the two meet: standing says scroll, so scrolling
            // must say scroll too, or it would stand, not fit, and scroll again, round and round.
            for (let column = standing + 100; column < standing + 180; column++) {
              const standsNow = column - standing >= 140;
              const standsFromScrolling = column - judged >= 140;
              if (!standsNow && standsFromScrolling)
                flips.push(
                  `${String(w)}:${String(h)} ${String(width)} px, ${String(bar)} px bar, column ${String(column)}`,
                );
            }
          }
    expect(flips.slice(0, 5)).toEqual([]);
  });
});

