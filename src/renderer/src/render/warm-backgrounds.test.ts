import { describe, expect, it } from 'vitest';
import {
  LOWER_THIRD_MOTIONS,
  MOTION_PERIOD_MS,
  motionAt,
  motionPieces,
} from '../../../shared/lower-third-styles';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../../shared/lower-thirds';
import { WARM_BACKGROUNDS, WARM_BACKGROUNDS_SCENE, warmScenes } from './WarmUp';

/*
 * The warm-up draws every moving background of the Lower Thirds studio (Session 58, Q58-18). Until now none was drawn
 * in it (its lower thirds all have the default look, no moving background), so a screen with a graphics chip made
 * what a background draws the first time one went up in a show. One scene now draws them all, from the registry (one
 * added there is warmed too), each a small lower third at two moments of its loop; on the hall's screens and the
 * stream's page, never the LIVE picture (the operator's own, and the opening waits for its warm-up).
 */

const BEFORE = 1_800_000_000_000;
const ALL = LOWER_THIRD_MOTIONS.filter((m) => m !== 'none');

describe('the warm-up’s moving backgrounds', () => {
  it('one scene draws every moving background in the registry, each at two moments, on the hall’s screens and the stream’s page only, nothing of the show under it', () => {
    const scenes = warmScenes().filter((s) => s.key === WARM_BACKGROUNDS_SCENE);
    expect(scenes).toHaveLength(1);
    const scene = scenes[0];
    expect(scene?.pages).toEqual(['output', 'stream']);
    expect(scene?.draw?.(false, BEFORE, { width: 1920, height: 1080 }) ?? null).toBeNull();
    expect(scene?.draw?.(true, BEFORE, { width: 1920, height: 1080 })).toBeTruthy();
    const state = scene?.state(true, BEFORE);
    expect(state?.layers.slide).toBeNull();
    expect(state?.layers.lowerThird).toBeNull();
    expect(ALL.length).toBeGreaterThanOrEqual(8);
    for (const motion of ALL)
      expect(
        WARM_BACKGROUNDS.filter((b) => b.motion === motion),
        motion,
      ).toHaveLength(2);
    expect(WARM_BACKGROUNDS).toHaveLength(2 * ALL.length);
    // Every other scene is every page's, as before.
    for (const s of warmScenes())
      if (s.key !== WARM_BACKGROUNDS_SCENE) expect(s.pages, s.key).toBeUndefined();
  });

  it('every piece of every background shows at one of its two moments, so the warm-up draws each', () => {
    for (const motion of ALL) {
      const count = motionPieces(motion, { ...DEFAULT_LOWER_THIRD_LOOK, motion }).length;
      const parts = WARM_BACKGROUNDS.filter((b) => b.motion === motion).map((b) => b.part);
      const period = MOTION_PERIOD_MS[motion];
      for (let i = 0; i < count; i += 1) {
        const most = Math.max(
          ...parts.map((part) => motionAt(motion, period * (10 + part), count)[i]?.opacity ?? 0),
        );
        expect(most, `${motion} piece ${String(i)}`).toBeGreaterThan(0.05);
      }
    }
  });
});
