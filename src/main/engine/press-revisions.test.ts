import { describe, expect, it } from 'vitest';
import { runEngineCommand } from '../ipc/engine-ipc';
import { controllerTest } from '../nodes/controller-testing';

const routes = ['phone', 'operator', 'controller'] as const;
const updates = ['measurement', 'length'] as const;

describe('press revisions while a new video settles', () => {
  for (const route of routes) {
    for (const update of updates) {
      for (const intervening of ['metadata only', 'next', 'goLive'] as const) {
        it(`${route}: ${update} with ${intervening} between reading and pressing`, async () => {
          let gain = 1;
          const h = controllerTest({ soundOf: () => ({ gain, silent: false }) });
          try {
            h.online();
            h.service.setController(h.node.id, true);
            h.service.setControllerAreas(h.node.id, ['show', 'media']);
            expect(h.engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 }).ok).toBe(true);
            expect(
              h.engine.dispatch({
                type: 'setBackground',
                background: { kind: 'media', mediaId: 'clip', media: 'video', fit: 'fit', loop: true },
              }).ok,
            ).toBe(true);
            const seen = { session: h.engine.session, rev: h.engine.rev };
            if (intervening === 'next') h.engine.dispatch({ type: 'next' });
            if (intervening === 'goLive')
              h.engine.dispatch({ type: 'goLive', presentationId: 'p2', slideIndex: 0 });
            const beforeMetadata = h.engine.rev;
            gain = 0.5;
            expect(
              update === 'measurement' ? h.engine.refreshSound() : h.engine.learnLength('clip', 4000),
            ).toMatchObject({ ok: true, changed: true });
            expect(h.engine.rev).toBe(beforeMetadata + 1);
            const beforePress = h.engine.rev;
            const slide = h.engine.current.live.slideIndex;
            const command = { type: 'next' as const };
            const result =
              route === 'phone'
                ? h.engine.dispatch({ ...command, ...seen })
                : route === 'operator'
                  ? runEngineCommand(h.engine, command, true, seen)
                  : h.service.controllerAction(h.node.id, { id: 'placeholder-press', ...seen, command });
            if (intervening === 'metadata only') {
              expect(result).toMatchObject(
                route === 'controller' ? { status: 'accepted', changed: true } : { ok: true, changed: true },
              );
              expect(h.engine.current.live.slideIndex).toBe(1);
              expect(h.engine.rev).toBe(beforePress + 1);
            } else {
              expect(result).toMatchObject(
                route === 'controller'
                  ? { status: 'stale' }
                  : route === 'operator'
                    ? { ok: false, error: 'forbidden' }
                    : { ok: true, changed: false },
              );
              expect(h.engine.current.live.slideIndex).toBe(slide);
              expect(h.engine.rev).toBe(beforePress);
            }
          } finally {
            await h.close();
          }
        });
      }
    }
  }
});
