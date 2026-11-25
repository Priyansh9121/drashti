import { describe, expect, it } from 'vitest';
import { FLOW_SHARE, flowAreaHeight } from './flow-area';

/*
 * The Sabha flow panel's height in the left column (alpha.23, lead 2's yes to a22-flow-core's proposal): at least what
 * Now and Next up need, whole, with the read list's own 96 px, never past the splitter's most, so the playlists never
 * have less than the splitter's least leaves them; an operator's own splitter setting wins.
 */

describe('the Sabha flow panel’s height', () => {
  it('is its share when that holds Now and Next up whole', () => {
    expect(flowAreaHeight({ area: 712, share: 0.5, need: 300, dragged: false })).toBe(356);
  });

  it('grows to what Now and Next up need whole (1410 x 900: 534 of 712 px), up to the splitter’s most', () => {
    expect(flowAreaHeight({ area: 712, share: 0.5, need: 534, dragged: false })).toBe(534);
    expect(flowAreaHeight({ area: 712, share: 0.5, need: 520, dragged: false })).toBe(520);
    // Never past three quarters: the playlists keep the splitter's least.
    expect(flowAreaHeight({ area: 712, share: 0.5, need: 700, dragged: false })).toBe(
      Math.round(FLOW_SHARE.max * 712),
    );
    // A smaller window: as tall as it may be; the panel's own scroll does the rest (Q-FC-2 A).
    expect(flowAreaHeight({ area: 412, share: 0.5, need: 534, dragged: false })).toBe(309);
  });

  it('is the operator’s own splitter setting once they have set it, whatever Now and Next up need', () => {
    expect(flowAreaHeight({ area: 712, share: 0.3, need: 534, dragged: true })).toBe(214);
    expect(flowAreaHeight({ area: 712, share: 0.6, need: 300, dragged: true })).toBe(427);
  });

  it('keeps within the splitter’s least and most for any share, and with nothing measured is its share', () => {
    expect(flowAreaHeight({ area: 712, share: 0.1, need: 0, dragged: false })).toBe(178);
    expect(flowAreaHeight({ area: 712, share: 0.9, need: 0, dragged: true })).toBe(534);
    expect(flowAreaHeight({ area: 712, share: 0.5, need: 0, dragged: false })).toBe(356);
  });
});
