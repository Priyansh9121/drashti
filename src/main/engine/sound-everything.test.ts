import { describe, expect, it } from 'vitest';
import type { DeckMedia, DeckSlide } from '../../shared/deck';
import type { SlideCue } from '../../shared/library';
import type { EngineCommand } from '../../shared/engine/commands';
import type { MusicRun } from '../../shared/engine/state';
import type { RenderSlide } from '../../shared/model';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

/*
 * Session 55, Part 7: sound with everything else. A sound, or an audio playlist, keeps playing whatever goes up: a
 * video (its own sound plays too), a PDF's page, a deck's slide or a picture. And a sound can be started while a PDF
 * or a deck is up: a click on its row puts it on the audio layer and leaves the slides where they are, so Next goes on
 * with the PDF's next page or the deck's next click (before, the playlist's place moved to the sound's row, and Next
 * went past the rest of the PDF or the deck). Placeholder names and made-up media ids only.
 */

/** A PDF's pages, as Drashti imports them: a picture a page. */
const page = (id: string): RenderSlide => ({
  id,
  width: 1920,
  height: 1080,
  background: '#ffffff',
  elements: [
    {
      id: `${id}-page`,
      kind: 'image',
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
      mediaId: `${id}-picture`,
      fit: 'fit',
    },
  ],
});

/** A deck's slide of `steps` clicks, each clip a second long, with no sound of its own (or the media given). */
function deckSlide(id: string, steps: number, media: DeckMedia[] = []): RenderSlide {
  const deck: DeckSlide = {
    transition: { name: 'push', durationMs: 400 },
    steps: Array.from({ length: steps }, (_, i) => ({
      clipId: `${id}-clip${String(i)}`,
      clipMs: 1000,
      lastId: `${id}-last${String(i)}`,
      ...(i === 0 ? { transitionMs: 400 } : {}),
    })),
    media,
  };
  return { ...page(id), background: null, deck };
}

/** A deck's own soundtrack: a sound set to play across `slides` slides, starting with its slide. */
const soundtrack = (slides: number): DeckMedia => ({
  kind: 'audio',
  mediaId: 'soundtrack',
  name: 'Placeholder soundtrack',
  box: { x: 0.9, y: 0.1, w: 0.05, h: 0.05 },
  loop: true,
  volume: 1,
  start: { step: 0, offsetMs: 0 },
  acrossSlides: slides,
});

/** A slide's own sound cue (a presentation's, or a deck that came in as pictures). */
const ownSound = (mediaId: string, loop = false): SlideCue => ({
  kind: 'audio',
  label: `Placeholder ${mediaId}`,
  name: `${mediaId}.mp3`,
  missing: false,
  unplayable: null,
  mediaId,
  volume: 0.8,
  loop,
});

const LENGTHS: Record<string, number> = { clip: 10_000, tone: 60_000, a: 60_000, b: 30_000 };

function setup() {
  const source = makeSource();
  source.set('pdf', [page('pdf1'), page('pdf2'), page('pdf3')]);
  source.set('deck', [deckSlide('d1', 2), deckSlide('d2', 1)]);
  // Its own soundtrack across its first two slides; then a third without.
  source.set('scored', [deckSlide('s1', 1, [soundtrack(2)]), deckSlide('s2', 1), deckSlide('s3', 1)]);
  // A presentation whose first and third slides have their own sound.
  source.set('cued', [page('c1'), page('c2'), page('c3')], [[ownSound('cue')], [], [ownSound('cue2', true)]]);
  const playlists = new MemoryPlaylistSource();
  playlists.set('pl', [
    { id: 'i-pdf', kind: 'presentation', presentationId: 'pdf', arrangementId: undefined },
    { id: 'i-tone', kind: 'media', mediaId: 'tone', media: 'audio', label: 'Placeholder tone' },
    { id: 'i-deck', kind: 'presentation', presentationId: 'deck', arrangementId: undefined },
    { id: 'i-clip', kind: 'media', mediaId: 'clip', media: 'video', label: 'Placeholder clip' },
    { id: 'i-pic', kind: 'media', mediaId: 'pic', media: 'image', label: 'Placeholder picture' },
    { id: 'i-after', kind: 'presentation', presentationId: 'p2', arrangementId: undefined },
    { id: 'i-scored', kind: 'presentation', presentationId: 'scored', arrangementId: undefined },
    { id: 'i-cued', kind: 'presentation', presentationId: 'cued', arrangementId: undefined },
  ]);
  let clock = 1_000_000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, playlists, {
    mediaLength: (id) => LENGTHS[id] ?? null,
    mediaKind: (id) => (id === 'pic' ? 'image' : id === 'tone' ? 'audio' : 'video'),
    // Nothing is waited for here: the music's next track and a deck's clicks are not what these tests look at.
    schedule: () => () => undefined,
  });
  return {
    engine,
    elapse: (ms: number) => {
      clock += ms;
    },
  };
}

const playItem = (itemId: string): EngineCommand => ({ type: 'playItem', playlistId: 'pl', itemId });
const goLive = (presentationId: string, slideIndex: number, itemId: string): EngineCommand => ({
  type: 'goLive',
  presentationId,
  slideIndex,
  arrangementId: null,
  playlist: { playlistId: 'pl', itemId },
});
const music: Omit<MusicRun, 'index'> = {
  playlistId: 'music',
  name: 'Placeholder music',
  tracks: [
    { mediaId: 'a', title: 'Placeholder track A' },
    { mediaId: 'b', title: 'Placeholder track B' },
  ],
  loop: true,
  shuffle: false,
};
const sound: EngineCommand = {
  type: 'playAudio',
  audio: { id: 'tone', title: 'Placeholder tone', mediaId: 'tone', volume: 1, loop: false },
};

/** What the audio layer plays, and since when (the same start: it carries on, never started again). */
const heard = (e: ShowEngine) => {
  const a = e.current.layers.audio;
  return a ? { mediaId: a.mediaId, startedAt: a.startedAt, music: a.music?.playlistId ?? null } : null;
};
const slideId = (e: ShowEngine) => e.current.layers.slide?.slide.id ?? null;
const backgroundId = (e: ShowEngine) => {
  const bg = e.current.layers.background;
  return bg?.kind === 'media' ? bg.mediaId : null;
};

describe('a sound or an audio playlist keeps playing whatever goes up', () => {
  for (const [what, start] of [
    ['an audio playlist', { type: 'playMusic', music, index: 0 }],
    ['a sound', sound],
  ] as const) {
    it(`${what}: a video (its own sound too), a picture, a PDF's page and a deck's slide`, () => {
      const { engine, elapse } = setup();
      expect(engine.dispatch(start as EngineCommand).ok).toBe(true);
      const playing = heard(engine);
      expect(playing?.mediaId).toBeTruthy();
      elapse(1000);
      // A video from the playlist: it is the background (its own sound plays from it), the sound plays on.
      engine.dispatch(playItem('i-clip'));
      expect(backgroundId(engine)).toBe('clip');
      expect(heard(engine)).toEqual(playing);
      elapse(1000);
      engine.dispatch(playItem('i-pic'));
      expect(backgroundId(engine)).toBe('pic');
      expect(heard(engine)).toEqual(playing);
      elapse(1000);
      // A PDF's page, then its next with Next.
      engine.dispatch(goLive('pdf', 0, 'i-pdf'));
      engine.dispatch({ type: 'next' });
      expect(slideId(engine)).toBe('pdf2');
      expect(heard(engine)).toEqual(playing);
      elapse(1000);
      // A deck's slide, then its next click.
      engine.dispatch(goLive('deck', 0, 'i-deck'));
      engine.dispatch({ type: 'next' });
      expect(slideId(engine)).toBe('d1');
      expect(engine.current.layers.slide?.step).toBe(1);
      expect(heard(engine)).toEqual(playing);
    });
  }
});

describe('a sound can be started while a PDF or a deck is up', () => {
  it("a sound's row clicked on a PDF's page: the page stays up, and Next goes on to the PDF's next page", () => {
    const { engine } = setup();
    engine.dispatch(goLive('pdf', 0, 'i-pdf'));
    expect(engine.dispatch(playItem('i-tone')).ok).toBe(true);
    expect(heard(engine)?.mediaId).toBe('tone');
    expect(slideId(engine)).toBe('pdf1');
    expect(engine.current.live).toMatchObject({
      presentationId: 'pdf',
      slideIndex: 0,
      playlist: { playlistId: 'pl', itemId: 'i-pdf' },
    });
    engine.dispatch({ type: 'next' });
    expect(slideId(engine)).toBe('pdf2');
    expect(heard(engine)?.mediaId).toBe('tone');
  });

  it("a sound's row clicked on a deck's slide: the deck stays on its click, and Next shows its next click", () => {
    const { engine } = setup();
    engine.dispatch(goLive('deck', 0, 'i-deck'));
    expect(engine.current.layers.slide?.step).toBe(0);
    expect(engine.dispatch(playItem('i-tone')).ok).toBe(true);
    expect(heard(engine)?.mediaId).toBe('tone');
    expect(engine.current.live).toMatchObject({ presentationId: 'deck', slideIndex: 0 });
    engine.dispatch({ type: 'next' });
    expect(slideId(engine)).toBe('d1');
    expect(engine.current.layers.slide?.step).toBe(1);
    engine.dispatch({ type: 'next' });
    expect(slideId(engine)).toBe('d2');
    expect(heard(engine)?.mediaId).toBe('tone');
  });

  it("with no slide up a sound's row is the playlist's place, as before: Next goes on from it", () => {
    const { engine } = setup();
    engine.dispatch(playItem('i-tone'));
    expect(engine.current.live).toMatchObject({
      presentationId: null,
      playlist: { playlistId: 'pl', itemId: 'i-tone' },
    });
    engine.dispatch({ type: 'next' });
    expect(slideId(engine)).toBe('d1');
    expect(heard(engine)?.mediaId).toBe('tone');
  });
});

describe('the engine says how each file sounding now plays (Part 7: even loudness, the music stepping aside)', () => {
  function withLibrary() {
    const known = new Map<string, { gain: number; silent: boolean }>([
      ['tone', { gain: 0.5, silent: false }],
      ['clip', { gain: 1.995, silent: false }],
      ['quiet', { gain: 1, silent: true }],
    ]);
    let stepsAside = true;
    const source = makeSource();
    const playlists = new MemoryPlaylistSource();
    playlists.set('pl', [
      { id: 'i-clip', kind: 'media', mediaId: 'clip', media: 'video', label: 'Placeholder clip' },
      { id: 'i-quiet', kind: 'media', mediaId: 'quiet', media: 'video', label: 'Placeholder quiet clip' },
    ]);
    const engine = new ShowEngine(source, new RecordingTransport(), () => 1_000_000, playlists, {
      mediaLength: (id) => LENGTHS[id] ?? null,
      soundOf: (id) => known.get(id) ?? null,
      stepsAside: () => stepsAside,
      schedule: () => () => undefined,
    });
    return {
      engine,
      known,
      setStepsAside: (on: boolean) => {
        stepsAside = on;
      },
    };
  }

  it('each file’s gain and the videos with no sound, as they go up and as the library learns more', () => {
    const { engine, known, setStepsAside } = withLibrary();
    engine.dispatch(sound);
    expect(engine.current.sound).toEqual({ stepsAside: true, gains: { tone: 0.5 }, silent: [] });
    engine.dispatch(playItem('i-clip'));
    expect(engine.current.sound).toEqual({ stepsAside: true, gains: { tone: 0.5, clip: 1.995 }, silent: [] });
    engine.dispatch(playItem('i-quiet'));
    expect(engine.current.sound).toEqual({ stepsAside: true, gains: { tone: 0.5 }, silent: ['quiet'] });
    // Measured, or switched to play as it is, while it plays: what plays follows at once.
    known.set('tone', { gain: 1, silent: false });
    setStepsAside(false);
    const rev = engine.rev;
    expect(engine.refreshSound()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.sound).toEqual({ stepsAside: false, gains: {}, silent: ['quiet'] });
    expect(engine.rev).toBe(rev + 1);
    // Nothing new: nothing sent.
    expect(engine.refreshSound()).toMatchObject({ ok: true, changed: false });
  });

  it('an engine with no library says nothing (every page plays each file as it is)', () => {
    const { engine } = setup();
    engine.dispatch(sound);
    expect(engine.current.sound).toBeUndefined();
  });
});

describe('a deck’s own soundtrack or a slide’s own sound plays over the music (the owner’s answer of 30 Oct)', () => {
  /** What plays on the audio layer, and what plays over it. */
  const playing = (e: ShowEngine) => {
    const a = e.current.layers.audio;
    return a
      ? {
          mediaId: a.mediaId,
          startedAt: a.startedAt,
          music: a.music?.playlistId ?? null,
          over: a.over ? { mediaId: a.over.mediaId, across: a.over.across ?? null } : null,
        }
      : null;
  };

  it('a slide’s own sound plays over an audio playlist, which plays on (never stopped for it) as tracks change', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'playMusic', music, index: 0 });
    const was = playing(engine);
    elapse(1000);
    engine.dispatch(goLive('cued', 0, 'i-cued'));
    expect(playing(engine)).toEqual({ ...was, over: { mediaId: 'cue', across: null } });
    // It stays on later slides, as a slide's sound does, until something replaces or clears it.
    engine.dispatch({ type: 'next' });
    expect(playing(engine)?.over?.mediaId).toBe('cue');
    // The music's own next track: the slide's sound plays on over it.
    engine.dispatch({ type: 'musicNext' });
    expect(playing(engine)).toMatchObject({ mediaId: 'b', music: 'music', over: { mediaId: 'cue' } });
    // Another slide's own sound takes its place over the music.
    engine.dispatch({ type: 'next' });
    expect(playing(engine)).toMatchObject({ mediaId: 'b', over: { mediaId: 'cue2' } });
    // Clear audio stops both.
    engine.dispatch({ type: 'clearLayer', layer: 'audio' });
    expect(playing(engine)).toBeNull();
  });

  it('a deck’s own soundtrack plays over the music across its slides, then the music plays alone', () => {
    const { engine, elapse } = setup();
    engine.dispatch({ type: 'playMusic', music, index: 0 });
    const was = playing(engine);
    elapse(1000);
    engine.dispatch(goLive('scored', 0, 'i-scored'));
    expect(playing(engine)).toEqual({
      ...was,
      over: { mediaId: 'soundtrack', across: { presentationId: 'scored', lastIndex: 1 } },
    });
    engine.dispatch({ type: 'next' });
    expect(playing(engine)?.over?.mediaId).toBe('soundtrack');
    // Past its last slide: it stops; the music plays on as it was.
    engine.dispatch({ type: 'next' });
    expect(playing(engine)).toEqual(was);
  });

  it('a sound the operator started plays on under a slide’s own sound too', () => {
    const { engine, elapse } = setup();
    engine.dispatch(sound);
    const was = playing(engine);
    elapse(1000);
    engine.dispatch(goLive('cued', 0, 'i-cued'));
    expect(playing(engine)).toEqual({ ...was, over: { mediaId: 'cue', across: null } });
  });

  it('with nothing playing, a slide’s own sound is the sound, as before, and the next slide’s own takes its place', () => {
    const { engine } = setup();
    engine.dispatch(goLive('cued', 0, 'i-cued'));
    expect(playing(engine)).toMatchObject({ mediaId: 'cue', music: null, over: null });
    engine.dispatch(goLive('cued', 2, 'i-cued'));
    expect(playing(engine)).toMatchObject({ mediaId: 'cue2', over: null });
  });
});
