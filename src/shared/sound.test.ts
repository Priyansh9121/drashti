import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from './engine/state';
import type { RenderSlide } from './model';
import {
  EVEN_LOUDNESS_LUFS,
  evenGainDb,
  gainOf,
  gainOfDb,
  MUSIC_ASIDE_DB,
  musicAside,
  soundFilesOf,
  StepAside,
} from './sound';

/*
 * Session 55, Part 7: even loudness's gain (the owner's idea L) and the music stepping aside under a video with sound
 * (K), as the engine's state says them and both pages that play sound (the hall's audio player, the stream's page)
 * work them out. Made-up media ids only.
 */

describe('even loudness', () => {
  it('plays every file at −16 LUFS: louder ones down, quieter ones up as far as they stay clean', () => {
    expect(EVEN_LOUDNESS_LUFS).toBe(-16);
    // Music mastered loud comes down by what it is louder.
    expect(evenGainDb({ lufs: -9, peak: -0.1 })).toBe(-7);
    // A quiet talk comes up to the level, its loudest moment still under −1 dBTP.
    expect(evenGainDb({ lufs: -26, peak: -12 })).toBe(10);
    // Up only as far as its loudest moment stays clean.
    expect(evenGainDb({ lufs: -26, peak: -3 })).toBe(2);
    // Never more than 12 dB.
    expect(evenGainDb({ lufs: -40, peak: -30 })).toBe(12);
    // A peak not known: never up.
    expect(evenGainDb({ lufs: -20, peak: null })).toBe(0);
    // At the level already, and no sound (or only silence): as it is.
    expect(evenGainDb({ lufs: -16, peak: -1 })).toBe(0);
    expect(evenGainDb({ lufs: null, peak: null })).toBe(0);
    expect(evenGainDb({ lufs: -70, peak: -60 })).toBe(0);
    expect(gainOfDb(-6)).toBeCloseTo(0.501, 3);
    expect(gainOfDb(0)).toBe(1);
  });

  it("each file's gain from the engine's state, 1 when it says none", () => {
    const state = { sound: { stepsAside: true, gains: { loud: 0.447 }, silent: [] } };
    expect(gainOf(state, 'loud')).toBe(0.447);
    expect(gainOf(state, 'other')).toBe(1);
    expect(gainOf({}, 'loud')).toBe(1);
    expect(gainOf(null, 'loud')).toBe(1);
  });
});

/** A slide with one video on it. */
const videoSlide = (mediaId: string, more: { volume?: number; loop?: boolean } = {}): RenderSlide => ({
  id: 's1',
  width: 1920,
  height: 1080,
  background: '#000000',
  elements: [
    {
      id: 'v1',
      kind: 'video',
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
      mediaId,
      fit: 'fit',
      ...more,
    },
  ],
});

const T0 = 1_000_000;

/** Music on the audio layer since T0, and what else is up. */
function withMusic(over: Partial<EngineState['layers']> = {}, rest: Partial<EngineState> = {}): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    ...rest,
    layers: {
      ...state.layers,
      audio: {
        id: 'music:pl',
        title: 'Placeholder track',
        mediaId: 'track',
        volume: 1,
        loop: false,
        startedAt: T0,
        music: {
          playlistId: 'pl',
          name: 'Placeholder music',
          tracks: [{ mediaId: 'track', title: 'Placeholder track' }],
          index: 0,
          loop: true,
          shuffle: false,
        },
      },
      ...over,
    },
  };
}

/** A video as the background from `startedAt`, 10 s long. */
const videoBackground = (startedAt: number, more: Record<string, unknown> = {}) => ({
  kind: 'media' as const,
  mediaId: 'clip',
  media: 'video' as const,
  fit: 'fit' as const,
  loop: false,
  startedAt,
  durationMs: 10_000,
  ...more,
});

describe('music steps aside under a video with sound', () => {
  it('while a background video plays: from its start to its end, not while paused, not for one with no sound', () => {
    const state = withMusic({ background: videoBackground(T0 + 5000) });
    expect(musicAside(state, T0 + 4000)).toBe(false);
    expect(musicAside(state, T0 + 5000)).toBe(true);
    expect(musicAside(state, T0 + 14_999)).toBe(true);
    // Ended (it holds its last picture): back up.
    expect(musicAside(state, T0 + 15_000)).toBe(false);
    // Paused by the time bar.
    const paused = withMusic({
      background: videoBackground(T0, { seek: { at: T0 + 1000, toMs: 1000, paused: true } }),
    });
    expect(musicAside(paused, T0 + 2000)).toBe(false);
    // A video with no sound of its own, as the sound pass found.
    const quiet = withMusic(
      { background: videoBackground(T0) },
      { sound: { stepsAside: true, gains: {}, silent: ['clip'] } },
    );
    expect(musicAside(quiet, T0 + 1000)).toBe(false);
    // A video going round, and one whose length is not known yet, play on.
    expect(musicAside(withMusic({ background: videoBackground(T0, { loop: true }) }), T0 + 60_000)).toBe(
      true,
    );
    expect(
      musicAside(withMusic({ background: videoBackground(T0, { durationMs: undefined }) }), T0 + 60_000),
    ).toBe(true);
  });

  it('while a video on the slide up plays with its sound, not one turned right down', () => {
    const slide = (s: RenderSlide) => ({
      presentationId: 'p',
      slideIndex: 0,
      slide: s,
      shownAt: T0,
      notes: '',
    });
    const heard = withMusic(
      { slide: slide(videoSlide('clip')) },
      { videoFiles: { clip: { durationMs: 10_000 } } },
    );
    expect(musicAside(heard, T0 + 1000)).toBe(true);
    expect(musicAside(heard, T0 + 11_000)).toBe(false);
    const down = withMusic({ slide: slide(videoSlide('clip', { volume: 0 })) });
    expect(musicAside(down, T0 + 1000)).toBe(false);
  });

  it('never with the switch off, with no music, the music paused, or a deck’s own sound across its slides', () => {
    const bg = { background: videoBackground(T0) };
    expect(
      musicAside(withMusic(bg, { sound: { stepsAside: false, gains: {}, silent: [] } }), T0 + 1000),
    ).toBe(false);
    const none = withMusic(bg);
    expect(musicAside({ ...none, layers: { ...none.layers, audio: null } }, T0 + 1000)).toBe(false);
    const paused = withMusic(bg);
    const audio = paused.layers.audio;
    if (!audio) throw new Error('no music');
    expect(
      musicAside({ ...paused, layers: { ...paused.layers, audio: { ...audio, pausedAtMs: 500 } } }, T0),
    ).toBe(false);
    const across = { ...audio, music: undefined, across: { presentationId: 'deck', lastIndex: 3 } };
    expect(musicAside({ ...paused, layers: { ...paused.layers, audio: across } }, T0 + 1000)).toBe(false);
    // Drashti stopped: no sound at all.
    expect(musicAside(withMusic(bg, { stopped: { at: T0 } }), T0 + 1000)).toBe(false);
  });

  it('under a slide’s or a deck’s own sound playing over it, until that ends (the owner’s answer of 30 Oct)', () => {
    const base = withMusic();
    const audio = base.layers.audio;
    if (!audio) throw new Error('no music');
    const over = {
      id: 'cue',
      title: 'Placeholder cue',
      mediaId: 'cue',
      volume: 0.8,
      loop: false,
      startedAt: T0 + 1000,
      durationMs: 4000,
    };
    const up = (o: typeof over & Record<string, unknown>, rest: Partial<EngineState> = {}) => ({
      ...base,
      ...rest,
      layers: { ...base.layers, audio: { ...audio, over: o } },
    });
    expect(musicAside(up(over), T0 + 500)).toBe(false);
    expect(musicAside(up(over), T0 + 2000)).toBe(true);
    // Played to its end: the music comes back up.
    expect(musicAside(up(over), T0 + 5000)).toBe(false);
    // Going round, it is there until cleared or replaced.
    expect(musicAside(up({ ...over, loop: true }), T0 + 60_000)).toBe(true);
    // Audio's switch off: the music stays as it is.
    expect(musicAside(up(over, { sound: { stepsAside: false, gains: {}, silent: [] } }), T0 + 2000)).toBe(
      false,
    );
    // Its file among those sounding (its even gain too).
    expect(soundFilesOf(up(over)).sort()).toEqual(['cue', 'track']);
  });

  it('fades down evenly over about a second, never stopping, and back up as evenly', () => {
    const aside = new StepAside();
    // First asked while a video plays: already aside.
    expect(aside.levelAt(true, 0)).toBeCloseTo(gainOfDb(MUSIC_ASIDE_DB), 5);
    const again = new StepAside();
    expect(again.levelAt(false, 0)).toBe(1);
    expect(again.levelAt(true, 500)).toBeCloseTo(gainOfDb(MUSIC_ASIDE_DB / 2), 5);
    expect(again.levelAt(true, 1000)).toBeCloseTo(gainOfDb(MUSIC_ASIDE_DB), 5);
    expect(again.levelAt(true, 5000)).toBeCloseTo(0.2, 1);
    expect(again.levelAt(false, 5250)).toBeCloseTo(gainOfDb((MUSIC_ASIDE_DB * 3) / 4), 5);
    expect(again.levelAt(false, 6000)).toBe(1);
  });
});

describe('the files sounding now', () => {
  it('are the sound, the background video and the slide’s videos, each once', () => {
    const state = withMusic({
      background: videoBackground(T0),
      slide: { presentationId: 'p', slideIndex: 0, slide: videoSlide('clip'), shownAt: T0, notes: '' },
    });
    expect(soundFilesOf(state).sort()).toEqual(['clip', 'track']);
  });
});
