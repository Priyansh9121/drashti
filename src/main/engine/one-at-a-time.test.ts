import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import type { EngineState } from '../../shared/engine/state';
import type { BackgroundCue } from '../../shared/library';
import type { MediaElement, RenderSlide } from '../../shared/model';
import { DEFAULT_PIP_PLACE } from '../../shared/pip';
import { inputNamed, type VideoInput } from '../../shared/video-inputs';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * LIVE shows one thing at a time (Session 56, the owner's words of 11 Nov 2026: "A video takes off the wallpaper and
 * black-out, and the other way round"). A video going up, by any of the operator's ways (a row's click, Next, Back,
 * Media, a slide's background video, a video input, Oops, Put it back; a phone, Companion's API, MIDI and the quick bar
 * send these same commands), takes the Wallpaper and Black-out off; the Wallpaper or Black-out going on takes the
 * background's video or video input off, as clearing the background does, and a video on the slide up or in the
 * picture-in-picture box waits there, paused, with its slide or box. Music and sounds play on. What the engine does by
 * itself (a slide moving on by itself, restart recovery) never takes a cover off: a video it would bring up under one
 * comes off instead. Placeholder ids only.
 */

const INPUT: VideoInput = { id: 'in-1', name: 'Input 1', device: 'Placeholder camera', fit: 'fit' };

/** Each placeholder file's length (ms), as the library has it once a screen has played it. */
const LENGTHS: Record<string, number> = {
  clip: 60_000,
  other: 30_000,
  onslide: 40_000,
  boxed: 20_000,
  tune: 90_000,
};

const videoCue = (mediaId: string): BackgroundCue => ({
  kind: 'background',
  label: '',
  name: `${mediaId}.mp4`,
  missing: false,
  unplayable: null,
  background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
});

const videoEl = (mediaId: string): MediaElement => ({
  id: `${mediaId}-el`,
  kind: 'video',
  mediaId,
  frame: { x: 0, y: 0, width: 640, height: 360 },
  fit: 'fit',
  loop: false,
});

/** A slide with a video under its words. */
function slideWithVideo(id: string, mediaId: string): RenderSlide {
  const words = textSlide(id, 'Placeholder words');
  return { ...words, elements: [videoEl(mediaId), ...words.elements] };
}

/**
 * An engine with: p1 (three slides of words); cued (its first slide's background cue is the video "clip", its second
 * has words only); onslide (a slide with a video on it); timed (moving on by itself after 4 s to a slide whose
 * background cue is "other"); and the playlist "sunday": p1, the video "clip", the video input, the sound "tune".
 */
function setup() {
  const source = makeSource();
  source.set(
    'cued',
    [textSlide('c1', 'Placeholder one'), textSlide('c2', 'Placeholder two')],
    [[videoCue('clip')]],
  );
  source.set('onslide', [slideWithVideo('o1', 'onslide')]);
  source.set(
    'timed',
    [textSlide('t1', 'Placeholder first'), textSlide('t2', 'Placeholder second')],
    [[], [videoCue('other')]],
    {
      autoAdvance: [4000, null],
    },
  );
  const playlists = new MemoryPlaylistSource();
  playlists.set('sunday', [
    { id: 'i-p1', kind: 'presentation', presentationId: 'p1', arrangementId: undefined },
    { id: 'i-clip', kind: 'media', mediaId: 'clip', media: 'video', label: 'Placeholder clip' },
    { id: 'i-cam', kind: 'input', inputId: INPUT.id, label: INPUT.name },
    { id: 'i-tune', kind: 'media', mediaId: 'tune', media: 'audio', label: 'Placeholder tune' },
    { id: 'i-pic', kind: 'media', mediaId: 'still', media: 'image', label: 'Placeholder picture' },
  ]);
  let clock = 1_000_000;
  const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
  const transport = new RecordingTransport();
  const engine = new ShowEngine(source, transport, () => clock, playlists, {
    mediaLength: (id) => LENGTHS[id] ?? null,
    mediaKind: (id) => (id === 'still' ? 'image' : 'video'),
    videoInput: (id) => (id === INPUT.id ? INPUT : null),
    inputNamed: (name) => inputNamed([INPUT], name),
    schedule: (delay, run) => {
      const job = { at: clock + delay, run, cancelled: false };
      jobs.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  const elapse = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = jobs.filter((j) => !j.cancelled && j.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      jobs.splice(jobs.indexOf(due), 1);
      clock = Math.max(clock, due.at);
      due.run();
    }
    clock = end;
  };
  engine.setTimers([
    {
      id: 'talk',
      name: 'Placeholder talk',
      kind: 'countdown',
      durationMs: 60_000,
      targetTime: null,
      allowsOverrun: false,
    },
  ]);
  const cover = () => {
    engine.dispatch({ type: 'setBlackout', on: true });
    expect(covers(engine.current)).toEqual(BLACKOUT);
  };
  return { engine, transport, elapse, cover, now: () => clock };
}

const covers = (s: EngineState) => ({ blackout: s.blackout, wallpaper: s.wallpaper });
const OFF = { blackout: false, wallpaper: false };
const BLACKOUT = { blackout: true, wallpaper: false };
const WALLPAPER = { blackout: false, wallpaper: true };

const setVideo = (mediaId: string): EngineCommand => ({
  type: 'setBackground',
  background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: false },
});
const play = (itemId: string): EngineCommand => ({ type: 'playItem', playlistId: 'sunday', itemId });

/** The background's video file, or its video input, up now; null for none. */
function backgroundVideo(s: EngineState): string | null {
  const bg = s.layers.background;
  if (bg?.kind === 'media' && bg.media === 'video') return bg.mediaId;
  return bg?.kind === 'input' ? bg.inputId : null;
}

describe('LIVE’s Wallpaper and Black-out replace each other', () => {
  it('switches covers in one change and reveals the same slide when the last cover comes off', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    const layers = engine.current.layers;
    engine.dispatch({ type: 'toggleWallpaper' });
    expect(covers(engine.current)).toEqual(WALLPAPER);

    const rev = engine.current.rev;
    engine.dispatch({ type: 'toggleBlackout' });
    expect(covers(engine.current)).toEqual(BLACKOUT);
    expect(engine.current.rev).toBe(rev + 1);
    engine.dispatch({ type: 'toggleWallpaper' });
    expect(covers(engine.current)).toEqual(WALLPAPER);
    engine.dispatch({ type: 'toggleWallpaper' });

    expect(covers(engine.current)).toEqual(OFF);
    expect(engine.current.layers).toBe(layers);
  });

  it('recovers Black-out from a show saved with both covers', () => {
    const { engine } = setup();
    engine.restore({ slide: null, background: null, blackout: true, wallpaper: true });
    expect(covers(engine.current)).toEqual(BLACKOUT);
  });
});

describe('LIVE shows one thing at a time (Session 56): a video going up takes the covers off', () => {
  const ways: { name: string; run: (s: ReturnType<typeof setup>) => void; video: string }[] = [
    {
      name: 'Media’s click (and the quick bar’s)',
      run: ({ engine }) => engine.dispatch(setVideo('clip')),
      video: 'clip',
    },
    {
      name: 'a video row’s click (a phone’s too)',
      run: ({ engine }) => engine.dispatch(play('i-clip')),
      video: 'clip',
    },
    {
      name: 'Next onto a video row',
      run: ({ engine, cover }) => {
        engine.dispatch(play('i-p1'));
        engine.dispatch({
          type: 'goLive',
          presentationId: 'p1',
          slideIndex: 2,
          playlist: { playlistId: 'sunday', itemId: 'i-p1' },
        });
        cover();
        engine.dispatch({ type: 'next' });
      },
      video: 'clip',
    },
    {
      name: 'Back onto a video row',
      run: ({ engine, cover }) => {
        engine.dispatch(play('i-cam'));
        engine.dispatch(play('i-tune'));
        cover();
        engine.dispatch({ type: 'previous' });
      },
      video: INPUT.id,
    },
    {
      name: 'a slide’s background video (its cue)',
      run: ({ engine }) => engine.dispatch({ type: 'goLive', presentationId: 'cued', slideIndex: 0 }),
      video: 'clip',
    },
    {
      name: 'a video input on the audience (Media’s, and LIVE’s one press)',
      run: ({ engine }) => engine.dispatch({ type: 'toggleInput', inputId: INPUT.id }),
      video: INPUT.id,
    },
    { name: 'a video input’s row', run: ({ engine }) => engine.dispatch(play('i-cam')), video: INPUT.id },
  ];
  for (const way of ways)
    it(`by ${way.name}`, () => {
      const s = setup();
      s.cover();
      way.run(s);
      expect(backgroundVideo(s.engine.current)).toBe(way.video);
      expect(covers(s.engine.current)).toEqual(OFF);
    });

  it('by Oops and Put it back, bringing a video back', () => {
    const { engine, cover, elapse } = setup();
    engine.dispatch(setVideo('clip'));
    const up = engine.current.layers.background;
    elapse(5000);
    // Black-out took it off (below): Oops puts it back, playing on where it would be by now, and black-out comes off.
    engine.dispatch({ type: 'setBlackout', on: true });
    expect(backgroundVideo(engine.current)).toBeNull();
    elapse(2000);
    expect(engine.dispatch({ type: 'oops' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.background).toEqual(up);
    expect(covers(engine.current)).toEqual(OFF);
    // Clear all, the covers on, Put it back: the video comes back, the covers off.
    engine.dispatch({ type: 'clearAll' });
    cover();
    expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: true, changed: true });
    expect(backgroundVideo(engine.current)).toBe('clip');
    expect(covers(engine.current)).toEqual(OFF);
  });

  it('a slide with a video on it, and Play on a video waiting under a cover', () => {
    const { engine, cover } = setup();
    cover();
    engine.dispatch({ type: 'goLive', presentationId: 'onslide', slideIndex: 0 });
    expect(covers(engine.current)).toEqual(OFF);
    // Covered, it waits (below); Play on its time bar plays it on, and the covers come off.
    cover();
    expect(engine.current.layers.slide?.seeks?.['onslide']?.paused).toBe(true);
    engine.dispatch({ type: 'resumePlaying', playing: { layer: 'slide', mediaId: 'onslide' } });
    expect(engine.current.layers.slide?.seeks?.['onslide']?.paused).toBeUndefined();
    expect(covers(engine.current)).toEqual(OFF);
  });

  it('a sound going up leaves the covers as they are: music and sounds are heard, not seen', () => {
    const { engine, cover } = setup();
    cover();
    engine.dispatch(play('i-tune'));
    expect(engine.current.layers.audio?.mediaId).toBe('tune');
    expect(covers(engine.current)).toEqual(BLACKOUT);
  });
});

describe('LIVE shows one thing at a time (Session 56): a cover going on stops what plays', () => {
  for (const cover of ['setBlackout', 'setWallpaper', 'toggleBlackout', 'toggleWallpaper'] as const)
    it(`${cover} takes the background video off, as clearing the background does; the sound plays on`, () => {
      const { engine } = setup();
      engine.dispatch(play('i-clip'));
      engine.dispatch(play('i-tune'));
      const sound = engine.current.layers.audio;
      engine.dispatch(
        cover === 'setBlackout' || cover === 'setWallpaper' ? { type: cover, on: true } : { type: cover },
      );
      expect(engine.current.layers.background).toBeNull();
      expect(engine.current.blackout || engine.current.wallpaper).toBe(true);
      expect(engine.current.layers.audio).toEqual(sound);
    });

  it('takes a video input on the audience off too', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'showInput', inputId: INPUT.id });
    engine.dispatch({ type: 'setWallpaper', on: true });
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.wallpaper).toBe(true);
  });

  it('a video on the slide up and the box’s video wait where they are, paused, with their slide and box under it', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'onslide', slideIndex: 0 });
    engine.dispatch({
      type: 'showPip',
      source: { kind: 'media', mediaId: 'boxed' },
      place: DEFAULT_PIP_PLACE,
    });
    elapse(3000);
    const at = engine.current.layers.slide?.shownAt ?? 0;
    engine.dispatch({ type: 'setBlackout', on: true });
    const slide = engine.current.layers.slide;
    expect(slide?.slide.id).toBe('o1');
    expect(slide?.shownAt).toBe(at);
    expect(slide?.seeks?.['onslide']).toEqual({ at: at + 3000, toMs: 3000, paused: true });
    const box = engine.current.layers.pip;
    expect(box?.source).toMatchObject({ kind: 'media', mediaId: 'boxed' });
    expect(box?.seeks?.['boxed']).toMatchObject({ toMs: 3000, paused: true });
    // Black-out off: they are still there, waiting for Play.
    elapse(2000);
    engine.dispatch({ type: 'setBlackout', on: false });
    expect(engine.current.layers.slide?.seeks?.['onslide']).toEqual({
      at: at + 3000,
      toMs: 3000,
      paused: true,
    });
  });

  it('a picture stays under it, and comes back as it was when it comes off', () => {
    const { engine } = setup();
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'still', media: 'image', fit: 'fill', loop: false },
    });
    const layers = engine.current.layers;
    engine.dispatch({ type: 'setBlackout', on: true });
    expect(engine.current.layers).toBe(layers);
    engine.dispatch({ type: 'setBlackout', on: false });
    expect(engine.current.layers).toBe(layers);
  });
});

describe('LIVE shows one thing at a time (Session 56): the engine by itself never takes a cover off', () => {
  it('a slide moving on by itself to a video under a cover comes up without it', () => {
    const { engine, cover, elapse } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'timed', slideIndex: 0 });
    cover();
    elapse(4000);
    expect(engine.current.layers.slide?.slide.id).toBe('t2');
    expect(covers(engine.current)).toEqual(BLACKOUT);
    expect(engine.current.layers.background).toBeNull();
  });

  it('restart recovery brings back the cover, never a video with it (a file saved before Session 56 could hold both)', () => {
    const { engine } = setup();
    const put = engine.restore({
      slide: null,
      background: {
        kind: 'media',
        mediaId: 'clip',
        media: 'video',
        fit: 'fill',
        loop: true,
        startedAt: 999_000,
      },
      blackout: true,
    });
    expect(engine.current.blackout).toBe(true);
    expect(engine.current.layers.background).toBeNull();
    expect(put).toMatchObject({ background: false, blackout: true });
    const again = setup().engine;
    const input = again.restore({
      slide: null,
      background: {
        kind: 'input',
        inputId: INPUT.id,
        name: INPUT.name,
        device: INPUT.device,
        fit: 'fit',
        startedAt: 999_000,
      },
      blackout: false,
      wallpaper: true,
    });
    expect(again.current.wallpaper).toBe(true);
    expect(again.current.layers.background).toBeNull();
    expect(input).toMatchObject({ input: null, wallpaper: true });
  });
});

/*
 * The lead's open question to the owner (11 Nov): slides and pictures. Until the owner says otherwise, anything the
 * operator puts up (a slide, a deck's click, a picture, a colour, a timer shown alone, another app's window) takes the
 * covers off too, so what is put up is always seen; a cover going on keeps a slide or a picture under it and brings it
 * back as it was when it comes off; what the engine does by itself (a slide moving on by itself, Repeat Slides going
 * round) leaves the covers on, as before.
 */
describe('LIVE shows one thing at a time (Session 56): a slide or a picture put up takes the covers off too', () => {
  const ways: { name: string; run: (s: ReturnType<typeof setup>) => void }[] = [
    {
      name: 'a slide’s click',
      run: ({ engine }) => engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 1 }),
    },
    {
      name: 'a click on the slide already up',
      run: ({ engine, cover }) => {
        engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 1 });
        cover();
        engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 1 });
      },
    },
    {
      name: 'Next',
      run: ({ engine, cover }) => {
        engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
        cover();
        engine.dispatch({ type: 'next' });
      },
    },
    {
      name: 'Back',
      run: ({ engine, cover }) => {
        engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
        engine.dispatch({ type: 'next' });
        cover();
        engine.dispatch({ type: 'back' });
      },
    },
    { name: 'a picture’s row', run: ({ engine }) => engine.dispatch(play('i-pic')) },
    {
      name: 'a picture from Media',
      run: ({ engine }) =>
        engine.dispatch({
          type: 'setBackground',
          background: { kind: 'media', mediaId: 'still', media: 'image', fit: 'fill', loop: false },
        }),
    },
    {
      name: 'a colour from Media',
      run: ({ engine }) =>
        engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#203040' } }),
    },
    {
      name: 'a timer shown alone',
      run: ({ engine }) => engine.dispatch({ type: 'showTimer', timerId: 'talk' }),
    },
    {
      name: 'another app’s window (Pro Mode’s, from Main)',
      run: ({ engine }) => engine.showWindow({ sourceId: 'window:1:0', name: 'Placeholder meeting' }),
    },
    {
      name: 'Put it back',
      run: ({ engine, cover }) => {
        engine.dispatch({ type: 'goLive', presentationId: 'p2', slideIndex: 0 });
        engine.dispatch({ type: 'clearAll' });
        cover();
        engine.dispatch({ type: 'putBack' });
      },
    },
  ];
  for (const way of ways)
    it(`by ${way.name}`, () => {
      const s = setup();
      s.cover();
      way.run(s);
      expect(covers(s.engine.current)).toEqual(OFF);
      expect(s.engine.current.layers.slide !== null || s.engine.current.layers.background !== null).toBe(
        true,
      );
    });

  it('a cover going on keeps the slide under it and brings it back as it was', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 2 });
    const layers = engine.current.layers;
    engine.dispatch({ type: 'toggleWallpaper' });
    expect(engine.current.layers).toBe(layers);
    engine.dispatch({ type: 'toggleWallpaper' });
    expect(engine.current.layers).toBe(layers);
  });

  it('what is not put up on the picture leaves the covers on: a sound, a message, Clear all, a layer cleared', () => {
    const { engine, cover } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    cover();
    engine.dispatch(play('i-tune'));
    engine.dispatch({ type: 'showMessage', message: { id: 'm1', text: 'Placeholder message' } });
    engine.dispatch({ type: 'clearLayer', layer: 'slide' });
    engine.dispatch({ type: 'clearAll' });
    expect(covers(engine.current)).toEqual(BLACKOUT);
  });

  it('a slide moving on by itself leaves the covers on', () => {
    const { engine, cover, elapse } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'timed', slideIndex: 0 });
    cover();
    elapse(4000);
    expect(engine.current.layers.slide?.slide.id).toBe('t2');
    expect(covers(engine.current)).toEqual(BLACKOUT);
  });
});
