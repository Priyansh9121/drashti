import { describe, expect, it } from 'vitest';
import { ENGINE_STATE_VERSION, readsEngineVersion } from '../../shared/engine/state';

describe('offline helper engine compatibility', () => {
  it('advertises the allocated engine version and retains additive Part 17b and caption states', () => {
    expect(ENGINE_STATE_VERSION).toBe(27);
    expect(readsEngineVersion(25)).toBe(true);
    expect(readsEngineVersion(26)).toBe(true);
    expect(readsEngineVersion(28)).toBe(false);
  });
});
