import { afterEach, describe, expect, it } from 'vitest';
import type { NodeHealth } from '../../shared/nodes';
import { controllerTest } from './controller-testing';

/*
 * Whether a node draws without a graphics chip (x27, for Adjust the picture… on its screens): its health says so, and
 * Main's list of nodes for Screens carries it. Placeholder node only.
 */

const health = (noGpu: boolean): NodeHealth => ({
  version: '1.0.0-test',
  host: 'Placeholder node',
  displays: [],
  outputs: [],
  media: { wanted: 0, ready: 0, bytesWanted: 0, bytesReady: 0, copying: null, missingNow: 0, problem: null },
  clock: null,
  rev: 0,
  ...(noGpu ? { noGpu: true as const } : {}),
});

let t: ReturnType<typeof controllerTest> | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

describe("a node's graphics chip, as Screens lists the nodes (x27)", () => {
  it('says a node draws without a chip as its last health says, and nothing before or after one with a chip', () => {
    t = controllerTest();
    t.online();
    expect(t.service.displays()[0]?.noGpu).toBeUndefined();
    t.emit({ type: 'health', nodeId: t.node.id, health: health(true) });
    expect(t.service.displays()[0]?.noGpu).toBe(true);
    t.emit({ type: 'health', nodeId: t.node.id, health: health(false) });
    expect(t.service.displays()[0]?.noGpu).toBeUndefined();
  });
});
