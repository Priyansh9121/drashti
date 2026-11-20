import { describe, expect, it } from 'vitest';
import type { Appearance } from './appearances';
import {
  APPEARANCE_FAMILIES,
  BLACK,
  BUILT_IN,
  HEADER_MOTIONS,
  MOTION_KINDS,
  WHITE,
  familyOf,
} from './appearances';
import { isSlow, movingNow, SLOW_CORES, type MovingFacts } from './moving';
import { measureMoving } from './rules';

/*
 * Live appearances (Session 60, the owner's Q60-36 (3), his motion safety rule "Yes, A" and Q60-45): a live look's
 * touch moves only in the header and the band, and only when nothing holds it: it is off without a graphics chip,
 * paused while streaming or recording on a slow computer (four logical cores or fewer), off with the computer's
 * Reduce motion or interface motion Off, off with Moving: Off, still while the window is opening and while it is
 * hidden. The 28 marked live on the sheet move; every header touch keeps the header's words and controls at their
 * contrast. Made-up facts only.
 */

const FREE: MovingFacts = {
  look: ['drift'],
  on: true,
  interfaceOff: false,
  reduced: false,
  noGpu: false,
  busy: false,
  slow: false,
  opened: true,
  hidden: false,
};

describe('when a live appearance moves (his safety rule)', () => {
  it('moves when nothing holds it', () => {
    expect(movingNow(FREE)).toBe('moving');
  });

  it.each([
    ['a still appearance', { look: [] }, 'still'],
    ['Moving: Off', { on: false }, 'off'],
    ['interface motion Off', { interfaceOff: true }, 'reduced'],
    ['the computer set to reduce motion', { reduced: true }, 'reduced'],
    ['no graphics chip', { noGpu: true }, 'no-chip'],
    ['streaming or recording on a slow computer', { busy: true, slow: true }, 'busy'],
    ['the window still opening', { opened: false }, 'opening'],
    ['the window hidden', { hidden: true }, 'hidden'],
  ] as const)('is held by %s', (_what, change, why) => {
    expect(movingNow({ ...FREE, ...change })).toBe(why);
  });

  it('streaming or recording holds it only on a slow computer', () => {
    expect(movingNow({ ...FREE, busy: true, slow: false })).toBe('moving');
    expect(movingNow({ ...FREE, busy: false, slow: true })).toBe('moving');
  });

  it('a slow computer has four logical cores or fewer (Q60-45)', () => {
    expect(SLOW_CORES).toBe(4);
    expect([1, 2, 3, 4].every(isSlow)).toBe(true);
    expect([5, 6, 8, 16].some(isSlow)).toBe(false);
  });
});

describe('the live appearances (Q60-45: the 28 marked live move)', () => {
  const live = BUILT_IN.filter((a) => a.moving);

  it('twenty-eight move, each saying in words what moves, with motions from the list; Black and White are still', () => {
    expect(live.length).toBe(28);
    for (const a of live) {
      expect(a.moving?.words.length, a.name).toBeGreaterThan(10);
      expect(a.moving?.kinds.length, a.name).toBeGreaterThan(0);
      for (const k of a.moving?.kinds ?? []) expect(MOTION_KINDS, `${a.name} ${k}`).toContain(k);
      // A touch over the header has a colour to be measured in; one only over the band needs none.
      const overHeader = (a.moving?.kinds ?? []).some((k) => HEADER_MOTIONS.includes(k));
      expect(a.moving?.touch !== undefined, a.name).toBe(overHeader);
    }
    expect(BLACK.moving).toBeUndefined();
    expect(WHITE.moving).toBeUndefined();
  });

  it('every header touch keeps the header’s words at 4.5:1 and its controls at 3:1, as on the header itself', () => {
    const missed = live.flatMap((a) =>
      measureMoving(a)
        .filter((m) => !m.ok)
        .map((m) => `${a.name}: ${m.what} ${m.value.toFixed(2)}`),
    );
    expect(missed).toEqual([]);
    expect(live.filter((a) => a.moving?.touch).every((a) => measureMoving(a).length >= 5)).toBe(true);
  });

  it('would see a failure: a touch as light as the header’s words', () => {
    const diwali = BUILT_IN.find((a) => a.id === 'diwali');
    const moving = diwali?.moving;
    if (!diwali || !moving) throw new Error('Diwali moves');
    const bright: Appearance = { ...diwali, moving: { ...moving, touch: diwali.decoration['on-header'] } };
    expect(measureMoving(bright).some((m) => !m.ok && m.what.startsWith('words on the header’s touch'))).toBe(
      true,
    );
  });

  it('each appearance is one entry: its family, its moving touch and its zones’ tints are its own', () => {
    for (const a of BUILT_IN) {
      expect(APPEARANCE_FAMILIES, a.name).toContain(familyOf(a));
      const plain = a.id === BLACK.id || a.id === WHITE.id;
      expect(a.tints === undefined, a.name).toBe(plain);
    }
    // The families in the window's order: Plain and Flags first, and each family's together.
    const order = BUILT_IN.map(familyOf);
    expect(order.slice(0, 4)).toEqual(['Plain', 'Plain', 'Flags', 'Flags']);
  });
});
