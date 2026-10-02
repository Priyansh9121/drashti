import { describe, expect, it } from 'vitest';
import type { SlideCue } from '../../shared/library';
import type { Transition } from '../../shared/model';
import { ShowEngine } from './show-engine';
import { MemorySlideSource } from './slide-source';
import { RecordingTransport, textSlide } from './testing';

/*
 * Transitions in the engine: each slide comes on as it says, else as its
 * presentation says, else as Drashti's default; the outputs time a
 * dissolve from the slide's shownAt, and a background the slide brings
 * fades with it.
 */

const dissolve = (durationMs: number): Transition => ({ kind: 'dissolve', durationMs });
const bg = (mediaId: string): SlideCue => ({
  kind: 'background',
  label: '',
  name: mediaId,
  missing: false,
  unplayable: null,
  background: { kind: 'media', mediaId, media: 'image', fit: 'fill', loop: false },
});

function setup(appDefault: Transition = { kind: 'cut', durationMs: 0 }) {
  const source = new MemorySlideSource();
  source.set(
    'p',
    [textSlide('a', 'One'), textSlide('b', 'Two'), textSlide('c', 'Three'), textSlide('d', 'Four')],
    [[bg('pic-1')], [bg('pic-1')], [bg('pic-2')], []],
    { transitions: [null, dissolve(1500), null, { kind: 'cut', durationMs: 0 }], transition: dissolve(600) },
  );
  source.set('plain', [textSlide('x', 'Plain'), textSlide('y', 'Plain two')]);
  let clock = 10_000;
  let fallback = appDefault;
  const engine = new ShowEngine(source, new RecordingTransport(), () => (clock += 10), undefined, {
    defaultTransition: () => fallback,
  });
  return {
    engine,
    source,
    setDefault: (t: Transition) => {
      fallback = t;
    },
  };
}

describe('transitions', () => {
  it('come from the slide, else the presentation, else Drashti’s default; a cut is left out', () => {
    const { engine, setDefault } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 0 });
    expect(engine.current.layers.slide?.transition).toEqual(dissolve(600));
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide?.transition).toEqual(dissolve(1500));
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 3 });
    expect(engine.current.layers.slide).not.toHaveProperty('transition');
    // A presentation with none of its own: Drashti's default (a cut until it is changed).
    engine.dispatch({ type: 'goLive', presentationId: 'plain', slideIndex: 0 });
    expect(engine.current.layers.slide).not.toHaveProperty('transition');
    setDefault(dissolve(900));
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide?.transition).toEqual(dissolve(900));
  });

  it('fade a background the slide brings with it, from the same moment; the same file carries on', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 0 });
    const first = engine.current;
    const layer = first.layers.background;
    expect(layer).toMatchObject({
      mediaId: 'pic-1',
      fade: { at: first.layers.slide?.shownAt, durationMs: 600 },
    });
    engine.dispatch({ type: 'next' });
    // The same picture: it carries on (same start, nothing new to fade).
    expect(engine.current.layers.background).toEqual(layer);
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.background).toMatchObject({
      mediaId: 'pic-2',
      fade: { at: engine.current.layers.slide?.shownAt, durationMs: 600 },
    });
    // The operator's own background change is not part of a slide: it does not fade.
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'pic-3', media: 'image', fit: 'fit', loop: false },
    });
    expect(engine.current.layers.background).not.toHaveProperty('fade');
  });

  it('do not run again when the live slide is refreshed or put back after a restart', () => {
    const { engine, source } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 1 });
    const shown = engine.current.layers.slide;
    // An edit to the live slide: new content, the same time and transition (outputs do not fade again).
    source.set(
      'p',
      [textSlide('a', 'One'), textSlide('b', 'Two, edited'), textSlide('c', 'Three'), textSlide('d', 'Four')],
      [[], [], [], []],
      { transitions: [null, { kind: 'cut', durationMs: 0 }, null, null], transition: null },
    );
    engine.refreshLive('p');
    expect(engine.current.layers.slide).toMatchObject({
      shownAt: shown?.shownAt,
      transition: dissolve(1500),
      slide: { elements: [{ text: 'Two, edited' }] },
    });
    // After a restart the slide is simply there.
    const fresh = setup();
    fresh.engine.restore({
      slide: { presentationId: 'p', slideIndex: 1 },
      background: null,
      blackout: false,
    });
    expect(fresh.engine.current.layers.slide).not.toHaveProperty('transition');
  });
});
