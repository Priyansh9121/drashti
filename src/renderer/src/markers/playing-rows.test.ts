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

describe('a deck’s sounds on the slide (Session 54, C2)', () => {
  it('have a row of their own after its videos, named as sounds', () => {
    const s = state({
      slide: {
        presentationId: 'p',
        slideIndex: 0,
        shownAt: 1000,
        notes: '',
        slide: {
          id: 'deck-slide',
          width: 1920,
          height: 1080,
          background: null,
          elements: [video('v', 'deck-video')],
          deck: {
            steps: [{ clipId: 'c0', clipMs: 1000, lastId: 'l0' }],
            media: [
              {
                kind: 'audio',
                mediaId: 'deck-sound',
                box: { x: 0, y: 0, w: 0.1, h: 0.1 },
                loop: false,
                volume: 1,
                start: { step: 0, offsetMs: 0 },
              },
            ],
          },
        },
      },
    });
    expect(playingRows(s).map((r) => [r.which, r.short, r.name])).toEqual([
      ['slide:deck-video', 'Slide video', 'Time of the video on the slide'],
      ['slide:deck-sound', 'Slide sound', 'Time of the sound on the slide'],
    ]);
  });

  it('one set to play across slides is the sound playing, its row the Sound’s, never also the slide’s (Session 54)', () => {
    const across = {
      kind: 'audio' as const,
      mediaId: 'music',
      box: { x: 0, y: 0, w: 0.1, h: 0.1 },
      loop: true,
      volume: 1,
      start: { step: 0, offsetMs: 0 },
      acrossSlides: 3,
    };
    const s = state(
      {
        slide: {
          presentationId: 'p',
          slideIndex: 0,
          shownAt: 1000,
          notes: '',
          slide: {
            id: 'deck-slide',
            width: 1920,
            height: 1080,
            background: null,
            elements: [],
            deck: { steps: [{ clipId: 'c0', clipMs: 1000, lastId: 'l0' }], media: [across] },
          },
        },
        audio: {
          id: 'across:music',
          title: 'Placeholder music',
          mediaId: 'music',
          volume: 1,
          loop: true,
          startedAt: 1000,
          durationMs: 90_000,
          across: { presentationId: 'p', lastIndex: 2 },
        },
      },
      { videoFiles: { music: { durationMs: 90_000 } } },
    );
    expect(playingRows(s).map((r) => [r.which, r.short, r.name])).toEqual([
      ['audio', 'Sound', 'Time of the sound playing'],
    ]);
  });
});

describe('a prop’s and the logo’s videos (Session 54, the owner’s answer of 28 Oct: every video has a bar)', () => {
  const prop = (id: string, name: string, elements: MediaElement[], shownAt = 3000) => ({
    id,
    name,
    elements,
    shownAt,
  });
  const withProps = {
    ...everything,
    layers: {
      ...everything.layers,
      props: [
        prop('p1', 'Placeholder corner', [
          video('pv1', 'corner', true),
          video('pv2', 'corner'),
          video('pv3', 'b'),
        ]),
        {
          ...prop('p2', 'Placeholder banner', [video('pv4', 'corner')]),
          seeks: { corner: { at: 3500, toMs: 900, paused: true } },
        },
      ],
    },
    logo: prop('logo', 'Placeholder logo', [video('lv', 'mark', true)], 4000),
    videoFiles: { ...everything.videoFiles, corner: { durationMs: 6000 }, mark: { durationMs: 9000 } },
  };

  it('have rows of their own after the slide’s and before the box’s: each prop’s videos, each file once a prop, then the logo’s', () => {
    expect(playingRows(withProps).map((r) => [r.which, r.short, r.name])).toEqual([
      ['background', 'Background', 'Time of the background video'],
      ['slide:a', 'Slide video 1', 'Time of video 1 on the slide'],
      ['slide:b', 'Slide video 2', 'Time of video 2 on the slide'],
      ['props:p1:corner', 'Prop video 1', 'Time of video 1 in the prop “Placeholder corner”'],
      ['props:p1:b', 'Prop video 2', 'Time of video 2 in the prop “Placeholder corner”'],
      ['props:p2:corner', 'Prop video 3', 'Time of the video in the prop “Placeholder banner”'],
      ['logo:mark', 'Logo video', 'Time of the logo’s video'],
      ['pip', 'Box video', 'Time of the video in the picture-in-picture box'],
      ['audio', 'Music', 'Time of the music playing'],
    ]);
    // One prop with one video: "Prop video", as a slide's one video is "Slide video".
    const one = {
      ...withProps,
      logo: null,
      layers: { ...withProps.layers, props: [prop('p', 'Placeholder', [video('v', 'corner')])] },
    };
    expect(playingRows(one).find((r) => r.which.startsWith('props:'))).toMatchObject({
      short: 'Prop video',
      name: 'Time of the video in the prop “Placeholder”',
    });
  });

  it('are each their own prop’s, so the same file in two props is two rows that never share a drag', () => {
    const keys = playingRows(withProps).map((r) => r.key);
    expect(keys).toContain('props:p1:corner@3000');
    expect(keys).toContain('props:p2:corner@3000');
    expect(keys).toContain('logo:mark@4000');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('are where every screen has them, and move, pause and play by their own prop and file', () => {
    const rows = playingRows(withProps);
    const banner = rows.find((r) => r.which === 'props:p2:corner');
    const mark = rows.find((r) => r.which === 'logo:mark');
    if (!banner || !mark) throw new Error('rows missing');
    expect(banner.playing.ref).toEqual({ layer: 'props', propId: 'p2', mediaId: 'corner' });
    expect(banner.playing.paused).toBe(true);
    expect(barNow(banner.playing, 99_000)).toMatchObject({ atMs: 900, durationMs: 6000, ended: false });
    expect(mark.playing.ref).toEqual({ layer: 'logo', mediaId: 'mark' });
    // The logo's looping video, 10 s after it went up, round once and 1 s in.
    expect(barNow(mark.playing, 14_000)).toMatchObject({ atMs: 1000, durationMs: 9000 });
  });

  it('have none for a prop or a logo of pictures only, nor a prop saved before Session 27 (no time it went up)', () => {
    const picture = {
      id: 'pic',
      kind: 'image',
      frame: { x: 0, y: 0, width: 10, height: 10 },
      mediaId: 'still',
      fit: 'fit',
    } as const;
    const { shownAt: _was, ...unshown } = prop('old', 'Placeholder old', [video('ov', 'corner')]);
    const s = state(
      { props: [{ id: 'pics', name: 'Placeholder pictures', elements: [picture], shownAt: 1 }, unshown] },
      {
        logo: { id: 'logo', name: 'Placeholder logo', elements: [picture], shownAt: 1 },
      },
    );
    expect(playingRows(s)).toEqual([]);
  });
});
