import { describe, expect, it } from 'vitest';
import { initialEngineState, type EngineState } from '../shared/engine/state';
import { AGAIN_MS, filesUp, KeepsFailing, keptFailingNotice, stillUpOn } from './keeps-failing';

/*
 * A page that keeps failing on a video up (x53; the owner's Q60-31 bug hunt, x52's show-stoppers; his Q60-50 A): failing
 * again within a minute with a video up that was up the time before, the newest such is the one to take off. Placeholder
 * ids only.
 */

const up = (mediaId: string, since: number) => ({ mediaId, since });

describe('KeepsFailing', () => {
  it('its first failure takes nothing off: a reload may cure it', () => {
    const k = new KeepsFailing();
    expect(k.failed('operator', 1000, [up('placeholder-video', 500)])).toBeNull();
  });

  it('failing again within a minute with the same video up: that video', () => {
    const k = new KeepsFailing();
    k.failed('operator', 1000, [up('placeholder-video', 500)]);
    expect(k.failed('operator', 2500, [up('placeholder-video', 500)])).toBe('placeholder-video');
  });

  it('the newest of those up both times, the likeliest cause; one up only now is not blamed', () => {
    const k = new KeepsFailing();
    k.failed('audio player', 1000, [up('placeholder-long', 100), up('placeholder-new', 900)]);
    expect(
      k.failed('audio player', 2000, [
        up('placeholder-long', 100),
        up('placeholder-new', 900),
        up('placeholder-later', 1500),
      ]),
    ).toBe('placeholder-new');
    // Failing again with that one off: the next, if it was up the time before too.
    expect(k.failed('audio player', 3000, [up('placeholder-long', 100), up('placeholder-later', 1500)])).toBe(
      'placeholder-later',
    );
  });

  it('more than a minute apart, or nothing up both times: nothing to blame', () => {
    const k = new KeepsFailing();
    k.failed('output "Placeholder Hall"', 1000, [up('placeholder-video', 500)]);
    expect(
      k.failed('output "Placeholder Hall"', 1000 + AGAIN_MS + 1, [up('placeholder-video', 500)]),
    ).toBeNull();
    expect(k.failed('output "Placeholder Hall"', 1000 + AGAIN_MS + 2, [])).toBeNull();
    expect(
      k.failed('output "Placeholder Hall"', 1000 + AGAIN_MS + 3, [up('placeholder-other', 9)]),
    ).toBeNull();
  });

  it('each page counts its own failures, and one closed is forgotten', () => {
    const k = new KeepsFailing();
    k.failed('operator', 1000, [up('placeholder-video', 500)]);
    expect(k.failed('audio player', 1500, [up('placeholder-video', 500)])).toBeNull();
    k.forget('operator');
    expect(k.failed('operator', 2000, [up('placeholder-video', 500)])).toBeNull();
  });
});

describe('what a page loads, and where a file still is', () => {
  const withMusic = (): EngineState => {
    const s = initialEngineState();
    return {
      ...s,
      layers: {
        ...s.layers,
        background: {
          kind: 'media',
          mediaId: 'placeholder-background',
          media: 'video',
          fit: 'fill',
          loop: false,
          startedAt: 2000,
        },
        audio: {
          id: 'placeholder-cue',
          title: 'Placeholder music',
          mediaId: 'placeholder-music',
          volume: 1,
          loop: true,
          startedAt: 3000,
        },
      },
    };
  };

  it('a screen or LIVE loads the videos; the sound player the music too (Q60-52 A)', () => {
    expect(filesUp(withMusic(), false)).toEqual([{ mediaId: 'placeholder-background', since: 2000 }]);
    expect(filesUp(withMusic(), true)).toEqual([
      { mediaId: 'placeholder-background', since: 2000 },
      { mediaId: 'placeholder-music', since: 3000 },
    ]);
    expect(filesUp(initialEngineState(), true)).toEqual([]);
  });

  it('the music is still up on the audio layer; the background video is not on the slide or the audio layer', () => {
    expect(stillUpOn(withMusic(), 'placeholder-music')).toBe('audio');
    expect(stillUpOn(withMusic(), 'placeholder-background')).toBeNull();
    expect(stillUpOn(withMusic(), 'placeholder-gone')).toBeNull();
  });

  it('a video paused on the slide up is still up there: its slide is what to take off (Q60-52 A)', () => {
    const s = initialEngineState();
    const onSlide: EngineState = {
      ...s,
      layers: {
        ...s.layers,
        slide: {
          presentationId: 'placeholder-deck',
          slideIndex: 0,
          shownAt: 1000,
          notes: '',
          seeks: { 'placeholder-slide-video': { at: 2000, toMs: 1000, paused: true } },
          slide: {
            id: 'placeholder-slide',
            width: 1920,
            height: 1080,
            background: null,
            elements: [
              {
                id: 'placeholder-video',
                kind: 'video',
                mediaId: 'placeholder-slide-video',
                frame: { x: 0, y: 0, width: 1920, height: 1080 },
                fit: 'fill',
                loop: true,
              },
            ],
          },
        },
      },
    };
    expect(stillUpOn(onSlide, 'placeholder-slide-video')).toBe('slide');
    expect(filesUp(onSlide, false)).toEqual([{ mediaId: 'placeholder-slide-video', since: 1000 }]);
  });

  it('says what came off with the file, and where it failed', () => {
    expect(keptFailingNotice('Placeholder video.mp4', 'LIVE', 'slide')).toBe(
      '“Placeholder video.mp4” could not play on LIVE, so its slide came off. If it happens again, the file may be damaged: tell whoever looks after Drashti.',
    );
    expect(keptFailingNotice('Placeholder music.wav', 'Drashti’s sound player', 'audio')).toBe(
      '“Placeholder music.wav” could not play on Drashti’s sound player, so it came off. If it happens again, the file may be damaged: tell whoever looks after Drashti.',
    );
  });
});
