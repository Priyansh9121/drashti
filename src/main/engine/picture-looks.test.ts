import { describe, expect, it } from 'vitest';
import type { PictureLook } from '../../shared/picture-look';
import { PLAIN, slideShowing, ZOOM_GLIDE_MS } from '../../shared/picture-look';
import { SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSED_COMMANDS } from '../../shared/mode';
import type { RenderSlide } from '../../shared/model';
import { ShowEngine } from './show-engine';
import { MemorySlideSource } from './slide-source';
import { RecordingTransport, textSlide } from './testing';

/*
 * Pictures' looks on the screens, and the live zoom (Session 26e): the state
 * carries the looks of the pictures up and coming next, so every screen
 * draws them alike; a live zoom is the picture on the screens' for that
 * showing only.
 */

const picture = (id: string, mediaId: string): RenderSlide => ({
  id,
  width: 1920,
  height: 1080,
  background: null,
  elements: [
    { id: 'picture', kind: 'image', frame: { x: 0, y: 0, width: 1920, height: 1080 }, mediaId, fit: 'fit' },
  ],
});

function setup(simple = false) {
  const source = new MemorySlideSource();
  source.set('deck', [picture('p1', 'm1'), picture('p2', 'm2'), textSlide('w', 'Placeholder words')]);
  const looks = new Map<string, PictureLook>([['m1', { ...PLAIN, zoom: 1.5, brightness: 0.2 }]]);
  const clock = { now: 100_000 };
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock.now, undefined, {
    pictureLook: (id) => looks.get(id) ?? null,
    refuse: (c) => (simple && SIMPLE_MODE_REFUSED_COMMANDS.includes(c.type) ? SIMPLE_MODE_REFUSAL : null),
    schedule: () => () => undefined,
  });
  return { engine, looks, clock };
}

describe('pictures on the screens', () => {
  it('carry the looks of the pictures up and coming next; one without is left out', () => {
    const { engine, looks } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(engine.current.pictures).toEqual({ m1: { ...PLAIN, zoom: 1.5, brightness: 0.2 } });
    // The next slide's picture gains a look: the screens hear of it at once.
    looks.set('m2', { ...PLAIN, contrast: 0.3 });
    engine.refreshPictures();
    expect(Object.keys(engine.current.pictures).sort()).toEqual(['m1', 'm2']);
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.pictures).toEqual({});
  });

  it('a live zoom is the picture on the screens’ for that showing, gliding from its kept look', () => {
    const { engine, clock } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    const shownAt = engine.current.layers.slide?.shownAt ?? 0;
    clock.now += 1000;
    expect(engine.dispatch({ type: 'zoomLive', zoom: 2, x: 0.2, y: 0 })).toMatchObject({ ok: true });
    expect(engine.current.liveZoom).toEqual({
      mediaId: 'm1',
      showing: slideShowing(shownAt),
      zoom: 2,
      x: 0.2,
      y: 0,
      from: { zoom: 1.5, x: 0, y: 0 },
      at: clock.now,
    });
    // Half-way through the glide, another zoom sets off from where it had got to.
    clock.now += ZOOM_GLIDE_MS / 2;
    engine.dispatch({ type: 'zoomLive', zoom: 3, x: 0, y: 0 });
    const from = engine.current.liveZoom?.from;
    expect(from?.zoom).toBeGreaterThan(1.5);
    expect(from?.zoom).toBeLessThan(2);
    // Too far is kept inside what makes sense.
    engine.dispatch({ type: 'zoomLive', zoom: 1, x: 1, y: 0 });
    expect(engine.current.liveZoom).toMatchObject({ zoom: 1, x: 0 });
    // Reset: back to the picture's kept look.
    engine.dispatch({ type: 'resetLiveZoom' });
    expect(engine.current.liveZoom).toMatchObject({ zoom: 1.5, x: 0, y: 0 });
    // The next slide is shown as kept: the live zoom ends with its showing.
    engine.dispatch({ type: 'zoomLive', zoom: 2, x: 0, y: 0 });
    engine.dispatch({ type: 'next' });
    expect(engine.current.liveZoom).toBeNull();
  });

  it('zooms a background picture too; with no picture up there is nothing to zoom', () => {
    const { engine } = setup();
    expect(engine.dispatch({ type: 'zoomLive', zoom: 2, x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: 'no-picture',
    });
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'm3', media: 'image', fit: 'fit', loop: false },
    });
    expect(engine.dispatch({ type: 'zoomLive', zoom: 2, x: 0, y: 0 })).toMatchObject({ ok: true });
    expect(engine.current.liveZoom?.mediaId).toBe('m3');
    expect(engine.current.liveZoom?.showing.startsWith('bg:')).toBe(true);
    engine.dispatch({ type: 'clearLayer', layer: 'background' });
    expect(engine.current.liveZoom).toBeNull();
  });

  it('ends when its look is kept; Simple Mode never zooms', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    engine.dispatch({ type: 'zoomLive', zoom: 2, x: 0, y: 0 });
    engine.clearLiveZoom();
    expect(engine.current.liveZoom).toBeNull();
    const simple = setup(true);
    simple.engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(simple.engine.dispatch({ type: 'zoomLive', zoom: 2, x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
    expect(simple.engine.current.liveZoom).toBeNull();
  });
});
