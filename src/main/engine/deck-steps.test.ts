import { describe, expect, it } from 'vitest';
import type { DeckMedia, DeckSlide } from '../../shared/deck';
import type { RenderSlide, Transition } from '../../shared/model';
import { savedFrom } from '../recovery/live-state';
import { ShowEngine } from './show-engine';
import { MemorySlideSource } from './slide-source';
import { RecordingTransport, textSlide } from './testing';

/*
 * A deck's slide stepped through its clicks (Session 54, C2; deck-steps.ts): Next shows its next step and then the
 * next slide's coming in, the deck's own transition in its clip when it comes in order; Back and Previous show the
 * step before at its last frame at once, then the slide before at its last step; a jump, or Drashti's own transition
 * instead, starts the coming-in clip past the deck's transition under Drashti's; over, Drashti's plays around it. The
 * deck's videos and sounds wait for their click, play from its moment plus their offset, between the deck's trims,
 * and wait again when Back undoes it. Repeat Slides goes through the clicks too, and a restart comes back on the step.
 * Placeholder names and made-up media ids only.
 */

const dissolve = (durationMs: number): Transition => ({ kind: 'dissolve', durationMs });

/** A deck's slide of `steps` steps, each clip a second long, its coming-in clip 400 ms of the deck's own push. */
function deckSlide(id: string, steps: number, extra: Partial<DeckSlide> = {}): RenderSlide {
  const deck: DeckSlide = {
    transition: { name: 'push', durationMs: 400 },
    steps: Array.from({ length: steps }, (_, i) => ({
      clipId: `${id}-clip${String(i)}`,
      clipMs: 1000,
      lastId: `${id}-last${String(i)}`,
      ...(i === 0 ? { transitionMs: 400 } : {}),
    })),
    media: [],
    ...extra,
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

const video = (mediaId: string, start: DeckMedia['start'], more: Partial<DeckMedia> = {}): DeckMedia => ({
  kind: 'video',
  mediaId,
  box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  loop: false,
  volume: 1,
  start,
  ...more,
});

/**
 * The slides of one deck, each coming-in clip made after the slide before it (`after`: that slide's last frame), as an
 * import of the whole deck makes them.
 */
function chained(slides: RenderSlide[]): RenderSlide[] {
  return slides.map((s, i) => {
    const before = slides[i - 1]?.deck?.steps.at(-1)?.lastId;
    return before && s.deck ? { ...s, deck: { ...s.deck, after: before } } : s;
  });
}

function setup(
  slides: RenderSlide[] = [deckSlide('a', 3), deckSlide('b', 2), deckSlide('c', 1)],
  options: {
    transition?: Transition | null;
    autoAdvance?: (number | null)[];
    arrangements?: Record<string, number[]>;
    selected?: string;
  } = {},
) {
  const source = new MemorySlideSource();
  source.set('deck', chained(slides), [], {
    transition: options.transition ?? dissolve(600),
    ...(options.autoAdvance ? { autoAdvance: options.autoAdvance } : {}),
    ...(options.arrangements ? { arrangements: options.arrangements } : {}),
    ...(options.selected ? { selected: options.selected } : {}),
  });
  source.set('plain', [textSlide('x', 'Placeholder one')]);
  let clock = 50_000;
  const waiting: { delay: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, undefined, {
    defaultTransition: () => dissolve(300),
    mediaMarkers: (id) =>
      id === 'clip-video' ? { startMs: 9000, endMs: 9500, markers: [], updatedAt: '2026-10-27' } : null,
    repeatName: (id) => (id === 'lobby' ? 'Placeholder lobby' : null),
    schedule: (delay, run) => {
      const job = { delay, run, cancelled: false };
      waiting.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  const elapse = (ms: number) => {
    clock += ms;
    for (const job of [...waiting]) {
      if (job.cancelled || job.delay > ms) continue;
      waiting.splice(waiting.indexOf(job), 1);
      job.run();
    }
  };
  return { engine, source, elapse, now: () => clock, pending: () => waiting.filter((j) => !j.cancelled) };
}

/** The slide up: its id, its step, how far into its clip it was shown from, and its transition's kind. */
const up = (e: ShowEngine) => {
  const s = e.current.layers.slide;
  return {
    id: s?.slide.id,
    step: s?.step,
    from: s?.stepFromMs ?? 0,
    transition: s?.transition?.kind ?? 'cut',
  };
};

describe('a deck’s slide stepped through its clicks (Session 54, C2)', () => {
  it('Next shows each click, then the next slide coming in order with the deck’s own transition in its clip', () => {
    const { engine, now } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    const shownAt = engine.current.layers.slide?.shownAt;
    expect(engine.current.layers.slide?.stepAt).toBe(shownAt);
    engine.dispatch({ type: 'next' });
    expect(up(engine)).toEqual({ id: 'a', step: 1, from: 0, transition: 'dissolve' });
    // The same slide up, from when it went up: only its step is new, shown now.
    expect(engine.current.layers.slide?.shownAt).toBe(shownAt);
    expect(engine.current.layers.slide?.stepAt).toBe(now());
    expect(engine.current.live.slideIndex).toBe(0);
    engine.dispatch({ type: 'next' });
    expect(up(engine).step).toBe(2);
    // At its last click, Next comes in order: the deck's own push in the clip from its start, no Drashti transition.
    engine.dispatch({ type: 'next' });
    expect(up(engine)).toEqual({ id: 'b', step: 0, from: 0, transition: 'cut' });
    expect(engine.current.live.slideIndex).toBe(1);
  });

  it('says what Next shows: the slide up’s next click, then the next slide coming in', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 0, step: 1 });
    engine.dispatch({ type: 'next' });
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 0, step: 2 });
    engine.dispatch({ type: 'next' });
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 1, step: 0 });
    // Any other slide's next has no step.
    engine.dispatch({ type: 'goLive', presentationId: 'plain', slideIndex: 0 });
    expect(engine.current.next).toBeNull();
  });

  it('Back undoes one click, the step before at its last frame at once, then the slide before at its last step', () => {
    const { engine, now } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    for (let i = 0; i < 4; i++) engine.dispatch({ type: 'next' });
    expect(up(engine)).toMatchObject({ id: 'b', step: 1 });
    engine.dispatch({ type: 'back' });
    // Still, at once: shown from the end of its clip.
    expect(up(engine)).toEqual({ id: 'b', step: 0, from: 1000, transition: 'cut' });
    expect(engine.current.layers.slide?.stepAt).toBe(now());
    engine.dispatch({ type: 'back' });
    // The Next that brought slide b undone exactly: slide a as it was, at its last step.
    expect(up(engine)).toMatchObject({ id: 'a', step: 2 });
    engine.dispatch({ type: 'back' });
    expect(up(engine)).toMatchObject({ id: 'a', step: 1, from: 1000 });
  });

  it('Previous steps back the same way, into the slide before at its last step as a cut', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 1 });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'previous' });
    expect(up(engine)).toEqual({ id: 'b', step: 0, from: 1000, transition: 'dissolve' });
    engine.dispatch({ type: 'previous' });
    expect(up(engine)).toEqual({ id: 'a', step: 2, from: 1000, transition: 'cut' });
    expect(engine.current.live.slideIndex).toBe(0);
  });

  it('a jump starts the coming-in clip past the deck’s own transition, under Drashti’s', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 1 });
    expect(up(engine)).toEqual({ id: 'b', step: 0, from: 400, transition: 'dissolve' });
    expect(engine.current.layers.slide?.transition).toEqual(dissolve(600));
    // From another presentation into the deck's slide 2 by Next: not from the deck's slide before, so a jump too.
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'clearLayer', layer: 'slide' });
    engine.dispatch({ type: 'next' });
    expect(up(engine)).toEqual({ id: 'b', step: 0, from: 400, transition: 'dissolve' });
  });

  it('Drashti’s own transition set instead of the deck’s starts past it in order too; set over, it plays around it', () => {
    const instead = deckSlide('b', 2, {
      drashti: { transition: { kind: 'push', durationMs: 900 }, mode: 'instead' },
    });
    const over = deckSlide('c', 1, { drashti: { transition: dissolve(700), mode: 'over' } });
    const { engine } = setup([deckSlide('a', 1), instead, over]);
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    engine.dispatch({ type: 'next' });
    expect(up(engine)).toEqual({ id: 'b', step: 0, from: 400, transition: 'push' });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(up(engine)).toEqual({ id: 'c', step: 0, from: 0, transition: 'dissolve' });
    expect(engine.current.layers.slide?.transition).toEqual(dissolve(700));
    // Over, by a jump: Drashti's own, past the deck's.
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 2 });
    engine.dispatch({ type: 'goLive', presentationId: 'plain', slideIndex: 0 });
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 2 });
    expect(up(engine)).toEqual({ id: 'c', step: 0, from: 400, transition: 'dissolve' });
  });

  it('comes in order only after the very slide its clip was made after: never past a slide left out of the play order (C review)', () => {
    // The middle slide left out of the order played (unticked, or an arrangement without it): the last slide's
    // coming-in clip begins on the middle one's last frame, which no screen shows, so it comes in past its own
    // transition, under Drashti's.
    const { engine } = setup(undefined, { arrangements: { short: [0, 2] }, selected: 'short' });
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    for (let i = 0; i < 3; i++) engine.dispatch({ type: 'next' });
    expect(engine.current.live.slideIndex).toBe(1);
    expect(up(engine)).toEqual({ id: 'c', step: 0, from: 400, transition: 'dissolve' });
    // Made after the slide before it: in order. One that says nothing of the slide it was made after: always past its
    // own transition.
    const known = setup([deckSlide('a', 1), deckSlide('b', 1)]);
    known.engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    known.engine.dispatch({ type: 'next' });
    expect(up(known.engine)).toMatchObject({ id: 'b', from: 0 });
    const plain = new MemorySlideSource();
    plain.set('deck', [deckSlide('a', 1), deckSlide('b', 1)]);
    const loose = new ShowEngine(plain, new RecordingTransport(), () => 1000);
    loose.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    loose.dispatch({ type: 'next' });
    expect(up(loose)).toMatchObject({ id: 'b', step: 0, from: 400 });
  });

  it('stamps its transition’s sound as the slide comes in with the deck’s own transition, and keeps it through its clicks (C review)', () => {
    const chiming = (id: string, steps: number) =>
      deckSlide(id, steps, { transition: { name: 'push', durationMs: 400, soundId: `${id}-chime` } });
    const { engine } = setup([chiming('a', 1), chiming('b', 2)]);
    // A jump: past the deck's own transition, so no chime.
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(engine.current.layers.slide?.seeks?.['a-chime']).toBeUndefined();
    // In order: its own transition, and its chime, from when it came in, kept as it is clicked on.
    engine.dispatch({ type: 'next' });
    const shownAt = engine.current.layers.slide?.shownAt ?? 0;
    expect(engine.current.layers.slide?.seeks?.['b-chime']).toEqual({ at: shownAt, toMs: 0 });
    engine.dispatch({ type: 'next' });
    expect(up(engine).step).toBe(1);
    expect(engine.current.layers.slide?.seeks?.['b-chime']).toEqual({ at: shownAt, toMs: 0 });
  });

  it('a click on the deck’s slide up never starts it again', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    engine.dispatch({ type: 'next' });
    const was = engine.current.layers.slide;
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    expect(engine.current.layers.slide).toEqual(was);
  });

  it('the deck’s videos wait for their click, play from its moment plus their offset, and wait again after Back', () => {
    const slide = deckSlide('a', 3, {
      media: [
        video('with-slide', { step: 0, offsetMs: 500 }, { clip: { startMs: 1000, endMs: 4000 } }),
        video('at-click', { step: 1, offsetMs: 250 }),
        video('clicked', { clicked: true }),
      ],
    });
    const { engine, now } = setup([slide, deckSlide('b', 1)]);
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    const shownAt = engine.current.layers.slide?.shownAt ?? 0;
    // A jump: the coming-in clip starts 400 ms in, so the one with the slide starts 400 ms sooner.
    expect(engine.current.layers.slide?.seeks).toEqual({
      'with-slide': { at: shownAt + 100, toMs: 1000 },
      'at-click': { at: shownAt, toMs: 0, paused: true, waiting: true },
      clicked: { at: shownAt, toMs: 0, paused: true, waiting: true },
    });
    // Between the deck's own trims, not the library's points.
    expect(engine.current.layers.slide?.clips).toEqual({ 'with-slide': { startMs: 1000, endMs: 4000 } });
    engine.dispatch({ type: 'next' });
    const clickAt = now();
    expect(engine.current.layers.slide?.seeks?.['at-click']).toEqual({ at: clickAt + 250, toMs: 0 });
    expect(engine.current.layers.slide?.seeks?.['with-slide']).toEqual({ at: shownAt + 100, toMs: 1000 });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'previous' });
    // Back to step 1: what step 1 started plays on.
    expect(engine.current.layers.slide?.seeks?.['at-click']).toEqual({ at: clickAt + 250, toMs: 0 });
    engine.dispatch({ type: 'previous' });
    expect(engine.current.layers.slide?.seeks?.['at-click']).toEqual({
      at: now(),
      toMs: 0,
      paused: true,
      waiting: true,
    });
    expect(engine.current.layers.slide?.seeks?.['with-slide']).toEqual({ at: shownAt + 100, toMs: 1000 });
  });

  it('one started only by a click on it plays from the time bar’s Play, in step everywhere', () => {
    const slide = deckSlide('a', 1, { media: [video('clicked', { clicked: true })] });
    slide.elements.push({
      id: 'clicked-el',
      kind: 'video',
      frame: { x: 100, y: 100, width: 800, height: 450 },
      mediaId: 'clicked',
      fit: 'fit',
    });
    const { engine, now } = setup([slide]);
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    engine.learnLength('clicked', 5000);
    expect(
      engine.dispatch({ type: 'resumePlaying', playing: { layer: 'slide', mediaId: 'clicked' } }),
    ).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.slide?.seeks?.['clicked']).toEqual({ at: now(), toMs: 0 });
  });

  it('a deck’s slide coming on by itself steps through its clicks, each for its seconds and never before its clip ends', () => {
    const { engine, elapse, pending } = setup([deckSlide('a', 2), deckSlide('b', 1)], {
      autoAdvance: [400, 3000],
    });
    engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    // Its coming-in clip (1 s, started 400 ms in) outlasts its 400 ms.
    expect(pending().map((j) => j.delay)).toEqual([600]);
    elapse(600);
    expect(up(engine)).toMatchObject({ id: 'a', step: 1 });
    elapse(1000);
    expect(up(engine)).toEqual({ id: 'b', step: 0, from: 0, transition: 'cut' });
  });

  it('Repeat Slides goes through a deck’s clicks, every slide by its own transition, never the deck’s', () => {
    const source = new MemorySlideSource();
    let clock = 10_000;
    const waiting: { delay: number; run: () => void }[] = [];
    source.set('repeat:lobby', [deckSlide('a', 2), deckSlide('b', 1)], [], {
      transition: dissolve(1000),
      autoAdvance: [5000, 5000],
      loop: true,
    });
    const engine = new ShowEngine(source, new RecordingTransport(), () => clock, undefined, {
      repeatName: () => 'Placeholder lobby',
      schedule: (delay, run) => {
        waiting.push({ delay, run });
        return () => undefined;
      },
    });
    const elapse = (ms: number) => {
      clock += ms;
      const due = waiting.splice(0).filter((j) => j.delay <= ms);
      for (const job of due) job.run();
    };
    engine.dispatch({ type: 'startRepeat', playlistId: 'lobby' });
    expect(up(engine)).toEqual({ id: 'a', step: 0, from: 400, transition: 'dissolve' });
    elapse(5000);
    expect(up(engine)).toMatchObject({ id: 'a', step: 1 });
    elapse(5000);
    expect(up(engine)).toEqual({ id: 'b', step: 0, from: 400, transition: 'dissolve' });
    elapse(5000);
    expect(up(engine)).toEqual({ id: 'a', step: 0, from: 400, transition: 'dissolve' });
    expect(engine.current.repeat?.playlistId).toBe('lobby');
  });

  it('comes back after a restart on the same step, where it would be by now', () => {
    const slide = deckSlide('a', 3, { media: [video('at-click', { step: 1, offsetMs: 0 })] });
    const first = setup([slide]);
    first.engine.dispatch({ type: 'goLive', presentationId: 'deck', slideIndex: 0 });
    first.engine.dispatch({ type: 'next' });
    const saved = savedFrom(first.engine.current, 'run-1');
    expect(saved.slide).toMatchObject({ step: 1, stepAt: first.now() });
    const second = setup([slide]);
    second.engine.restore(saved);
    const layer = second.engine.current.layers.slide;
    expect(layer).toMatchObject({ step: 1, stepAt: first.now(), shownAt: saved.slide?.shownAt });
    expect(layer?.seeks?.['at-click']).toEqual({ at: first.now(), toMs: 0 });
    // Next goes on from that step.
    second.engine.dispatch({ type: 'next' });
    expect(up(second.engine).step).toBe(2);
  });
});
