import { describe, expect, it } from 'vitest';
import { keepStage, STAGE_SETTING, stageStartsOn } from './stage-switch-setting';

/*
 * Stage starts as it was left (alpha.22; the owner, 24 Nov 2026: "by default it should be off. keep it off. i can
 * turn on, and then turn off"): off on a new library, and once after the update (nothing was kept before alpha.22),
 * then as the operator left it, start after start. The library's settings are stood in for by a map.
 */

function settings(start: Record<string, unknown> = {}) {
  const kept = new Map<string, unknown>(Object.entries(start));
  return {
    kept,
    get: (name: string) => kept.get(name),
    set: (name: string, value: unknown) => {
      kept.set(name, value);
    },
  };
}

describe('Stage as it starts (alpha.22)', () => {
  it('starts off on a new library, and after the update from a Drashti that kept nothing', () => {
    expect(stageStartsOn(settings())).toBe(false);
  });

  it('starts as it was left: on, or off', () => {
    const s = settings();
    keepStage(s, true);
    expect(s.kept.get(STAGE_SETTING)).toBe('on');
    expect(stageStartsOn(s)).toBe(true);
    keepStage(s, false);
    expect(s.kept.get(STAGE_SETTING)).toBe('off');
    expect(stageStartsOn(s)).toBe(false);
  });

  it('reads anything else kept there as never chosen: off, or the tests’ start', () => {
    for (const odd of [true, 1, 'yes', null, { on: true }]) {
      expect(stageStartsOn(settings({ [STAGE_SETTING]: odd }))).toBe(false);
      // The e2e tests' start (DRASHTI_TEST_STAGE_AT_START): on until a spec turns it, as before alpha.22.
      expect(stageStartsOn(settings({ [STAGE_SETTING]: odd }), true)).toBe(true);
    }
    // What the operator left wins over the tests' start.
    expect(stageStartsOn(settings({ [STAGE_SETTING]: 'off' }), true)).toBe(false);
  });
});
