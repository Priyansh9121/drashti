import { describe, expect, it } from 'vitest';
import { ENGINE_STATE_VERSION, readsEngineVersion } from '../../shared/engine/state';
import type { MediaElement, RenderSlide } from '../../shared/model';
import type { ShapeOverride } from '../../shared/video-shape';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * Sound and picture…'s Shape in the engine (alpha.20, x55, slice 6b): the shapes of the videos on the screens and
 * coming next are stamped by media id, as the pictures carry their looks, so every screen, node and the stream draws
 * them alike; a video as its file says is left out, and with none the state has none. A Shape changed while it is up is
 * stamped again at once. Placeholder ids only.
 */

const video = (id: string, mediaId: string): MediaElement => ({
  id,
  kind: 'video',
  mediaId,
  frame: { x: 0, y: 0, width: 640, height: 360 },
  fit: 'fit',
  loop: true,
});

/** A slide with these videos under its words. */
function slideWith(id: string, ...media: MediaElement[]): RenderSlide {
  const words = textSlide(id, 'Placeholder words');
  return { ...words, elements: [...media, ...words.elements] };
}

function setup() {
  const shapes: Record<string, ShapeOverride> = {};
  const source = makeSource();
  source.set('shaped', [
    slideWith('s1', video('e1', 'on-slide')),
    slideWith('s2', video('e2', 'next-slide'), video('e3', 'plain')),
  ]);
  const engine = new ShowEngine(source, new RecordingTransport(), () => 1_000_000, undefined, {
    mediaLength: () => 60_000,
    mediaKind: () => 'video',
    videoShape: (id) => shapes[id] ?? null,
  });
  return { engine, shapes };
}

const background = (mediaId: string) =>
  ({
    type: 'setBackground',
    background: { kind: 'media', mediaId, media: 'video', fit: 'fit', loop: true },
  }) as const;

describe('a video’s Shape in the engine', () => {
  it('stamps the shapes of the videos up and coming next by media id: the background’s, the slide’s, the next slide’s and the box’s; a video as its file says left out', () => {
    const { engine, shapes } = setup();
    Object.assign(shapes, { back: '16:9', 'on-slide': '4:3', 'next-slide': '21:9', box: '1:1' });
    engine.dispatch(background('back'));
    engine.dispatch({ type: 'goLive', presentationId: 'shaped', slideIndex: 0 });
    engine.dispatch({ type: 'showPip', source: { kind: 'media', mediaId: 'box' } });
    expect(engine.current.videoShapes).toEqual({
      back: '16:9',
      'on-slide': '4:3',
      'next-slide': '21:9',
      box: '1:1',
    });
    // Next: the second slide up, the first gone; nothing comes after it.
    engine.dispatch({ type: 'next' });
    expect(engine.current.videoShapes).toEqual({ back: '16:9', 'next-slide': '21:9', box: '1:1' });
  });

  it('with no video of a shape of its own, the state has none', () => {
    const { engine } = setup();
    engine.dispatch(background('plain'));
    engine.dispatch({ type: 'goLive', presentationId: 'shaped', slideIndex: 0 });
    expect(engine.current).not.toHaveProperty('videoShapes');
  });

  it('a Shape changed while its video is up is stamped again at once, and as the file says again it goes', () => {
    const { engine, shapes } = setup();
    engine.dispatch(background('back'));
    expect(engine.current).not.toHaveProperty('videoShapes');
    shapes['back'] = '4:3';
    expect(engine.refreshVideoShapes()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.videoShapes).toEqual({ back: '4:3' });
    shapes['back'] = '21:9';
    expect(engine.refreshVideoShapes()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.videoShapes).toEqual({ back: '21:9' });
    delete shapes['back'];
    expect(engine.refreshVideoShapes()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.videoShapes).toEqual({});
    // Nothing new: no change.
    expect(engine.refreshVideoShapes()).toMatchObject({ ok: true, changed: false });
  });

  it('is engine state 30 (32 since Cue and crossfade), an older page or node saying it cannot draw it; a state 29 or 30 saved is read whole', () => {
    expect(ENGINE_STATE_VERSION).toBe(32);
    expect(readsEngineVersion(30)).toBe(true);
    expect(readsEngineVersion(29)).toBe(true);
  });
});
