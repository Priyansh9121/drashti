import { describe, expect, it } from 'vitest';
import type { EngineState, Layers, SlideLayer } from './engine/state';
import { initialEngineState, nothingUp } from './engine/state';
import { END_SETTLE_MS, playingHolds, SAVE_WAITS, saveWaitEndsAt, saveWaitsFor } from './save-waits';

/*
 * What holds a save (alpha.22, the owner's "Trim on a row"): only a video or a sound playing, the stream on air or a
 * recording; never a still slide, a picture, the Wallpaper over them, a message, or a paused video or sound.
 */

const OFF = { onAir: false, recording: false };
/** A moment soon after everything here went up (at 1000): what plays then still plays. */
const NOW = 2000;
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
      expect(saveWaitsFor(state, OFF, NOW)).toBeNull();
    }
    // Until alpha.22 each of these (but the first two) held it: something was up (nothingUp).
    expect(nothingUp(withLayers({ slide: stillSlide() }, { wallpaper: true }).layers)).toBe(false);
  });

  it('waits while a video plays, as the background, on the slide or in the box, or a live picture is up', () => {
    expect(saveWaitsFor(withLayers({ background: video() }), OFF, NOW)).toBe(SAVE_WAITS.video);
    const onSlide = stillSlide([
      {
        id: 'v',
        kind: 'video',
        mediaId: 'placeholder-slide-video',
        frame: { x: 0, y: 0, width: 10, height: 10 },
        fit: 'fit',
      },
    ]);
    expect(saveWaitsFor(withLayers({ slide: onSlide }), OFF, NOW)).toBe(SAVE_WAITS.video);
    const input = {
      kind: 'input',
      inputId: 'placeholder-input',
      name: 'Placeholder camera',
      device: 'placeholder',
      fit: 'fit',
      startedAt: 1000,
    } as Layers['background'];
    expect(playingHolds(withLayers({ background: input }), NOW)).toBe('video');
    const box = {
      source: { kind: 'media', mediaId: 'placeholder-box-video', media: 'video' },
      place: {},
      swapped: false,
      shownAt: 1000,
    } as unknown as Layers['pip'];
    expect(playingHolds(withLayers({ pip: box }), NOW)).toBe('video');
  });

  it('waits while a video is cued for Go (Cue: paused at its first frame, about to play)', () => {
    const cued = { ...initialEngineState(), videoCue: {} as never };
    expect(saveWaitsFor(cued, OFF, NOW)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor({ ...initialEngineState(), videoCue: null }, OFF, NOW)).toBeNull();
  });

  it('goes on once the video is paused', () => {
    const paused = video({ seek: { at: 2000, toMs: 500, paused: true } });
    expect(saveWaitsFor(withLayers({ background: paused }), OFF, NOW)).toBeNull();
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
    expect(saveWaitsFor(withLayers({ audio: sound }), OFF, NOW)).toBe(SAVE_WAITS.sound);
    const paused = { ...sound, seek: { at: 2000, toMs: 100, paused: true } } as Layers['audio'];
    expect(saveWaitsFor(withLayers({ audio: paused }), OFF, NOW)).toBeNull();
    // A video and a sound both playing: the video is named.
    expect(saveWaitsFor(withLayers({ audio: sound, background: video() }), OFF, NOW)).toBe(SAVE_WAITS.video);
  });

  it('waits while the stream is on air or recording, first of all', () => {
    expect(saveWaitsFor(initialEngineState(), { onAir: true, recording: true }, NOW)).toBe(
      'Waiting: the stream is on air',
    );
    expect(saveWaitsFor(withLayers({ background: video() }), { onAir: false, recording: true }, NOW)).toBe(
      'Waiting: a recording is going on',
    );
    expect(saveWaitsFor(null, OFF, NOW)).toBeNull();
  });
});

/*
 * alpha.23 (the save-trim review's SHOULD-2): a video or a sound that does not go round stops playing at its end point,
 * and may stay up there: When it ends → Freeze keeps its last picture, as does no wallpaper chosen, or a slide or the
 * box over it (the engine waits for no end then). Until alpha.23 it held a save for good, saying a video is playing.
 */
describe('a video or a sound not going round, played to its end', () => {
  // A 4-second video up from 1000: it plays until 5000, then its last picture stays up.
  const once = video({ loop: false, durationMs: 4000 });
  const clipVideo = (mediaId: string, more: Record<string, unknown> = {}) => ({
    id: `element-${mediaId}`,
    kind: 'video',
    mediaId,
    frame: { x: 0, y: 0, width: 10, height: 10 },
    fit: 'fit',
    ...more,
  });

  it('holds a save while it plays, and no longer once it has played to its end and stays up', () => {
    const state = withLayers({ background: once });
    expect(saveWaitsFor(state, OFF, 4999)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor(state, OFF, 5000 + END_SETTLE_MS)).toBeNull();
    expect(saveWaitsFor(state, OFF, 3_600_000)).toBeNull();
    // A still slide over it (the engine keeps the video under the slide as it ends): the same.
    const covered = withLayers({ background: once, slide: stillSlide() }, { wallpaper: true });
    expect(saveWaitsFor(covered, OFF, 4999)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor(covered, OFF, 5000 + END_SETTLE_MS)).toBeNull();
    // The stream on air or a recording still holds it, ended or not.
    expect(saveWaitsFor(state, { onAir: true, recording: false }, 3_600_000)).toBe(SAVE_WAITS.air);
    expect(saveWaitsFor(state, { onAir: false, recording: true }, 3_600_000)).toBe(SAVE_WAITS.recording);
  });

  it('holds it a moment past its end point, when the engine’s own end comes (the next row, the wallpaper)', () => {
    const state = withLayers({ background: once });
    expect(END_SETTLE_MS).toBeGreaterThan(0);
    expect(END_SETTLE_MS).toBeLessThanOrEqual(2000);
    expect(saveWaitsFor(state, OFF, 5000)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor(state, OFF, 5000 + END_SETTLE_MS - 1)).toBe(SAVE_WAITS.video);
  });

  it('ends at its own end point, and from where it was last moved to', () => {
    // Between 2 s and 6 s of a 10-second file: 4 s from 1000.
    const clipped = video({ loop: false, durationMs: 10_000, clip: { startMs: 2000, endMs: 6000 } });
    expect(saveWaitsFor(withLayers({ background: clipped }), OFF, 4999)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor(withLayers({ background: clipped }), OFF, 5000 + END_SETTLE_MS)).toBeNull();
    // Moved to 9 s of 10 at 3000: one second left, so it ends at 4000.
    const moved = video({ loop: false, durationMs: 10_000, seek: { at: 3000, toMs: 9000 } });
    expect(saveWaitsFor(withLayers({ background: moved }), OFF, 3999)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor(withLayers({ background: moved }), OFF, 4000 + END_SETTLE_MS)).toBeNull();
    // Moved back after it ended (the time bar): it plays again, so it holds again.
    const again = video({ loop: false, durationMs: 10_000, seek: { at: 20_000, toMs: 1000 } });
    expect(saveWaitsFor(withLayers({ background: again }), OFF, 21_000)).toBe(SAVE_WAITS.video);
  });

  it('a video on the slide up that does not go round: the same, by its file’s length', () => {
    const slide = stillSlide([clipVideo('placeholder-slide-video')]);
    const files = { videoFiles: { 'placeholder-slide-video': { durationMs: 4000 } } };
    expect(saveWaitsFor(withLayers({ slide }, files), OFF, 4999)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor(withLayers({ slide }, files), OFF, 5000 + END_SETTLE_MS)).toBeNull();
    // One going round on the slide plays on.
    const round = stillSlide([clipVideo('placeholder-slide-video', { loop: true })]);
    expect(saveWaitsFor(withLayers({ slide: round }, files), OFF, 3_600_000)).toBe(SAVE_WAITS.video);
    // Two on the slide: it holds until the last has ended.
    const two = stillSlide([clipVideo('placeholder-slide-video'), clipVideo('placeholder-long-video')]);
    const both = {
      videoFiles: {
        'placeholder-slide-video': { durationMs: 4000 },
        'placeholder-long-video': { durationMs: 9000 },
      },
    };
    expect(saveWaitsFor(withLayers({ slide: two }, both), OFF, 5000 + END_SETTLE_MS)).toBe(SAVE_WAITS.video);
    expect(saveWaitsFor(withLayers({ slide: two }, both), OFF, 10_000 + END_SETTLE_MS)).toBeNull();
  });

  it('a sound played to its end no longer holds it', () => {
    const sound = {
      id: 'placeholder-sound',
      title: 'Placeholder tone',
      mediaId: 'placeholder-sound',
      volume: 1,
      loop: false,
      startedAt: 1000,
      durationMs: 3000,
    } as Layers['audio'];
    expect(saveWaitsFor(withLayers({ audio: sound }), OFF, 3999)).toBe(SAVE_WAITS.sound);
    expect(saveWaitsFor(withLayers({ audio: sound }), OFF, 4000 + END_SETTLE_MS)).toBeNull();
    // Both playing, the video is named; the video ended and a longer sound playing on, the sound is.
    expect(saveWaitsFor(withLayers({ audio: sound, background: once }), OFF, 3999)).toBe(SAVE_WAITS.video);
    const longer = { ...sound, durationMs: 60_000 } as Layers['audio'];
    expect(saveWaitsFor(withLayers({ audio: longer, background: once }), OFF, 5000 + END_SETTLE_MS)).toBe(
      SAVE_WAITS.sound,
    );
  });

  it('still holds it while its length is not known, while it goes round, and in the box (which always goes round)', () => {
    expect(saveWaitsFor(withLayers({ background: video({ loop: false }) }), OFF, 3_600_000)).toBe(
      SAVE_WAITS.video,
    );
    expect(saveWaitsFor(withLayers({ background: video({ durationMs: 4000 }) }), OFF, 3_600_000)).toBe(
      SAVE_WAITS.video,
    );
    const box = {
      source: { kind: 'media', mediaId: 'placeholder-box-video', media: 'video' },
      place: {},
      swapped: false,
      shownAt: 1000,
    } as unknown as Layers['pip'];
    const files = { videoFiles: { 'placeholder-box-video': { durationMs: 4000 } } };
    expect(playingHolds(withLayers({ pip: box }, files), 3_600_000)).toBe('video');
    // A video cued for Go still holds it.
    expect(saveWaitsFor({ ...withLayers({ background: once }), videoCue: {} as never }, OFF, 3_600_000)).toBe(
      SAVE_WAITS.video,
    );
  });
});

describe('when the waits look again by themselves (saveWaitEndsAt)', () => {
  it('is the moment the first thing playing that does not go round has played to its end, and a moment more', () => {
    const once = video({ loop: false, durationMs: 4000 });
    expect(saveWaitEndsAt(withLayers({ background: once }), 2000)).toBe(5000 + END_SETTLE_MS);
    const sound = {
      id: 'placeholder-sound',
      title: 'Placeholder tone',
      mediaId: 'placeholder-sound',
      volume: 1,
      loop: false,
      startedAt: 1000,
      durationMs: 2000,
    } as Layers['audio'];
    // The sound ends first: then (the video still holds it after).
    expect(saveWaitEndsAt(withLayers({ background: once, audio: sound }), 2000)).toBe(3000 + END_SETTLE_MS);
    // Once the sound has ended, the video's end.
    expect(saveWaitEndsAt(withLayers({ background: once, audio: sound }), 3000 + END_SETTLE_MS)).toBe(
      5000 + END_SETTLE_MS,
    );
  });

  it('is null when nothing would stop holding a save by itself', () => {
    expect(saveWaitEndsAt(initialEngineState(), 2000)).toBeNull();
    expect(saveWaitEndsAt(withLayers({ background: video() }), 2000)).toBeNull();
    expect(saveWaitEndsAt(withLayers({ background: video({ loop: false }) }), 2000)).toBeNull();
    const ended = video({ loop: false, durationMs: 4000 });
    expect(saveWaitEndsAt(withLayers({ background: ended }), 5000 + END_SETTLE_MS)).toBeNull();
    const paused = video({ loop: false, durationMs: 4000, seek: { at: 2000, toMs: 1000, paused: true } });
    expect(saveWaitEndsAt(withLayers({ background: paused }), 2000)).toBeNull();
    expect(saveWaitEndsAt(null, 2000)).toBeNull();
  });
});
