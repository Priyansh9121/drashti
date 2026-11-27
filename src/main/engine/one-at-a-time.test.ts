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

    const rev = engine.rev;
    engine.dispatch({ type: 'toggleBlackout' });
    expect(covers(engine.current)).toEqual(BLACKOUT);
    expect(engine.rev).toBe(rev + 1);
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

  // alpha.24 bug hunt S2-2: under a cover, a wrong row's click took it off, and Oops then showed the slide that was
  // under it instead of the cover. Oops and Put it back put the screens back as they were, covers and all.
  for (const [name, on, covered] of [
    ['Black-out', { type: 'setBlackout', on: true }, BLACKOUT],
    ['the Wallpaper', { type: 'setWallpaper', on: true }, WALLPAPER],
  ] as const)
    it(`Oops and Put it back put ${name} back as it was before the change they take back, the slide under it`, () => {
      const { engine } = setup();
      engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
      engine.dispatch(on);
      const under = engine.current.layers.slide?.slide.id;
      // A wrong row's click: the cover comes off and the hall sees that slide.
      engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 2 });
      expect(covers(engine.current)).toEqual(OFF);
      // Oops: the cover is back as it was, the slide that was under it under it again.
      expect(engine.dispatch({ type: 'oops' })).toMatchObject({ ok: true, changed: true });
      expect(covers(engine.current)).toEqual(covered);
      expect(engine.current.layers.slide?.slide.id).toBe(under);
      // A message shown under the cover and taken back by Oops: the cover stays.
      engine.dispatch({ type: 'showMessage', message: { id: 'm1', text: 'Placeholder message' } });
      expect(covers(engine.current)).toEqual(covered);
      engine.dispatch({ type: 'oops' });
      expect(engine.current.layers.messages).toEqual([]);
      expect(covers(engine.current)).toEqual(covered);
      // Clear all under the cover, then Put it back: the slide comes back still under it.
      engine.dispatch({ type: 'clearAll' });
      expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: true, changed: true });
      expect(engine.current.layers.slide?.slide.id).toBe(under);
      expect(covers(engine.current)).toEqual(covered);
    });

  // QA24-OOPS-COVERS (the owner: "Restore covers"), the oopsfix review's SHOULD-1: Black-out put back by Oops counted as
  // a cover going on, and dropped a video cued under it ("No video is cued" at Go).
  it('Oops that puts Black-out back keeps a video cued under it, held for Go', () => {
    const { engine, cover } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    cover();
    expect(engine.dispatch({ type: 'cueVideo', mediaId: 'clip' })).toMatchObject({ ok: true });
    const cued = engine.current.videoCue?.id;
    expect(cued).toEqual(expect.any(String));
    // A wrong row's click takes Black-out off and leaves the cue held.
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 2 });
    expect(covers(engine.current)).toEqual(OFF);
    expect(engine.current.videoCue?.id).toBe(cued);
    // Oops: Black-out back, and the cue still held.
    engine.dispatch({ type: 'oops' });
    expect(covers(engine.current)).toEqual(BLACKOUT);
    expect(engine.current.videoCue?.id).toBe(cued);
    expect(backgroundVideo(engine.current)).toBeNull();
  });

  // QA24-OOPS-COVERS, the review's SHOULD-2: a hall cover never comes off with nothing to see.
  it('a cover put on since the change stays on when Oops or Put it back brings back nothing to see', () => {
    const { engine } = setup();
    // A message over nothing up, then Black-out: Oops takes the message back, and the hall stays black.
    engine.dispatch({ type: 'showMessage', message: { id: 'm1', text: 'Placeholder message' } });
    engine.dispatch({ type: 'setBlackout', on: true });
    engine.dispatch({ type: 'oops' });
    expect(engine.current.layers.messages).toEqual([]);
    expect(covers(engine.current)).toEqual(BLACKOUT);
    // Clear all of a message alone, the Wallpaper on since, Put it back: the message back, the Wallpaper still on.
    engine.dispatch({ type: 'setBlackout', on: false });
    engine.dispatch({ type: 'showMessage', message: { id: 'm2', text: 'Placeholder message two' } });
    engine.dispatch({ type: 'clearAll' });
    engine.dispatch({ type: 'setWallpaper', on: true });
    expect(engine.dispatch({ type: 'putBack' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.messages.map((m) => m.id)).toEqual(['m2']);
    expect(covers(engine.current)).toEqual(WALLPAPER);
    // Black-out taken off by a click with only a message up, the Wallpaper on since, Oops: Black-out back, alone (one
    // cover at a time), over the message alone.
    engine.dispatch({ type: 'setBlackout', on: true });
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    expect(covers(engine.current)).toEqual(OFF);
    engine.dispatch({ type: 'setWallpaper', on: true });
    engine.dispatch({ type: 'oops' });
    expect(engine.current.layers.slide).toBeNull();
    expect(covers(engine.current)).toEqual(BLACKOUT);
  });

  it('Oops leaves off a cover the operator took off since the change it takes back, and takes off one put on since', () => {
    const { engine, cover } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    cover();
    engine.dispatch({ type: 'showMessage', message: { id: 'm1', text: 'Placeholder message' } });
    // Black-out off by the operator's own press: Oops takes the message back and the slide stays seen.
    engine.dispatch({ type: 'setBlackout', on: false });
    engine.dispatch({ type: 'oops' });
    expect(engine.current.layers.messages).toEqual([]);
    expect(covers(engine.current)).toEqual(OFF);
    // The Wallpaper on after a slide's click (no cover before it): Oops puts the slide before back, seen.
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 1 });
    engine.dispatch({ type: 'setWallpaper', on: true });
    engine.dispatch({ type: 'oops' });
    expect(engine.current.layers.slide?.slide.id).toBe('p1s1');
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

describe('a video this computer cannot draw (Session 60, x36: the owner’s "Yes, A")', () => {
  it('as the background, comes off with its sound; Oops and Put it back stay as they were', () => {
    const { engine, elapse } = setup();
    engine.dispatch(play('i-clip'));
    elapse(800);
    expect(backgroundVideo(engine.current)).toBe('clip');
    const { canOops, canPutBack } = engine.current;
    // Another file's word takes nothing off.
    expect(engine.noPicture('other')).toBe(false);
    expect(backgroundVideo(engine.current)).toBe('clip');
    expect(engine.noPicture('clip')).toBe(true);
    expect(engine.current.layers.background).toBeNull();
    expect({ canOops: engine.current.canOops, canPutBack: engine.current.canPutBack }).toEqual({
      canOops,
      canPutBack,
    });
    // Off already: a second window's word changes nothing.
    expect(engine.noPicture('clip')).toBe(false);
  });

  it('on the slide up, waits where it is, paused, the slide staying; in the box, the box comes off (Q60-46: never a black box)', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'onslide', slideIndex: 0 });
    engine.dispatch({
      type: 'showPip',
      source: { kind: 'media', mediaId: 'boxed' },
      place: DEFAULT_PIP_PLACE,
    });
    elapse(2000);
    const at = engine.current.layers.slide?.shownAt ?? 0;
    expect(engine.noPicture('onslide')).toBe(true);
    expect(engine.current.layers.slide?.slide.id).toBe('o1');
    expect(engine.current.layers.slide?.seeks?.['onslide']).toEqual({
      at: at + 2000,
      toMs: 2000,
      paused: true,
    });
    // The box's video plays on: only the file that cannot be drawn waits.
    expect(engine.current.layers.pip?.seeks?.['boxed']?.paused).toBeUndefined();
    expect(engine.noPicture('boxed')).toBe(true);
    expect(engine.current.layers.pip).toBeNull();
    expect(engine.current.pipOff?.layer.source).toMatchObject({ kind: 'media', mediaId: 'boxed' });
    // Paused already, the box off: nothing more to do.
    expect(engine.noPicture('onslide')).toBe(false);
    expect(engine.noPicture('boxed')).toBe(false);
  });
});

describe('a video that cannot play on a page (Q60-31, x46’s item 4: its element failed, or no first frame within 10 s)', () => {
  it('as the background, comes off with its sound, and says so; another file’s word takes nothing off', () => {
    const { engine, elapse } = setup();
    engine.dispatch(play('i-clip'));
    elapse(800);
    expect(engine.cannotPlay('other')).toBeNull();
    expect(engine.cannotPlay('clip')).toEqual({ background: true, slide: false, box: false });
    expect(engine.current.layers.background).toBeNull();
    // Off already: a second window's word changes nothing.
    expect(engine.cannotPlay('clip')).toBeNull();
  });

  it('on the slide up, waits where it is, paused with its sound, the slide staying; in the box, the box comes off', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'onslide', slideIndex: 0 });
    engine.dispatch({
      type: 'showPip',
      source: { kind: 'media', mediaId: 'boxed' },
      place: DEFAULT_PIP_PLACE,
    });
    elapse(2000);
    const at = engine.current.layers.slide?.shownAt ?? 0;
    expect(engine.cannotPlay('onslide')).toEqual({ background: false, slide: true, box: false });
    expect(engine.current.layers.slide?.slide.id).toBe('o1');
    expect(engine.current.layers.slide?.seeks?.['onslide']).toEqual({
      at: at + 2000,
      toMs: 2000,
      paused: true,
    });
    // The box's video plays on until its own word.
    expect(engine.current.layers.pip?.source).toMatchObject({ kind: 'media', mediaId: 'boxed' });
    expect(engine.cannotPlay('boxed')).toEqual({ background: false, slide: false, box: true });
    expect(engine.current.layers.pip).toBeNull();
    expect(engine.current.pipOff?.layer.source).toMatchObject({ kind: 'media', mediaId: 'boxed' });
    // Paused already, the box off: nothing more to do.
    expect(engine.cannotPlay('onslide')).toBeNull();
    expect(engine.cannotPlay('boxed')).toBeNull();
  });
});
