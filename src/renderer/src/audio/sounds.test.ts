import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import type { EngineState } from '../../../shared/engine/state';
import { soundsOf } from './sounds';

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
            ],
          },
        },
      }),
    );
    expect(sounds).toEqual([
      { key: 'background:bg@1000', mediaId: 'bg', startedAt: 1000, loop: true, volume: 1 },
      { key: 'slide:p/2/v1@5000', mediaId: 'clip', startedAt: 5000, loop: false, volume: 1 },
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
