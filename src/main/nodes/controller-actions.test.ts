import { describe, expect, it } from 'vitest';
import { controllerTest } from './controller-testing';

function request(h: ReturnType<typeof controllerTest>, id = 'placeholder-press') {
  return { id, session: h.engine.session, rev: h.engine.rev, command: { type: 'toggleBlackout' } };
}

describe('a controller asks Main to act', () => {
  it('starts with no action areas; a view grant alone never lets it act', async () => {
    const h = controllerTest();
    try {
      h.online();
      h.service.setController(h.node.id, true);
      expect(h.service.controllerAction(h.node.id, request(h))).toMatchObject({ status: 'refused' });
      expect(h.actions).toHaveLength(0);
      expect(h.engine.current.blackout).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('uses Main’s action layer once and returns the same answer for a repeated press', async () => {
    const h = controllerTest();
    try {
      h.online();
      h.service.setController(h.node.id, true);
      expect(h.service.setControllerAreas(h.node.id, ['show']).ok).toBe(true);
      const press = request(h);
      const first = h.service.controllerAction(h.node.id, press);
      expect(first).toMatchObject({ id: press.id, status: 'accepted', rev: press.rev + 1 });
      expect(h.service.controllerAction(h.node.id, press)).toEqual(first);
      expect(h.actions).toEqual([{ type: 'toggleBlackout' }]);
      expect(h.engine.current.blackout).toBe(true);
    } finally {
      await h.close();
    }
  });

  it('refuses a stale revision or another run; the first valid press wins', async () => {
    const h = controllerTest();
    try {
      h.online();
      h.service.setController(h.node.id, true);
      h.service.setControllerAreas(h.node.id, ['show']);
      const press = request(h);
      h.engine.dispatch({ type: 'toggleWallpaper' });
      expect(h.service.controllerAction(h.node.id, press)).toMatchObject({ status: 'stale' });
      expect(
        h.service.controllerAction(h.node.id, { ...request(h, 'another-run'), session: 'old-run' }),
      ).toMatchObject({ status: 'stale' });
      expect(h.actions).toHaveLength(0);
      expect(h.engine.current.blackout).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('keeps area choices on Main, and refuses media, revoked, offline and stopped requests', async () => {
    const h = controllerTest();
    try {
      h.service.setController(h.node.id, true);
      h.service.setControllerAreas(h.node.id, ['show']);
      await h.restart();
      h.online();
      expect(h.service.status().nodes[0]?.controllerAreas).toEqual(['show']);
      expect(
        h.service.controllerAction(h.node.id, {
          ...request(h),
          command: { type: 'pausePlaying', playing: { layer: 'background' } },
        }),
      ).toMatchObject({ status: 'refused' });
      h.emit({ type: 'offline', nodeId: h.node.id });
      expect(h.service.controllerAction(h.node.id, request(h, 'offline'))).toMatchObject({
        status: 'refused',
      });
      h.online();
      h.service.tellAccess(false);
      expect(h.service.controllerAction(h.node.id, request(h, 'stopped'))).toMatchObject({
        status: 'refused',
      });
      h.service.tellAccess(true);
      h.service.setController(h.node.id, false);
      expect(h.service.controllerAction(h.node.id, request(h, 'revoked'))).toMatchObject({
        status: 'refused',
      });
      expect(h.actions).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it('keeps current action-layer refusals and rejects malformed or unoffered actions', async () => {
    const h = controllerTest();
    try {
      h.online();
      h.service.setController(h.node.id, true);
      h.service.setControllerAreas(h.node.id, ['show', 'media']);
      h.refuse('Placeholder current-mode refusal');
      expect(h.service.controllerAction(h.node.id, request(h))).toMatchObject({
        status: 'refused',
        message: 'Placeholder current-mode refusal',
      });
      expect(h.service.controllerAction(h.node.id, { ...request(h, 'bad'), rev: -1 })).toMatchObject({
        status: 'refused',
      });
      expect(
        h.service.controllerAction(h.node.id, {
          ...request(h, 'settings'),
          command: { type: 'setBackground', background: { kind: 'color', color: '#000000' } },
        }),
      ).toMatchObject({ status: 'refused' });
      expect(h.service.setControllerAreas(h.node.id, ['settings']).ok).toBe(false);
      expect(h.service.setControllerAreas('missing-node', ['show']).ok).toBe(false);
      expect(h.actions).toHaveLength(1);
      expect(h.engine.current.blackout).toBe(false);
    } finally {
      await h.close();
    }
  });
});
