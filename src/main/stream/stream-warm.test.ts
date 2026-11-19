import { describe, expect, it } from 'vitest';
import { StreamPageWarmUp } from './stream-warm';

/*
 * The stream's page's own warm-up as it opens (Session 60, X21; the owner's answer A to Q60-1): none once a hall screen
 * on this computer has drawn its warm-up whole at this start and the opening is over; as before until then. A page's
 * answer, once the page can act on it, stays that page's.
 */

const NONE = 'Warm-up: none of its own, the hall’s screens drew theirs at this start, for the stream’s page';
/** The page draws a picture (the preview, or the stream on air or recording): its warm-up would begin. */
const PICTURE = true;
/** The page is open for sound alone (live captions): it draws nothing, so nothing of it warms up yet. */
const SOUND_ALONE = false;

function made() {
  const lines: string[] = [];
  return { warm: new StreamPageWarmUp((line) => lines.push(line)), lines };
}

describe('the stream’s page’s own warm-up as it opens (X21, the owner’s A)', () => {
  it('none once a hall screen here has drawn its warm-up whole at this start and the opening is over; said once a page', () => {
    const { warm, lines } = made();
    warm.openingOver();
    warm.hallEnded('drawn');
    expect(warm.skips(7, PICTURE)).toBe(true);
    expect(warm.skips(7, PICTURE)).toBe(true);
    expect(lines).toEqual([NONE]);
    // The stream's page opened again (another page): said again.
    expect(warm.skips(8, PICTURE)).toBe(true);
    expect(lines).toEqual([NONE, NONE]);
  });

  it('as before with no hall screen here, or none whose warm-up drew everything', () => {
    const { warm, lines } = made();
    warm.openingOver();
    expect(warm.skips(1, PICTURE)).toBe(false);
    let page = 2;
    for (const how of ['cap', 'unseen', 'error', 'cut'] as const) {
      warm.hallEnded(how);
      expect(warm.skips(page++, PICTURE), how).toBe(false);
    }
    expect(lines).toEqual([]);
  });

  it('as before while the opening still plays, or before the start has said whether it plays', () => {
    const { warm } = made();
    warm.hallEnded('drawn');
    expect(warm.skips(1, PICTURE), 'the opening not decided yet').toBe(false);
    warm.openingPlays();
    expect(warm.skips(2, PICTURE), 'the opening playing').toBe(false);
    warm.openingOver();
    expect(warm.skips(3, PICTURE), 'the opening over').toBe(true);
  });

  it('a page keeps the answer it had as its picture was first wanted: one warming itself up is never told later that it needs none', () => {
    const { warm, lines } = made();
    warm.openingOver();
    expect(warm.skips(5, PICTURE), 'opened before any hall screen drew').toBe(false);
    warm.hallEnded('drawn');
    expect(warm.skips(5, PICTURE), 'the same page, asked again').toBe(false);
    expect(lines).toEqual([]);
    expect(warm.skips(6, PICTURE), 'a page opened after').toBe(true);
    expect(lines).toEqual([NONE]);
  });

  it('a page open for sound alone (live captions) is decided once its picture is wanted, and keeps that answer', () => {
    const { warm, lines } = made();
    warm.openingOver();
    expect(warm.skips(5, SOUND_ALONE), 'open for sound alone before any hall screen drew').toBe(false);
    warm.hallEnded('drawn');
    expect(warm.skips(5, PICTURE), 'its picture wanted mid-show').toBe(true);
    expect(warm.skips(5, SOUND_ALONE), 'its picture let go, the page kept for sound').toBe(true);
    expect(lines).toEqual([NONE]);
  });

  it('once the GPU process has stopped: a page keeps its answer, and one opened after warms itself up until a hall screen has drawn its warm-up whole again', () => {
    const { warm, lines } = made();
    warm.openingOver();
    warm.hallEnded('drawn');
    expect(warm.skips(1, PICTURE)).toBe(true);
    warm.gpuGone();
    // It drew the show at once and goes on so (a page warms up at most once as it opens): never told otherwise.
    expect(warm.skips(1, PICTURE), 'the page open before the stop').toBe(true);
    expect(warm.skips(2, PICTURE), 'a page opened after').toBe(false);
    warm.hallEnded('cap');
    expect(warm.skips(3, PICTURE)).toBe(false);
    warm.hallEnded('drawn');
    expect(warm.skips(4, PICTURE)).toBe(true);
    expect(lines).toEqual([NONE, NONE]);
  });

  it('one hall screen that drew its warm-up whole is enough, whatever another one did', () => {
    const { warm } = made();
    warm.openingOver();
    warm.hallEnded('drawn');
    warm.hallEnded('cap');
    expect(warm.skips(1, PICTURE)).toBe(true);
  });
});
