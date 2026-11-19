import { describe, expect, it } from 'vitest';
import { EngineMirror } from '../../shared/engine/mirror';
import { controllerTest } from '../nodes/controller-testing';

describe('Main with a second computer watching the show', () => {
  it('publishes changes in order without waiting for the controller, and a dropped link changes no engine state', async () => {
    const h = controllerTest();
    try {
      h.service.setController(h.node.id, true);
      h.online();
      const mirror = new EngineMirror();
      mirror.apply(h.engine.snapshot());
      h.messages.length = 0;
      expect(h.engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 })).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(h.engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: true });
      // The worker never acknowledges either engine message. Main has already applied both.
      expect(h.engine.current.live.slideIndex).toBe(1);
      for (const message of h.messages)
        if (message.type === 'engine') expect(mirror.apply(message.message)).toBe('applied');
      expect(mirror.rev).toBe(h.engine.rev);
      expect(mirror.state).toEqual(h.engine.current);
      const before = structuredClone(h.engine.current);
      const rev = h.engine.rev;
      h.emit({ type: 'offline', nodeId: h.node.id });
      expect(h.engine.rev).toBe(rev);
      expect(h.engine.current).toEqual(before);
      expect(h.engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: true });
      expect(h.engine.current.live.slideIndex).toBe(2);
      h.online();
      expect(h.engine.current.live.slideIndex).toBe(2);
    } finally {
      await h.close();
    }
  });
});
