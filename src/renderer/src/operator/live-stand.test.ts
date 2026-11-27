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
