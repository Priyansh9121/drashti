import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeckMedia, DeckSlide } from '../../shared/deck';
import type { AudioCue, SlideCue } from '../../shared/library';
import type { RenderSlide, Transition } from '../../shared/model';
import { LiveStateWriter, toRestore } from '../recovery/live-state';
import { ShowEngine } from './show-engine';
import { MemorySlideSource } from './slide-source';
import { RecordingTransport, textSlide } from './testing';

/*
 * A sound set to play across slides (Session 54; the owner: "the sound should play as it does in the deck's own
 * slideshow"): PowerPoint's Play Across Slides and "stop after N slides", and Keynote's soundtrack, which Keynote's
 * own PowerPoint copy has as a sound on its first slide across all of them. It goes on the audio layer with its slide
 * or at its click, plays on as the slides and their clicks change, Next and Back never start it again, and it stops at
 * its end, after its last slide, as anything else goes live, or at Clear. Placeholder names and made-up media ids only.
 */

const dissolve = (durationMs: number): Transition => ({ kind: 'dissolve', durationMs });

/** A deck's slide of `steps` steps, each clip a second long, its coming-in clip 400 ms of the deck's own push. */
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
  return {
    id,
    width: 1920,
    height: 1080,
    background: null,
    elements: [
      {
        id: `${id}-picture`,
        kind: 'image',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
        mediaId: `${id}-last${String(steps - 1)}`,
        fit: 'fit',
      },
    ],
    deck,
  };
}

/** The deck's music: a sound set to play across `slides` slides, with its slide (step 0) or at a click. */
const music = (slides: number, start: DeckMedia['start'], more: Partial<DeckMedia> = {}): DeckMedia => ({
  kind: 'audio',
  mediaId: 'music',
  name: 'Placeholder music',
  box: { x: 0.9, y: 0.1, w: 0.05, h: 0.05 },
  loop: true,
  volume: 1,
  start,
  acrossSlides: slides,
  hideWhenStopped: true,
  ...more,
});

/** A sound of its slide's own, as the deck plays it. */
const chime = (start: DeckMedia['start']): DeckMedia => ({
  kind: 'audio',
  mediaId: 'chime',
  box: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 },
  loop: false,
  volume: 1,
  start,
});

/** The slides of one deck, each coming-in clip made after the slide before it, as an import of the deck makes them. */
function chained(slides: RenderSlide[]): RenderSlide[] {
  return slides.map((s, i) => {
    const before = slides[i - 1]?.deck?.steps.at(-1)?.lastId;
    return before && s.deck ? { ...s, deck: { ...s.deck, after: before } } : s;
  });
}

function setup(slides: RenderSlide[], cues: SlideCue[][] = []) {
  const source = new MemorySlideSource();
  source.set('deck', chained(slides), cues, { transition: dissolve(600) });
  source.set('plain', [textSlide('x', 'Placeholder one')]);
  let clock = 50_000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, undefined, {
    defaultTransition: () => dissolve(300),
    mediaLength: (id) => (id === 'music' ? 90_000 : null),
  });
  return {
    engine,
    source,
    elapse: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

/** Four slides: the music with the first (2 steps), across `slides` of them. */
const fourSlides = (slides: number, more: Partial<DeckMedia> = {}) => [
  deckSlide('a', 2, [music(slides, { step: 0, offsetMs: 600 }, more)]),
  deckSlide('b', 1),
  deckSlide('c', 1),
  deckSlide('d', 1),
];

const sound = (e: ShowEngine) => e.current.layers.audio;
const at = (e: ShowEngine) => ({ slide: e.current.live.slideIndex, step: e.current.layers.slide?.step });

describe('a sound set to play across slides (Session 54)', () => {
  it('goes on the audio layer with its slide, at its moment, and plays on as the clicks and slides change, never started again', () => {
    const { engine, elapse, now } = setup(fourSlides(3));
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    // A jump: the coming-in clip starts past the deck's own 400 ms transition, so its 600 ms come 400 ms sooner.
    const startedAt = now() + 200;
    expect(sound(engine)).toMatchObject({
      mediaId: 'music',
      title: 'Placeholder music',
      volume: 1,
      loop: true,
      startedAt,
      durationMs: 90_000,
      across: { presentationId: 'deck', lastIndex: 2 },
    });
    // Never also its slide's own sound (the screens and the audio player play the slide's).
    expect(engine.current.layers.slide?.seeks?.['music']).toBeUndefined();
    const playing = sound(engine);
    for (const command of ['next', 'next', 'next', 'back', 'previous', 'next', 'next'] as const) {
      elapse(700);
      engine.dispatch({ type: command });
      expect(sound(engine)).toEqual(playing);
    }
    expect(at(engine)).toEqual({ slide: 2, step: 0 });
    // A click on its own slide comes back to it, and the music plays on as it is.
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(sound(engine)).toEqual(playing);
  });

  it('stops once a slide past its last goes up, by Next or a jump; Back undoing that Next puts it back where it would be', () => {
    const { engine, elapse } = setup(fourSlides(2));
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    const playing = sound(engine);
    expect(playing?.across).toEqual({ presentationId: 'deck', lastIndex: 1 });
    for (let i = 0; i < 2; i++) engine.dispatch({ type: 'next' });
    expect(at(engine)).toEqual({ slide: 1, step: 0 });
    expect(sound(engine)).toEqual(playing);
    elapse(1000);
    engine.dispatch({ type: 'next' });
    expect(at(engine).slide).toBe(2);
    expect(sound(engine)).toBeNull();
    // Back undoes that Next exactly: the music again, where it would be by now (never from its start).
    engine.dispatch({ type: 'back' });
    expect(sound(engine)).toEqual(playing);
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 3 });
    expect(sound(engine)).toBeNull();
  });

  it('Play Across Slides (999) plays to the deck’s end; anything else going live stops it, but clearing the slide, black-out and the logo leave it', () => {
    const { engine } = setup(fourSlides(999));
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    const playing = sound(engine);
    expect(playing?.across).toEqual({ presentationId: 'deck', lastIndex: 998 });
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 3 });
    engine.dispatch({ type: 'clearLayer', layer: 'slide' });
    engine.dispatch({ type: 'setBlackout', on: true });
    engine.dispatch({ type: 'showLogo', prop: { id: 'logo', name: 'Placeholder logo', elements: [] } });
    expect(sound(engine)).toEqual(playing);
    // The deck's slides go on after Clear: still its music.
    engine.dispatch({ type: 'previous' });
    expect(sound(engine)).toEqual(playing);
    // Another presentation going up: the deck's slide show is over.
    engine.dispatch({ type: 'goLive', presentationId: 'plain', slideIndex: 0 });
    expect(sound(engine)).toBeNull();
  });

  it('Back and Previous never start it, back onto its slide, nor stop it, back before it; Next onto its slide again never starts it again', () => {
    const { engine } = setup([
      deckSlide('a', 2),
      deckSlide('b', 2, [music(999, { step: 0, offsetMs: 0 })]),
      deckSlide('c', 1),
    ]);
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 2 });
    expect(sound(engine)).toBeNull();
    // Back into its slide, at its last click: no music.
    engine.dispatch({ type: 'previous' });
    expect(at(engine)).toEqual({ slide: 1, step: 1 });
    expect(sound(engine)).toBeNull();
    // Its slide by a click on it: the music. Back before its slide: it plays on, and Next onto it again: the same.
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 2 });
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 1 });
    expect(at(engine)).toEqual({ slide: 1, step: 0 });
    const playing = sound(engine);
    expect(playing?.mediaId).toBe('music');
    engine.dispatch({ type: 'previous' });
    expect(at(engine)).toEqual({ slide: 0, step: 1 });
    expect(sound(engine)).toEqual(playing);
    engine.dispatch({ type: 'next' });
    expect(at(engine)).toEqual({ slide: 1, step: 0 });
    expect(sound(engine)).toEqual(playing);
  });

  it('one that starts at a click starts then; Back undoing the click leaves it playing, and the click again never starts it again', () => {
    const slides = [
      deckSlide('a', 3, [music(2, { step: 1, offsetMs: 250 }), chime({ step: 0, offsetMs: 0 })]),
      deckSlide('b', 1),
      deckSlide('c', 1),
    ];
    const { engine, elapse, now } = setup(slides);
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(sound(engine)).toBeNull();
    // The slide's own sound plays with its slide, as the deck's other sounds do.
    expect(engine.current.layers.slide?.seeks?.['chime']).toBeDefined();
    elapse(2000);
    engine.dispatch({ type: 'next' });
    const clickAt = now();
    expect(sound(engine)).toMatchObject({
      mediaId: 'music',
      startedAt: clickAt + 250,
      across: { presentationId: 'deck', lastIndex: 1 },
    });
    const playing = sound(engine);
    elapse(500);
    engine.dispatch({ type: 'back' });
    expect(at(engine)).toEqual({ slide: 0, step: 0 });
    expect(sound(engine)).toEqual(playing);
    engine.dispatch({ type: 'next' });
    expect(sound(engine)).toEqual(playing);
    // Its two slides: the one it started on, and the next.
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(at(engine).slide).toBe(1);
    expect(sound(engine)).toEqual(playing);
    engine.dispatch({ type: 'next' });
    expect(sound(engine)).toBeNull();
  });

  it('stops at Clear all and at the sound’s own clear, and the slides after never start it again', () => {
    const { engine } = setup(fourSlides(999));
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    engine.dispatch({ type: 'clearLayer', layer: 'audio' });
    expect(sound(engine)).toBeNull();
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(at(engine).slide).toBe(1);
    expect(sound(engine)).toBeNull();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(sound(engine)?.mediaId).toBe('music');
    engine.dispatch({ type: 'clearAll' });
    expect(sound(engine)).toBeNull();
  });

  it('another sound takes its place, as with a slide’s sound, and the deck’s slides after do not bring it back', () => {
    const { engine } = setup(fourSlides(999));
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(sound(engine)?.mediaId).toBe('music');
    engine.dispatch({
      type: 'playAudio',
      audio: { id: 'bell', title: 'Placeholder bell', mediaId: 'bell', volume: 1, loop: false },
    });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(sound(engine)).toMatchObject({ mediaId: 'bell' });
    expect(sound(engine)?.across).toBeUndefined();
  });

  it('plays as its deck says: its volume (none when muted), its loop and its fades', () => {
    const quiet = setup(fourSlides(2, { volume: 0.6, loop: false, fadeInMs: 500, fadeOutMs: 1500 }));
    quiet.engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(sound(quiet.engine)).toMatchObject({
      volume: 0.6,
      loop: false,
      fades: { inMs: 500, outMs: 1500 },
    });
    const muted = setup(fourSlides(2, { muted: true }));
    muted.engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(sound(muted.engine)).toMatchObject({ volume: 0 });
    expect(sound(muted.engine)?.fades).toBeUndefined();
  });

  it('a slide’s sound cue that says so plays across slides too (a deck that came in as pictures)', () => {
    const cue: AudioCue = {
      kind: 'audio',
      label: 'Placeholder music',
      name: 'Placeholder music.m4a',
      missing: false,
      unplayable: null,
      mediaId: 'music',
      volume: 0.8,
      loop: true,
      acrossSlides: 2,
    };
    const { engine } = setup(
      [textSlide('p1', 'One'), textSlide('p2', 'Two'), textSlide('p3', 'Three')],
      [[cue], [], []],
    );
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    const playing = sound(engine);
    expect(playing).toMatchObject({
      mediaId: 'music',
      title: 'Placeholder music',
      volume: 0.8,
      loop: true,
      across: { presentationId: 'deck', lastIndex: 1 },
    });
    engine.dispatch({ type: 'next' });
    expect(sound(engine)).toEqual(playing);
    // Previous back onto its slide never starts it again.
    engine.dispatch({ type: 'previous' });
    expect(sound(engine)).toEqual(playing);
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(sound(engine)).toBeNull();
    engine.dispatch({ type: 'previous' });
    engine.dispatch({ type: 'previous' });
    expect(engine.current.live.slideIndex).toBe(0);
    expect(sound(engine)).toBeNull();
  });
});

describe('a sound set to play across slides after an unexpected restart (Session 54)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('comes back where it would be by now, with its slides, from the recovery file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-across-'));
    const files = { state: join(dir, 'live-state.json'), cleanMark: join(dir, 'live-state.clean') };
    const first = setup(fourSlides(2, { fadeInMs: 400 }));
    first.engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    first.engine.dispatch({ type: 'next' });
    first.engine.dispatch({ type: 'next' });
    const was = sound(first.engine);
    expect(was).toMatchObject({ across: { presentationId: 'deck', lastIndex: 1 }, fades: { inMs: 400 } });
    const writer = new LiveStateWriter(files, { throttleMs: 10 });
    writer.update(first.engine.current);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writer.settle();
    const back = toRestore(files);
    if (!back) throw new Error('nothing to put back');
    const second = setup(fourSlides(2, { fadeInMs: 400 }));
    second.engine.restore(back);
    expect(sound(second.engine)).toEqual(was);
    // Its slides still count: the next slide is past its last.
    second.engine.dispatch({ type: 'next' });
    expect(sound(second.engine)).toBeNull();
  });
});
