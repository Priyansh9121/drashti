import { describe, expect, it } from 'vitest';
import { controllerTest } from './controller-testing';

describe('a paired computer’s shared show view', () => {
  it('is off for ordinary nodes and is enabled on Main without pairing again or changing the show', async () => {
    const h = controllerTest();
    try {
      expect(h.service.status().nodes[0]?.controller).toBe(false);
      h.online();
      const before = h.engine.snapshot();
      h.messages.length = 0;
      expect(h.service.setController(h.node.id, true).ok).toBe(true);
      expect(h.service.status().nodes[0]?.controller).toBe(true);
      expect(h.messages.filter((m) => m.type === 'to-node').at(-1)).toMatchObject({
        type: 'to-node',
        nodeId: h.node.id,
        message: { type: 'controller', context: { canvasWidth: 1920, canvasHeight: 1080 } },
      });
      expect(h.nodes.get(h.node.id)).toEqual(h.node);
      expect(h.engine.rev).toBe(before.rev);
      expect(h.engine.current).toEqual(before.state);
    } finally {
      await h.close();
    }
  });

  it('keeps the choice on Main and sends it again on reconnect; disabling sends null immediately', async () => {
    const h = controllerTest();
    try {
      h.service.setController(h.node.id, true);
      await h.restart();
      expect(h.service.status().nodes[0]?.controller).toBe(true);
      h.messages.length = 0;
      h.online();
      expect(
        h.messages.filter((m) => m.type === 'to-node' && m.message.type === 'controller').at(-1),
      ).toMatchObject({
        type: 'to-node',
        nodeId: h.node.id,
        message: { type: 'controller', context: { canvasWidth: 1920 } },
      });
      h.messages.length = 0;
      h.service.setController(h.node.id, false);
      expect(h.messages).toContainEqual({
        type: 'to-node',
        nodeId: h.node.id,
        message: { type: 'controller', context: null },
      });
      expect(h.service.status().nodes[0]?.controller).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('refuses a missing computer and malformed permission without changing a paired node', async () => {
    const h = controllerTest();
    try {
      expect(h.service.setController('no-longer-paired', true).ok).toBe(false);
      expect(h.service.setController(h.node.id, 'yes').ok).toBe(false);
      expect(h.service.status().nodes[0]?.controller).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('uses Main’s audience canvas and refreshes it when screens change', async () => {
    const h = controllerTest();
    try {
      const groupId = h.screens.createGroup('Placeholder Hall');
      const screenId = h.screens.addScreen(groupId, 'Placeholder screen', null);
      h.screens.updateScreen(screenId, { canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' });
      h.service.setController(h.node.id, true);
      h.messages.length = 0;
      h.service.screensChanged();
      expect(h.messages.filter((m) => m.type === 'to-node').at(-1)).toMatchObject({
        type: 'to-node',
        nodeId: h.node.id,
        message: {
          type: 'controller',
          context: { groupId, canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' },
        },
      });
    } finally {
      await h.close();
    }
  });
});
