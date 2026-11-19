import { describe, expect, it } from 'vitest';
import { StreamPageWarmUp } from './stream-warm';

/*
 * The stream's page's own warm-up as it opens (Session 60, X21; the owner's answer A to Q60-1): none once a hall screen
 * on this computer has drawn its warm-up whole at this start and the opening is over; as before until then.
 */

const NONE = 'Warm-up: none of its own, the hall’s screens drew theirs at this start, for the stream’s page';

function made() {
  const lines: string[] = [];
  return { warm: new StreamPageWarmUp((line) => lines.push(line)), lines };
}

describe('the stream’s page’s own warm-up as it opens (X21, the owner’s A)', () => {
  it('none once a hall screen here has drawn its warm-up whole at this start and the opening is over; said once a page', () => {
    const { warm, lines } = made();
    warm.openingOver();
    warm.hallEnded('drawn');
    expect(warm.skips(7)).toBe(true);
    expect(warm.skips(7)).toBe(true);
    expect(lines).toEqual([NONE]);
    // The stream's page opened again (another page): said again.
    expect(warm.skips(8)).toBe(true);
    expect(lines).toEqual([NONE, NONE]);
  });

  it('as before with no hall screen here, or none whose warm-up drew everything', () => {
    const { warm, lines } = made();
    warm.openingOver();
    expect(warm.skips(1)).toBe(false);
    for (const how of ['cap', 'unseen', 'error', 'cut'] as const) {
      warm.hallEnded(how);
      expect(warm.skips(1), how).toBe(false);
    }
    expect(lines).toEqual([]);
  });

  it('as before while the opening still plays, or before the start has said whether it plays', () => {
    const { warm } = made();
    warm.hallEnded('drawn');
    expect(warm.skips(1), 'the opening not decided yet').toBe(false);
    warm.openingPlays();
    expect(warm.skips(1), 'the opening playing').toBe(false);
    warm.openingOver();
    expect(warm.skips(1), 'the opening over').toBe(true);
  });

  it('as before once the GPU process has stopped, until a hall screen has drawn its warm-up whole again', () => {
    const { warm } = made();
    warm.openingOver();
    warm.hallEnded('drawn');
    warm.gpuGone();
    expect(warm.skips(1)).toBe(false);
    warm.hallEnded('cap');
    expect(warm.skips(1)).toBe(false);
    warm.hallEnded('drawn');
    expect(warm.skips(1)).toBe(true);
  });

  it('one hall screen that drew its warm-up whole is enough, whatever another one did', () => {
    const { warm } = made();
    warm.openingOver();
    warm.hallEnded('drawn');
    warm.hallEnded('cap');
    expect(warm.skips(1)).toBe(true);
  });
});
