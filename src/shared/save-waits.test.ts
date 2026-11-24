import { describe, expect, it } from 'vitest';
import type { EngineState, Layers, SlideLayer } from './engine/state';
import { initialEngineState, nothingUp } from './engine/state';
import { playingHolds, SAVE_WAITS, saveWaitsFor } from './save-waits';

/*
 * What holds a save (alpha.22, the owner's "Trim on a row"): only a video or a sound playing, the stream on air or a
 * recording; never a still slide, a picture, the Wallpaper over them, a message, or a paused video or sound.
 */

const OFF = { onAir: false, recording: false };
const withLayers = (layers: Partial<Layers>, more: Partial<EngineState> = {}): EngineState => {
  const state = initialEngineState();
  return { ...state, ...more, layers: { ...state.layers, ...layers } };
};
const video = (more: Record<string, unknown> = {}) =>
  ({
    kind: 'media',
    mediaId: 'placeholder-video',
    media: 'video',
    fit: 'fit',
    loop: true,
    startedAt: 1000,
    ...more,
  }) as Layers['background'];
const stillSlide = (elements: unknown[] = []) =>
  ({
    presentationId: 'placeholder-presentation',
    slideIndex: 0,
    shownAt: 1000,
    slide: { id: 'placeholder-slide', elements },
  }) as unknown as SlideLayer;

describe('what holds a save', () => {
  it('is nothing with nothing up, a still slide, a picture, the Wallpaper over a slide, or words over them', () => {
    const picture = {
      kind: 'media',
      mediaId: 'placeholder-picture',
      media: 'image',
      fit: 'fit',
      loop: false,
      startedAt: 1000,
    } as Layers['background'];
    for (const state of [
      initialEngineState(),
      withLayers({}, { wallpaper: true }),
      withLayers({ slide: stillSlide() }, { wallpaper: true }),
      withLayers({ slide: stillSlide() }),
      withLayers({ background: picture }),
      withLayers({ background: { kind: 'color', color: '#202020' } }),
      withLayers({ slide: stillSlide(), messages: [{ id: 'm', text: 'Placeholder message' }] }),
      withLayers({ background: picture }, { blackout: true }),
    ]) {
      expect(saveWaitsFor(state, OFF)).toBeNull();
    }
    // Until alpha.22 each of these (but the first two) held it: something was up (nothingUp).
    expect(nothingUp(withLayers({ slide: stillSlide() }, { wallpaper: true }).layers)).toBe(false);
  });

  it('waits while a video plays, as the background, on the slide or in the box, or a live picture is up', () => {
    expect(saveWaitsFor(withLayers({ background: video() }), OFF)).toBe(SAVE_WAITS.video);
    const onSlide = stillSlide([
      {
        id: 'v',
        kind: 'video',
        mediaId: 'placeholder-slide-video',
        frame: { x: 0, y: 0, width: 10, height: 10 },
        fit: 'fit',
      },
    ]);
    expect(saveWaitsFor(withLayers({ slide: onSlide }), OFF)).toBe(SAVE_WAITS.video);
    const input = {
      kind: 'input',
      inputId: 'placeholder-input',
      name: 'Placeholder camera',
      device: 'placeholder',
      fit: 'fit',
      startedAt: 1000,
    } as Layers['background'];
    expect(playingHolds(withLayers({ background: input }))).toBe('video');
    const box = {
      source: { kind: 'media', mediaId: 'placeholder-box-video', media: 'video' },
      place: {},
      swapped: false,
      shownAt: 1000,
    } as unknown as Layers['pip'];
    expect(playingHolds(withLayers({ pip: box }))).toBe('video');
  });

  it('waits while a video is cued for Go (Cue: paused at its first frame, about to play)', () => {
    const cued = { ...initialEngineState(), videoCue: {} as never };
    expect(saveWaitsFor(cued, OFF)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor({ ...initialEngineState(), videoCue: null }, OFF)).toBeNull();
  });

  it('goes on once the video is paused', () => {
    const paused = video({ seek: { at: 2000, toMs: 500, paused: true } });
    expect(saveWaitsFor(withLayers({ background: paused }), OFF)).toBeNull();
  });

  it('waits while a sound plays, not while it is paused', () => {
    const sound = {
      id: 'placeholder-sound',
      title: 'Placeholder tone',
      mediaId: 'placeholder-sound',
      volume: 1,
      loop: false,
      startedAt: 1000,
    } as Layers['audio'];
    expect(saveWaitsFor(withLayers({ audio: sound }), OFF)).toBe(SAVE_WAITS.sound);
    const paused = { ...sound, seek: { at: 2000, toMs: 100, paused: true } } as Layers['audio'];
    expect(saveWaitsFor(withLayers({ audio: paused }), OFF)).toBeNull();
    // A video and a sound both playing: the video is named.
    expect(saveWaitsFor(withLayers({ audio: sound, background: video() }), OFF)).toBe(SAVE_WAITS.video);
  });

  it('waits while the stream is on air or recording, first of all', () => {
    expect(saveWaitsFor(initialEngineState(), { onAir: true, recording: true })).toBe(
      'Waiting: the stream is on air',
    );
    expect(saveWaitsFor(withLayers({ background: video() }), { onAir: false, recording: true })).toBe(
      'Waiting: a recording is going on',
    );
    expect(saveWaitsFor(null, OFF)).toBeNull();
  });
});
