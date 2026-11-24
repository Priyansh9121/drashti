import { describe, expect, it } from 'vitest';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../shared/lower-thirds';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';
import { runEngineCommand } from '../ipc/engine-ipc';
import { controllerTest } from '../nodes/controller-testing';

const routes = ['phone', 'operator', 'controller'] as const;
const updates = ['measurement', 'length'] as const;

describe('press revisions while a new video settles', () => {
  for (const route of routes) {
    for (const update of updates) {
      for (const intervening of ['metadata only', 'next', 'goLive', 'pause'] as const) {
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
            if (intervening === 'pause') {
              expect(h.engine.learnLength('clip', 8000)).toMatchObject({ ok: true, changed: true });
              expect(
                h.engine.dispatch({ type: 'pausePlaying', playing: { layer: 'background' } }),
              ).toMatchObject({ ok: true, changed: true });
            }
            const beforeMetadata = h.engine.rev;
            if (update === 'measurement') gain = 0.5;
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

describe('press freshness guards', () => {
  it('does not mistake a real change during a metadata apply for metadata', () => {
    let now = 1000;
    let gain = 1;
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => now, undefined, {
      soundOf: () => ({ gain, silent: false }),
      schedule: () => () => undefined,
    });
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    engine.dispatch({
      type: 'setBackground',
      background: {
        kind: 'media',
        mediaId: 'clip',
        media: 'video',
        fit: 'fit',
        loop: true,
      },
    });
    engine.dispatch({
      type: 'showLowerThird',
      lowerThird: {
        id: 'placeholder',
        lines: ['Placeholder'],
        look: DEFAULT_LOWER_THIRD_LOOK,
        where: 'both',
        animation: 'fade-steady',
        seconds: 1,
      },
    });
    const seen = { rev: engine.rev, session: engine.session };
    now += 2000;
    gain = 0.5;
    expect(engine.refreshSound()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.lowerThird).toBeNull();
    expect(runEngineCommand(engine, { type: 'next' }, true, seen)).toMatchObject({ ok: false });
    expect(engine.dispatch({ type: 'next', ...seen })).toMatchObject({ ok: true, changed: false });
    expect(engine.current.live.slideIndex).toBe(0);
  });

  for (const place of ['slide', 'pip'] as const) {
    it(`accepts a Next after the first length report creates videoFiles for a ${place} video`, () => {
      const source = makeSource();
      const slide = textSlide('video-slide', 'Placeholder');
      slide.elements.push({
        id: 'video',
        kind: 'video',
        mediaId: 'clip',
        frame: { x: 0, y: 0, width: 640, height: 360 },
        fit: 'fit',
        loop: true,
      });
      if (place === 'slide') source.set('p1', [slide, textSlide('second', 'Placeholder next')]);
      const engine = new ShowEngine(source, new RecordingTransport(), () => 1000, undefined, {
        mediaKind: () => 'video',
      });
      engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
      if (place === 'pip') engine.dispatch({ type: 'showPip', source: { kind: 'media', mediaId: 'clip' } });
      const seen = { rev: engine.rev, session: engine.session };
      expect(engine.current.videoFiles).toBeUndefined();
      expect(engine.learnLength('clip', 4000)).toMatchObject({ ok: true, changed: true });
      expect(engine.rev).toBe(seen.rev + 1);
      expect(engine.current.videoFiles?.['clip']?.durationMs).toBe(4000);
      expect(engine.dispatch({ type: 'next', ...seen })).toMatchObject({ ok: true, changed: true });
      expect(engine.current.live.slideIndex).toBe(1);
    });
  }
});

/**
 * Cue (alpha.22): the pages' first-frame reports and a page joining again change only the private cue's readiness. A
 * press read a moment before one of them must still count (with x81's freshness check, a Next pressed while a cue got
 * ready was refused as stale). The cue itself, made or cancelled, still invalidates an older press.
 */
describe('press revisions while a cued video gets ready', () => {
  for (const route of routes) {
    for (const intervening of ['ready', 'not ready', 'page joined', 'cue made', 'cue cancelled'] as const) {
      it(`${route}: a page's ${intervening} between reading and pressing`, async () => {
        let pages = ['hall', 'live'];
        const h = controllerTest({
          schedule: () => () => undefined,
          mediaKind: () => 'video',
          mediaLength: () => 10_000,
          videoCueParticipants: () => pages,
        });
        try {
          h.online();
          h.service.setController(h.node.id, true);
          h.service.setControllerAreas(h.node.id, ['show', 'media']);
          expect(h.engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 }).ok).toBe(true);
          if (intervening !== 'cue made')
            expect(h.engine.dispatch({ type: 'cueVideo', mediaId: 'clip' }).ok).toBe(true);
          const id = h.engine.current.videoCue?.id ?? '';
          if (intervening === 'page joined') h.engine.reportVideoCue(id, 'hall', true);
          const seen = { session: h.engine.session, rev: h.engine.rev };
          const before = h.engine.rev;
          if (intervening === 'ready')
            expect(h.engine.reportVideoCue(id, 'hall', true)).toMatchObject({ ok: true, changed: true });
          if (intervening === 'not ready')
            expect(h.engine.reportVideoCue(id, 'hall', false)).toMatchObject({ ok: true, changed: true });
          if (intervening === 'page joined') {
            pages = ['hall', 'live', 'node-screen'];
            h.engine.videoCuePageJoined('hall');
          }
          if (intervening === 'cue made')
            expect(h.engine.dispatch({ type: 'cueVideo', mediaId: 'clip' }).ok).toBe(true);
          if (intervening === 'cue cancelled')
            expect(h.engine.dispatch({ type: 'cancelVideoCue' }).ok).toBe(true);
          expect(h.engine.rev).toBe(before + 1);
          const command = { type: 'next' as const };
          const result =
            route === 'phone'
              ? h.engine.dispatch({ ...command, ...seen })
              : route === 'operator'
                ? runEngineCommand(h.engine, command, true, seen)
                : h.service.controllerAction(h.node.id, { id: 'placeholder-press', ...seen, command });
          if (intervening === 'cue made' || intervening === 'cue cancelled') {
            expect(result).toMatchObject(
              route === 'controller'
                ? { status: 'stale' }
                : route === 'operator'
                  ? { ok: false, error: 'forbidden' }
                  : { ok: true, changed: false },
            );
            expect(h.engine.current.live.slideIndex).toBe(0);
          } else {
            expect(result).toMatchObject(
              route === 'controller' ? { status: 'accepted', changed: true } : { ok: true, changed: true },
            );
            expect(h.engine.current.live.slideIndex).toBe(1);
          }
        } finally {
          await h.close();
        }
      });
    }
  }
});
