import { describe, expect, it } from 'vitest';
import { nodeHealthSchema, nodeScreenListSchema } from './nodes-schema';

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

describe("a node's screens, as Main sends them", () => {
  const screen = {
    screenId: 'placeholder-stage-screen',
    name: 'Placeholder stage screen',
    groupId: 'placeholder-stage',
    groupName: 'Placeholder stage',
    role: 'stage',
    feed: null,
    canvasWidth: 1920,
    canvasHeight: 1080,
    scaling: 'fit',
    enabled: true,
    displayKey: {
      id: 2,
      label: 'Placeholder display',
      pixelWidth: 1920,
      pixelHeight: 1080,
      x: 0,
      y: 0,
      internal: false,
    },
  };

  // Session 51 (S4-2): a node with no audience screen of its own draws Main's hall in a stage layout's box.
  it('keep Main’s hall picture on a stage screen, Audience off too; one without it reads as before', () => {
    const hall = {
      groupId: 'placeholder-hall',
      canvasWidth: 1280,
      canvasHeight: 720,
      scaling: 'fill',
      off: true,
    };
    expect(nodeScreenListSchema.parse([{ ...screen, hall }])[0]?.hall).toEqual(hall);
    expect(nodeScreenListSchema.parse([{ ...screen, hall: null }])[0]?.hall).toBeNull();
    expect(nodeScreenListSchema.parse([screen])[0]).toEqual(screen);
    expect(nodeScreenListSchema.safeParse([{ ...screen, hall: { ...hall, canvasWidth: -1 } }]).success).toBe(
      false,
    );
  });
});
