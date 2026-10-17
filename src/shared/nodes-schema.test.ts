import { describe, expect, it } from 'vitest';
import { nodeHealthSchema } from './nodes-schema';

/** A node's health as it sends it, one output in the state given. */
const health = (state: string): unknown => ({
  version: '1.0.0-placeholder',
  host: 'Placeholder node',
  displays: [],
  outputs: [{ screenId: 'placeholder-screen', state, displayId: null, droppedFrames: 0, paintedRev: 3 }],
  media: { wanted: 0, ready: 0, bytesWanted: 0, bytesReady: 0, copying: null, missingNow: 0, problem: null },
  clock: null,
  rev: 3,
});

describe("a node's health", () => {
  it('says an output its watchdog gave up on is stopped (Sessions 31–36), and nothing it does not know', () => {
    const parsed = nodeHealthSchema.safeParse(health('stopped'));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.outputs[0]?.state).toBe('stopped');
    for (const state of ['showing', 'missing-display', 'disabled'])
      expect(nodeHealthSchema.safeParse(health(state)).success).toBe(true);
    expect(nodeHealthSchema.safeParse(health('placeholder-state')).success).toBe(false);
  });
});
