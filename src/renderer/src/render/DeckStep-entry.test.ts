import { expect, it } from 'vitest';
import type { StepTiming } from '../../../shared/deck-show';
import { stepPhase } from './DeckStep';

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
