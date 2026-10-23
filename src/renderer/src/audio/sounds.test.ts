import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import type { EngineState } from '../../../shared/engine/state';
import { type Sound, soundMoved, soundsOf } from './sounds';

function state(patch: Partial<EngineState['layers']>, blackout = false): EngineState {
  const s = initialEngineState();
  return { ...s, blackout, layers: { ...s.layers, ...patch } };
}

describe('the sounds the show makes', () => {
  it('plays a background video and videos on the live slide, each from when it started', () => {
    const sounds = soundsOf(
      state({
        background: {
          kind: 'media',
          mediaId: 'bg',
          media: 'video',
          fit: 'fill',
          loop: true,
          startedAt: 1000,
        },
        slide: {
          presentationId: 'p',
          slideIndex: 2,
          shownAt: 5000,
          notes: '',
          slide: {
            id: 's',
            width: 1920,
            height: 1080,
            background: null,
            elements: [
              {
                id: 'v1',
                kind: 'video',
                frame: { x: 0, y: 0, width: 10, height: 10 },
                mediaId: 'clip',
                fit: 'fit',
              },
              {
                id: 'i1',
                kind: 'image',
                frame: { x: 0, y: 0, width: 10, height: 10 },
                mediaId: 'logo',
                fit: 'fit',
              },
              // Quieter, and one whose sound is turned right down.
              {
                id: 'v2',
                kind: 'video',
                frame: { x: 0, y: 0, width: 10, height: 10 },
                mediaId: 'quiet',
                fit: 'fit',
                volume: 0.25,
              },
              {
                id: 'v3',
                kind: 'video',
                frame: { x: 0, y: 0, width: 10, height: 10 },
                mediaId: 'silent',
                fit: 'fit',
                volume: 0,
              },
            ],
          },
        },
      }),
    );
    expect(sounds).toEqual([
      { key: 'background:bg@1000', mediaId: 'bg', startedAt: 1000, loop: true, volume: 1 },
      { key: 'slide:s/v1@5000', mediaId: 'clip', startedAt: 5000, loop: false, volume: 1 },
      { key: 'slide:s/v2@5000', mediaId: 'quiet', startedAt: 5000, loop: false, volume: 0.25 },
    ]);
  });

  it('plays a slide video’s sound between its file’s start and end points, as its picture plays (Session 52)', () => {
    const clip = (id: string, mediaId: string, loop?: boolean) =>
      ({
        id,
        kind: 'video',
        frame: { x: 0, y: 0, width: 10, height: 10 },
        mediaId,
        fit: 'fit',
        ...(loop === undefined ? {} : { loop }),
      }) as const;
    const sounds = soundsOf(
      state({
        slide: {
          presentationId: 'p',
          slideIndex: 0,
          shownAt: 5000,
          notes: '',
          clips: { chorus: { startMs: 2000, endMs: 6000 } },
          slide: {
            id: 's',
            width: 1920,
            height: 1080,
            background: null,
            elements: [clip('v1', 'chorus', true), clip('v2', 'whole')],
          },
        },
      }),
    );
    expect(sounds).toEqual([
      {
        key: 'slide:s/v1@5000',
        mediaId: 'chorus',
        startedAt: 5000,
        loop: true,
        volume: 1,
        clip: { startMs: 2000, endMs: 6000 },
      },
      // A file without points: the whole of it, as before.
      { key: 'slide:s/v2@5000', mediaId: 'whole', startedAt: 5000, loop: false, volume: 1 },
    ]);
  });

  it('plays the audio layer with its volume and looping', () => {
    expect(
      soundsOf(
        state({ audio: { id: 'x', title: 'Dhun', mediaId: 'dhun', volume: 0.4, loop: true, startedAt: 9 } }),
      ),
    ).toEqual([{ key: 'audio:dhun@9', mediaId: 'dhun', startedAt: 9, loop: true, volume: 0.4 }]);
    expect(
      soundsOf(
        state({ audio: { id: 'x', title: 'Silent', mediaId: null, volume: 1, loop: false, startedAt: 9 } }),
      ),
    ).toEqual([]);
  });

  it('makes no sound for images, and keeps sound through black-out', () => {
    expect(
      soundsOf(
        state({
          background: {
            kind: 'media',
            mediaId: 'bg',
            media: 'image',
            fit: 'fill',
            loop: false,
            startedAt: 1,
          },
        }),
      ),
    ).toEqual([]);
    const bg = {
      kind: 'media',
      mediaId: 'bg',
      media: 'video',
      fit: 'fill',
      loop: true,
      startedAt: 1,
    } as const;
    expect(soundsOf(state({ background: bg }, true))).toHaveLength(1);
  });
});

describe('a sound the engine sends somewhere new while it plays (Session 52)', () => {
  /** A play-once background video's sound, 1 s into its file to begin with. */
  const playing: Sound = {
    key: 'background:bg@1000',
    mediaId: 'bg',
    startedAt: 1000,
    loop: false,
    volume: 1,
    clip: { startMs: 1000, endMs: null },
  };

  it('is checked again at a jump, as before', () => {
    expect(soundMoved(playing, { ...playing, seek: { at: 4000, toMs: 20_000 } })).toBe(true);
    const jumped = { ...playing, seek: { at: 4000, toMs: 20_000 } };
    expect(soundMoved(jumped, { ...jumped, seek: { at: 9000, toMs: 20_000 } })).toBe(true);
    expect(soundMoved(jumped, { ...jumped, seek: { at: 4000, toMs: 20_000 } })).toBe(false);
  });

  it('is checked again when its start or end point moves, as its picture is on every screen', () => {
    // A start point moved 0.2 s while it plays: every screen's picture lands there by a jump (BackgroundMedia.tsx,
    // SlideView.tsx); the sound, not asked, stayed 0.2 s off it, short of the half second that makes a sound jump,
    // easing back at 2% a second for 10 s.
    expect(soundMoved(playing, { ...playing, clip: { startMs: 1200, endMs: null } }), 'a new start').toBe(
      true,
    );
    expect(soundMoved(playing, { ...playing, clip: { startMs: 1000, endMs: 8000 } }), 'a new end').toBe(true);
    const { clip: _points, ...whole } = playing;
    expect(soundMoved(playing, whole), 'its points taken away').toBe(true);
    expect(soundMoved(whole, playing), 'points given').toBe(true);
    // The same points, in a new copy of the state: nothing moved.
    expect(soundMoved(playing, { ...playing, clip: { startMs: 1000, endMs: null } })).toBe(false);
    expect(soundMoved(playing, { ...playing, volume: 0.5, loop: true })).toBe(false);
  });
});
