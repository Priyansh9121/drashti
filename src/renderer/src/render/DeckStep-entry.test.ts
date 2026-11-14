import { expect, it } from 'vitest';
import type { StepTiming } from '../../../shared/deck-show';
import { chooseAhead, firstClipStart, playingFrom, stepPhase } from './DeckStep';

const directJump: StepTiming = {
  index: 0,
  shownAt: 1000,
  clipAt: 600,
  endsAt: 2100,
  still: false,
  drashti: null,
  step: { clipId: 'placeholder-clip', clipMs: 1500, transitionMs: 400, lastId: 'placeholder-last' },
};

it('keeps the first clip pending if the jump’s first frame has not decoded by the original end', () => {
  const loading = { hold: false, clipFailed: false, firstFrameDeadline: 4000 };
  expect(stepPhase(directJump, 2200, loading)).toBe('clip');
  expect(stepPhase(directJump, 4000, loading)).toBe('held');
  expect(stepPhase({ ...directJump, endsAt: 5000 }, 4000, loading)).toBe('held');
  expect(stepPhase(directJump, 2200, { ...loading, clipFailed: true })).toBe('held');
});

it('takes the clip loaded ahead waiting where the step starts it, else any of that file (C3, Session 58)', () => {
  const next = { url: 'media://placeholder-clip', fromMs: 0 };
  const pointed = { url: 'media://placeholder-clip', fromMs: 400 };
  const other = { url: 'media://another-clip', fromMs: 400 };
  expect(chooseAhead([next, pointed, other], 'media://placeholder-clip', 400)).toBe(pointed);
  expect(chooseAhead([next, pointed, other], 'media://placeholder-clip', 0)).toBe(next);
  // Only one there, at another frame: taken, and sought to the step's (FirstClip's cold path).
  expect(chooseAhead([next], 'media://placeholder-clip', 400)).toBe(next);
  expect(chooseAhead([other], 'media://placeholder-clip', 400)).toBeUndefined();
});

it('starts a slide’s first clip where its frame is: cold, it waits for it; loaded ahead there, at once, catching up only when it came more than a moment late (C3, Session 58)', () => {
  const at = { deadline: 4000, shownAt: 1000, fromMs: 400 };
  // Cold: sought paused to the frame past the deck's own transition, from the slide's showing.
  expect(firstClipStart({ ...at, warmed: false, mountedAt: 1020 })).toEqual({
    seek: { at: 1000, toMs: 400, paused: true },
  });
  // Loaded ahead at that frame, the slide's step up within 50 ms: played from where it is, by the engine's time.
  expect(firstClipStart({ ...at, warmed: true, mountedAt: 1030 })).toEqual({});
  // 120 ms late: from that frame at once, catching up a tenth faster at most.
  expect(firstClipStart({ ...at, warmed: true, mountedAt: 1120 })).toEqual({
    seek: { at: 1120, toMs: 400 },
    catchUp: { at: 1120, lateMs: 120, maxRate: 1.1 },
  });
  // A screen joining a slide already up: by the engine's time, as before.
  expect(firstClipStart({ ...at, deadline: null, warmed: true, mountedAt: 3000 })).toEqual({});
  expect(firstClipStart({ ...at, deadline: null, warmed: false, mountedAt: 3000 })).toEqual({});
});

it('plays a cold first clip from its frame by a clock started as it plays, never as its frame came (C3T-2)', () => {
  // The frame came in 120 ms after the slide's showing; the next frame played it, 137 ms after.
  expect(playingFrom(1000, 400, 1120)).toEqual({
    seek: { at: 1120, toMs: 400 },
    catchUp: { at: 1120, lateMs: 120, maxRate: 1.1 },
  });
  expect(playingFrom(1000, 400, 1137)).toEqual({
    seek: { at: 1137, toMs: 400 },
    catchUp: { at: 1137, lateMs: 137, maxRate: 1.1 },
  });
  // On time: nothing to make up.
  expect(playingFrom(1000, 0, 1000)).toEqual({ seek: { at: 1000, toMs: 0 } });
});
