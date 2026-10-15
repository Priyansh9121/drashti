import { describe, expect, it } from 'vitest';
import { copyBox, copySize } from '../../shared/picture-look';
import type { DisplayInfo, NodeDisplays, ScreenConfig, ScreenRole } from '../../shared/screens';
import { largestAudienceScreen } from './copy-screen';

/*
 * The size sharpened copies are made at (Session 26g): the largest audience screen's picture as drawn.
 * Since Session 26h a node's screens count too, at the size of the node's display they are given to.
 */

const screen = (id: string, over: Partial<ScreenConfig> = {}): ScreenConfig => ({
  id,
  groupId: 'hall',
  name: `Placeholder ${id}`,
  displayKey: null,
  canvasWidth: 1920,
  canvasHeight: 1080,
  scaling: 'fit',
  enabled: true,
  feed: null,
  nodeId: null,
  ...over,
});

const display = (
  id: number,
  pixelWidth: number,
  pixelHeight: number,
  label = `Placeholder ${id}`,
): DisplayInfo => ({
  id,
  label,
  bounds: { x: 0, y: 0, width: pixelWidth, height: pixelHeight },
  workArea: { x: 0, y: 0, width: pixelWidth, height: pixelHeight },
  scaleFactor: 1,
  pixelWidth,
  pixelHeight,
  refreshHz: 60,
  rotation: 0,
  internal: false,
  primary: false,
  key: { id, label, pixelWidth, pixelHeight, x: 0, y: 0, internal: false },
});

const roles: Record<string, ScreenRole> = { hall: 'audience', stage: 'stage', foyer: 'audience' };
const roleOf = (groupId: string) => roles[groupId] ?? null;

describe("the sharpened copy's size", () => {
  const mainHall = screen('main-hall');
  const local = [{ screen: mainHall, window: { width: 1280, height: 720 } }];

  it("is Main's largest audience screen as drawn, with no nodes", () => {
    expect(largestAudienceScreen({ local, screens: [mainHall], roleOf, nodes: [] })).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("counts a node's screens, at the size of the node's display they are given to", () => {
    const big = display(7, 3840, 2160);
    const onNode = screen('foyer-tv', { groupId: 'foyer', nodeId: 'node-1', displayKey: big.key });
    const nodes: NodeDisplays[] = [{ id: 'node-1', name: 'Placeholder node', online: true, displays: [big] }];
    expect(largestAudienceScreen({ local, screens: [mainHall, onNode], roleOf, nodes })).toEqual({
      width: 3840,
      height: 2160,
    });
    // An offline node's screens count too, at the displays it last reported: the copy is not made smaller
    // and then bigger again each time a node drops off the network for a moment.
    expect(
      largestAudienceScreen({
        local,
        screens: [mainHall, onNode],
        roleOf,
        nodes: nodes.map((n) => ({ ...n, online: false })),
      }),
    ).toEqual({ width: 3840, height: 2160 });
    // A 4:3 display draws the 16:9 canvas fitted: its width, and less height.
    const square = display(8, 2048, 1536);
    const fitted = screen('foyer-old', { groupId: 'foyer', nodeId: 'node-2', displayKey: square.key });
    expect(
      largestAudienceScreen({
        local: [],
        screens: [fitted],
        roleOf,
        nodes: [{ id: 'node-2', name: 'Placeholder node 2', online: true, displays: [square] }],
      }),
    ).toEqual({ width: 2048, height: 1152 });
  });

  it("leaves out a node's stage screens, screens turned off, and screens whose display it no longer has", () => {
    const big = display(7, 3840, 2160);
    const nodes: NodeDisplays[] = [{ id: 'node-1', name: 'Placeholder node', online: true, displays: [big] }];
    const stage = screen('stage-tv', { groupId: 'stage', nodeId: 'node-1', displayKey: big.key });
    const off = screen('off-tv', { groupId: 'foyer', nodeId: 'node-1', displayKey: big.key, enabled: false });
    const gone = screen('gone-tv', {
      groupId: 'foyer',
      nodeId: 'node-1',
      displayKey: {
        id: 99,
        label: 'Placeholder gone',
        pixelWidth: 5120,
        pixelHeight: 2880,
        x: 0,
        y: 0,
        internal: false,
      },
    });
    const elsewhere = screen('other-node-tv', {
      groupId: 'foyer',
      nodeId: 'node-unpaired',
      displayKey: big.key,
    });
    expect(
      largestAudienceScreen({ local, screens: [mainHall, stage, off, gone, elsewhere], roleOf, nodes }),
    ).toEqual({ width: 1280, height: 720 });
  });

  it("makes the copy at most the picture's own size, however large the node's display", () => {
    const big = display(7, 7680, 4320);
    const onNode = screen('foyer-8k', { groupId: 'foyer', nodeId: 'node-1', displayKey: big.key });
    const nodes: NodeDisplays[] = [{ id: 'node-1', name: 'Placeholder node', online: true, displays: [big] }];
    const box = copyBox(largestAudienceScreen({ local, screens: [mainHall, onNode], roleOf, nodes }), 1);
    expect(box).toEqual({ width: 7680, height: 4320 });
    expect(copySize({ width: 3000, height: 2000 }, box)).toEqual({ width: 3000, height: 2000 });
  });
});
