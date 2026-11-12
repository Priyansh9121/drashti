import { expect, it } from 'vitest';
import { movedLook } from './motion-probe';

/*
 * Tests only (Session 57, item 6; render/motion-probe.ts): the motion probe counts a frame as moving when what it shows
 * of a part looks different from the frame before. A deck Drashti plays itself moves by a mask too (13 Nov 2026): its
 * own Wipe draws a gradient mask over the whole slide coming in, and a Split one over its shape's box. Nothing else
 * changes then (the same opacity, box, transform and clip), so the probe must see the mask, or a deck's Wipe reads as a
 * cut and a Split as nothing. Its Cover and Uncover shade the moving slide with a filter, which it saw already.
 */

const still = { transform: 'none', clipPath: 'none', maskImage: 'none', filter: 'none' };
/** A Wipe's band as Chromium gives it back, its edge at `edge` % of the slide. */
const wipe = (edge: number) =>
  `linear-gradient(to left, rgb(0, 0, 0) ${String(edge)}%, rgba(0, 0, 0, 0) ${String(edge + 100)}%)`;

it('sees a mask that changes (a deck’s Wipe, a Split) as it sees a transform, a clip or a filter that changes', () => {
  const look = movedLook(still);
  expect(movedLook({ ...still })).toBe(look);
  // A mask coming, and its band moving on a frame.
  expect(movedLook({ ...still, maskImage: wipe(-20) })).not.toBe(look);
  expect(movedLook({ ...still, maskImage: wipe(-20) })).not.toBe(
    movedLook({ ...still, maskImage: wipe(-19) }),
  );
  // As before: a shade, a move, a clip.
  expect(movedLook({ ...still, filter: 'brightness(0.986)' })).not.toBe(look);
  expect(movedLook({ ...still, transform: 'matrix(1, 0, 0, 1, -40, 0)' })).not.toBe(look);
  expect(movedLook({ ...still, clipPath: 'inset(0px 0px 0px 40%)' })).not.toBe(look);
});
