import { describe, expect, it } from 'vitest';
import { type Covers, coversPutBack } from './covers';

/*
 * The one rule for the covers Oops and Put it back leave (QA24-OOPS-COVERS, the owner's "Restore covers"), the show's
 * and the practice show's: each case of the oopsfix review's table.
 */

const OFF: Covers = { blackout: false, wallpaper: false };
const BLACKOUT: Covers = { blackout: true, wallpaper: false };
const WALLPAPER: Covers = { blackout: false, wallpaper: true };

describe('the covers Oops and Put it back leave', () => {
  const cases: { name: string; before: Covers; after: Covers; now: Covers; seen: boolean; left: Covers }[] = [
    {
      name: 'taken off by the change (a wrong click)',
      before: BLACKOUT,
      after: OFF,
      now: OFF,
      seen: true,
      left: BLACKOUT,
    },
    {
      name: 'on all along (a message taken back)',
      before: WALLPAPER,
      after: WALLPAPER,
      now: WALLPAPER,
      seen: true,
      left: WALLPAPER,
    },
    {
      name: 'taken off by the operator since',
      before: BLACKOUT,
      after: BLACKOUT,
      now: OFF,
      seen: true,
      left: OFF,
    },
    {
      name: 'put on since, something to see back',
      before: OFF,
      after: OFF,
      now: BLACKOUT,
      seen: true,
      left: OFF,
    },
    {
      name: 'put on since, nothing to see back',
      before: OFF,
      after: OFF,
      now: BLACKOUT,
      seen: false,
      left: BLACKOUT,
    },
    {
      name: 'switched since (Put it back)',
      before: BLACKOUT,
      after: BLACKOUT,
      now: WALLPAPER,
      seen: true,
      left: OFF,
    },
    {
      name: 'taken off by the change, the other on since, nothing to see',
      before: BLACKOUT,
      after: OFF,
      now: WALLPAPER,
      seen: false,
      left: BLACKOUT,
    },
    {
      name: 'an older save with both, taken off',
      before: { blackout: true, wallpaper: true },
      after: OFF,
      now: OFF,
      seen: true,
      left: BLACKOUT,
    },
    { name: 'none then, none now', before: OFF, after: OFF, now: OFF, seen: false, left: OFF },
  ];
  for (const c of cases)
    it(c.name, () => {
      expect(coversPutBack(c.before, c.after, c.now, c.seen)).toEqual(c.left);
    });
});
