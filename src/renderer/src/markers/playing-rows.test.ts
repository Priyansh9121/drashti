import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import type { EngineState, Layers } from '../../../shared/engine/state';
import type { MediaElement } from '../../../shared/model';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import { barNow, playingRows } from './playing-rows';

/*
 * The time bar's rows (Session 54): one for each thing playing, in the same order and words under LIVE and on a
 * phone, each where every screen has it at a moment.
 */

const video = (id: string, mediaId: string, loop = false): MediaElement => ({
  id,
  kind: 'video',
  frame: { x: 0, y: 0, width: 10, height: 10 },
  mediaId,
  fit: 'fit',
  loop,
});

function state(layers: Partial<Layers>, more: Partial<EngineState> = {}): EngineState {
  const s = initialEngineState();
  return { ...s, ...more, layers: { ...s.layers, ...layers } };
}

const everything = state(
  {
    background: {
      kind: 'media',
      mediaId: 'bg',
      media: 'video',
      fit: 'fill',
      loop: false,
      startedAt: 0,
      durationMs: 60_000,
      clip: { startMs: 10_000, endMs: 40_000 },
      marks: [{ id: 'm1', name: 'Placeholder chorus', atMs: 20_000 }],
    },
    slide: {
      presentationId: 'p',
      slideIndex: 0,
      shownAt: 1000,
      notes: '',
      seeks: { b: { at: 5000, toMs: 2500, paused: true } },
      slide: {
        id: 's',
        width: 1920,
        height: 1080,
        background: null,
        elements: [video('v1', 'a', true), video('v2', 'b'), video('v3', 'a')],
      },
    },
    pip: {
      source: { kind: 'media', mediaId: 'boxed', media: 'video' },
      place: DEFAULT_PIP_PLACE,
      swapped: false,
      shownAt: 2000,
    },
    audio: {
      id: 'music:pl',
      title: 'Placeholder track',
      mediaId: 'tune',
      volume: 1,
      loop: false,
      startedAt: 0,
      durationMs: 90_000,
      pausedAtMs: 30_000,
      music: { playlistId: 'pl', name: 'Placeholder', tracks: [], index: 0, loop: false, shuffle: false },
    },
  },
  { videoFiles: { a: { durationMs: 8000 }, b: { durationMs: 20_000 }, boxed: { durationMs: 12_000 } } },
);

describe('the time bar’s rows', () => {
  it('are, in order: the background video, the slide’s videos (each file once), the box’s video, then the sound or the music', () => {
    const rows = playingRows(everything);
    expect(rows.map((r) => [r.which, r.short, r.name])).toEqual([
      ['background', 'Background', 'Time of the background video'],
      ['slide:a', 'Slide video 1', 'Time of video 1 on the slide'],
      ['slide:b', 'Slide video 2', 'Time of video 2 on the slide'],
      ['pip', 'Box video', 'Time of the video in the picture-in-picture box'],
      ['audio', 'Music', 'Time of the music playing'],
    ]);
    // Never the names of the rows of skips and markers beside them (LIVE's, Session 50; a phone's, D5): a screen
    // reader tells them apart (Session 54's review).
    for (const r of rows) expect(['The background video', 'The sound playing']).not.toContain(r.name);
    // A picture, a colour, the slides in the box and a sound with no file have none; nothing up, none at all.
    expect(playingRows(initialEngineState())).toEqual([]);
    expect(
      playingRows(
        state({
          background: { kind: 'color', color: '#000000' },
          pip: { source: { kind: 'slides' }, place: DEFAULT_PIP_PLACE, swapped: false, shownAt: 1 },
          audio: { id: 'x', title: 'Silent', mediaId: null, volume: 1, loop: false, startedAt: 9 },
        }),
      ),
    ).toEqual([]);
    const sound = {
      id: 'x',
      title: 'Placeholder sound',
      mediaId: 'tone',
      volume: 1,
      loop: false,
      startedAt: 9,
    };
    expect(playingRows(state({ audio: sound }))[0]).toMatchObject({
      short: 'Sound',
      name: 'Time of the sound playing',
    });
  });

  it('are each kept for one playing of one file: another file, another showing or another track is a new row, so a drag held on one never lands on the next (Session 54’s review)', () => {
    expect(playingRows(everything).map((r) => r.key)).toEqual([
      'background:bg@0',
      'slide:a@1000',
      'slide:b@1000',
      'pip:boxed@2000',
      'music:pl#0:tune',
    ]);
    const audio = everything.layers.audio;
    if (!audio?.music) throw new Error('no music');
    const keyOf = (a: typeof audio) => playingRows(state({ audio: a })).at(-1)?.key;
    // The next track: a new row. The same track played on after a pause (a new start time): the same row.
    const next = { ...audio, mediaId: 'tune-2', startedAt: 90_000, music: { ...audio.music, index: 1 } };
    expect(keyOf(next)).toBe('music:pl#1:tune-2');
    const { pausedAtMs: _paused, ...playingOn } = audio;
    expect(keyOf({ ...playingOn, startedAt: 70_000 })).toBe(keyOf(audio));
    // A single sound: by its file and when it started; its own pause and Play (a jump) keep it.
    const sound = {
      id: 'x',
      title: 'Placeholder sound',
      mediaId: 'tone',
      volume: 1,
      loop: false,
      startedAt: 9,
    };
    expect(keyOf(sound)).toBe('audio:tone@9');
    expect(keyOf({ ...sound, seek: { at: 50, toMs: 20, paused: true } })).toBe('audio:tone@9');
    expect(keyOf({ ...sound, startedAt: 99 })).toBe('audio:tone@99');
  });

  it('are where every screen has them: between their points, paused where they wait, and held at an end point', () => {
    const [bg, a, b, box, music] = playingRows(everything);
    if (!bg || !a || !b || !box || !music) throw new Error('rows missing');
    // The background plays once from its start point (0:10): 15 s on, at 0:25; 45 s on, held at its end point.
    expect(barNow(bg.playing, 15_000)).toEqual({
      atMs: 25_000,
      durationMs: 60_000,
      startMs: 10_000,
      endMs: 40_000,
      ended: false,
    });
    expect(barNow(bg.playing, 45_000)).toMatchObject({ atMs: 40_000, ended: true });
    expect(bg.playing.marks).toEqual([{ id: 'm1', name: 'Placeholder chorus', atMs: 20_000 }]);
    // A looping slide video goes round; a paused one waits; the box's always goes round.
    expect(barNow(a.playing, 10_000)).toMatchObject({ atMs: 1000, durationMs: 8000, ended: false });
    expect(b.playing.paused).toBe(true);
    expect(barNow(b.playing, 99_000)).toMatchObject({ atMs: 2500, ended: false });
    expect(barNow(box.playing, 2000 + 30_000)).toMatchObject({ atMs: 6000, durationMs: 12_000 });
    // A paused track waits where it is; a track never ends here (the next one comes).
    expect(music.playing.paused).toBe(true);
    expect(barNow(music.playing, 500_000)).toMatchObject({ atMs: 30_000, ended: false });
  });

  it('wait, with no length, until a screen has said how long the file is', () => {
    const [, a] = playingRows({ ...everything, videoFiles: null });
    if (!a) throw new Error('no row');
    expect(barNow(a.playing, 10_000)).toEqual({
      atMs: 0,
      durationMs: null,
      startMs: 0,
      endMs: null,
      ended: false,
    });
  });
});
