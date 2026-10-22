import { describe, expect, it } from 'vitest';
import type { RenderSlide, TimerElement, Transition } from '../../shared/model';
import { timerAloneSlide, timerElement, type TimerLook } from '../../shared/timer-slides';
import type { TimerDefinition } from '../../shared/timers';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { MemorySlideSource, type SlideSource } from './slide-source';
import { RecordingTransport, textSlide } from './testing';

/*
 * A timer alone on the screens (Session 50). Show on the screens puts a timer up in the Timer only layout, in
 * the slide's place, over whatever background is up, coming on with the slide transition; Clear slide and
 * Clear all take it off; Next goes on in the playlist from where the show was; no presentation is made for it.
 * A countdown on a slide that says so brings the next slide on at zero, by the engine's clock, only while that
 * slide is up and the countdown runs.
 */

const LOOK: TimerLook = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#fde68a',
  shadow: true,
};

const countdown: TimerDefinition = {
  id: 't1',
  name: 'Placeholder countdown',
  kind: 'countdown',
  durationMs: 5 * 60_000,
  targetTime: null,
  allowsOverrun: false,
};

/** A slide with a Timer on it showing `timerId`, and what it does at zero. */
function timerOnSlide(id: string, timerId: string, atZero?: TimerElement['atZero']): RenderSlide {
  const el = timerElement(
    `${id}-timer`,
    timerId,
    { x: 0, y: 0, width: 1920, height: 1080 },
    LOOK,
    281,
    'middle',
  );
  return { ...textSlide(id, 'Placeholder starting in'), elements: [atZero ? { ...el, atZero } : el] };
}

function setup(options: { defaultTransition?: Transition; timerLook?: boolean } = {}) {
  const memory = new MemorySlideSource();
  memory.set('p', [textSlide('a', 'One'), textSlide('b', 'Two'), textSlide('c', 'Three')]);
  memory.set('q', [textSlide('x', 'Next item')]);
  memory.set('z', [timerOnSlide('z0', 't1', 'next'), textSlide('z1', 'After the countdown')], [], {
    transitions: [null, { kind: 'dissolve', durationMs: 600 }],
  });
  memory.set('h', [timerOnSlide('h0', 't1'), textSlide('h1', 'Held')]);
  memory.set('solo', [timerOnSlide('s0', 't1', 'next')]);
  // Every presentation the engine asks the library for.
  const asked: string[] = [];
  const source: SlideSource = {
    order: (id, arrangementId) => {
      asked.push(id);
      return memory.order(id, arrangementId);
    },
  };
  const playlists = new MemoryPlaylistSource();
  playlists.set('list', [
    { id: 'i1', kind: 'presentation', presentationId: 'p', arrangementId: null },
    { id: 'i2', kind: 'presentation', presentationId: 'q', arrangementId: null },
  ]);
  playlists.set('countdown-first', [
    { id: 'c1', kind: 'presentation', presentationId: 'solo', arrangementId: null },
    { id: 'c2', kind: 'presentation', presentationId: 'q', arrangementId: null },
  ]);
  let clock = 100_000;
  const waiting: { at: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, playlists, {
    ...(options.defaultTransition
      ? { defaultTransition: () => options.defaultTransition as Transition }
      : {}),
    ...(options.timerLook === false ? {} : { timerLook: () => LOOK }),
    schedule: (delay, run) => {
      const job = { at: clock + delay, run, cancelled: false };
      waiting.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  engine.setTimers([countdown, { ...countdown, id: 't2', name: 'Placeholder clock', kind: 'clock' }]);
  /** Time passes to `to`, each wait that comes due running then. */
  const until = (to: number) => {
    for (;;) {
      const due = waiting.filter((j) => !j.cancelled && j.at <= to).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      waiting.splice(waiting.indexOf(due), 1);
      clock = Math.max(clock, due.at);
      due.run();
    }
    clock = Math.max(clock, to);
  };
  const pending = () => waiting.filter((j) => !j.cancelled);
  return {
    engine,
    memory,
    asked,
    until,
    pending,
    now: () => clock,
    tick: (ms: number) => (clock += ms),
  };
}

describe('Show on the screens', () => {
  it('puts the timer up alone in the slide’s place, over the background, the show staying where it was', () => {
    const { engine, asked, now } = setup({ defaultTransition: { kind: 'dissolve', durationMs: 800 } });
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 1 });
    engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#123456' } });
    const live = engine.current.live;
    const next = engine.current.next;
    asked.length = 0;
    expect(engine.dispatch({ type: 'showTimer', timerId: 't1' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.slide).toEqual({
      presentationId: 'timer:t1',
      slideIndex: 0,
      slide: timerAloneSlide('t1', LOOK),
      shownAt: now(),
      notes: '',
      transition: { kind: 'dissolve', durationMs: 800 },
      timer: { timerId: 't1', name: 'Placeholder countdown' },
    });
    // The background stays; the show is where it was, and Next will show what it would have.
    expect(engine.current.layers.background).toEqual({ kind: 'color', color: '#123456' });
    expect(engine.current.live).toBe(live);
    expect(engine.current.next).toEqual(next);
    // No presentation is looked for, or made, for it.
    expect(asked).not.toContain('timer:t1');
    expect(engine.current.autoAdvance).toBeNull();
  });

  it('comes on with Drashti’s slide transition; after a cut, or a slow zoom, a fade', () => {
    const cut = setup();
    cut.engine.dispatch({ type: 'showTimer', timerId: 't1' });
    expect(cut.engine.current.layers.slide?.transition).toEqual({ kind: 'dissolve', durationMs: 500 });
    const push = setup({ defaultTransition: { kind: 'push', durationMs: 700 } });
    push.engine.dispatch({ type: 'showTimer', timerId: 't1' });
    expect(push.engine.current.layers.slide?.transition).toEqual({ kind: 'push', durationMs: 700 });
    const zoom = setup({ defaultTransition: { kind: 'zoom', durationMs: 1000, spanMs: 9000 } });
    zoom.engine.dispatch({ type: 'showTimer', timerId: 't1' });
    expect(zoom.engine.current.layers.slide?.transition).toEqual({ kind: 'dissolve', durationMs: 1000 });
  });

  it('in Drashti’s own look when the library gives none', () => {
    const { engine } = setup({ timerLook: false });
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    expect(engine.current.layers.slide?.slide.elements[0]).toMatchObject({
      kind: 'timer',
      style: { color: '#ffffff', shadow: true },
    });
  });

  it('shown again it stays as it is; another timer takes its place; a timer no longer there is refused', () => {
    const { engine, tick } = setup();
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    const up = engine.current.layers.slide;
    tick(1000);
    expect(engine.dispatch({ type: 'showTimer', timerId: 't1' })).toMatchObject({ ok: true, changed: false });
    expect(engine.current.layers.slide).toBe(up);
    engine.dispatch({ type: 'showTimer', timerId: 't2' });
    expect(engine.current.layers.slide?.timer).toEqual({ timerId: 't2', name: 'Placeholder clock' });
    expect(engine.dispatch({ type: 'showTimer', timerId: 'gone' })).toMatchObject({
      ok: false,
      error: 'unknown-timer',
    });
  });

  it('Clear slide takes it off, its out from then; Clear all at once, and Put it back brings it back', () => {
    const { engine, now, tick } = setup();
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    const up = engine.current.layers.slide;
    tick(2000);
    engine.dispatch({ type: 'clearLayer', layer: 'slide' });
    expect(engine.current.layers.slide).toBeNull();
    expect(engine.current.slideOff).toEqual({ layer: up, at: now() });
    // Up again: nothing is leaving any more.
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    expect(engine.current.slideOff).toBeNull();
    const again = engine.current.layers.slide;
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.layers.slide).toBeNull();
    expect(engine.current.slideOff).toBeNull();
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.slide).toEqual(again);
  });

  it('Next goes on in the playlist from where the show was, as before; so does Previous', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'playItem', playlistId: 'list', itemId: 'i1' });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    expect(engine.current.layers.slide?.presentationId).toBe('timer:t1');
    expect(engine.current.live).toMatchObject({ presentationId: 'p', slideIndex: 1 });
    expect(engine.current.next).toMatchObject({ kind: 'slide', presentationId: 'p', slideIndex: 2 });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({ presentationId: 'p', slideIndex: 2 });
    expect(engine.current.layers.slide?.timer).toBeUndefined();
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    engine.dispatch({ type: 'next' });
    // The end of the presentation: on to the next item.
    expect(engine.current.layers.slide?.slide.id).toBe('x');
    expect(engine.current.live.playlist).toEqual({ playlistId: 'list', itemId: 'i2' });
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    engine.dispatch({ type: 'previous' });
    expect(engine.current.layers.slide?.slide.id).toBe('c');
  });

  it('with nothing live, Next has nowhere to go and the timer stays up', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: false, error: 'nothing-live' });
    expect(engine.current.layers.slide?.timer?.timerId).toBe('t1');
  });

  it('follows its timer’s new name, and goes off when its timer is removed', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    engine.setTimers([{ ...countdown, name: 'Placeholder renamed' }]);
    expect(engine.current.layers.slide?.timer).toEqual({ timerId: 't1', name: 'Placeholder renamed' });
    engine.setTimers([]);
    expect(engine.current.layers.slide).toBeNull();
  });
});

describe('a countdown on a slide at zero', () => {
  it('brings the next slide on with its transition, by the engine’s clock, while that slide is up', () => {
    const { engine, until, pending } = setup();
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    // Started at 100 000: zero at 400 000.
    engine.dispatch({ type: 'goLive', presentationId: 'z', slideIndex: 0 });
    expect(pending().map((j) => j.at)).toEqual([400_000]);
    until(399_999);
    expect(engine.current.layers.slide?.slide.id).toBe('z0');
    until(400_000);
    expect(engine.current.layers.slide).toMatchObject({
      slide: { id: 'z1' },
      shownAt: 400_000,
      transition: { kind: 'dissolve', durationMs: 600 },
    });
    expect(engine.current.live.slideIndex).toBe(1);
    expect(pending()).toHaveLength(0);
  });

  it('goes on in the playlist, as Next would: the countdown’s presentation done, the next item', () => {
    const { engine, until } = setup();
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    engine.dispatch({ type: 'playItem', playlistId: 'countdown-first', itemId: 'c1' });
    until(400_000);
    expect(engine.current.layers.slide?.slide.id).toBe('x');
    expect(engine.current.live.playlist).toEqual({ playlistId: 'countdown-first', itemId: 'c2' });
  });

  it('holds at 0:00 by default, and on a countdown not running, paused, or at zero before its slide went up', () => {
    const held = setup();
    held.engine.dispatch({ type: 'startTimer', timerId: 't1' });
    held.engine.dispatch({ type: 'goLive', presentationId: 'h', slideIndex: 0 });
    expect(held.pending()).toHaveLength(0);
    held.until(500_000);
    expect(held.engine.current.layers.slide?.slide.id).toBe('h0');

    const stopped = setup();
    stopped.engine.dispatch({ type: 'goLive', presentationId: 'z', slideIndex: 0 });
    expect(stopped.pending()).toHaveLength(0);
    // Started on the slide: from then.
    stopped.tick(1000);
    stopped.engine.dispatch({ type: 'startTimer', timerId: 't1' });
    expect(stopped.pending().map((j) => j.at)).toEqual([401_000]);
    // Paused: it waits no more; started again, it counts on from where it was.
    stopped.tick(1000);
    stopped.engine.dispatch({ type: 'pauseTimer', timerId: 't1' });
    expect(stopped.pending()).toHaveLength(0);
    stopped.tick(5000);
    stopped.engine.dispatch({ type: 'startTimer', timerId: 't1' });
    expect(stopped.pending().map((j) => j.at)).toEqual([406_000]);
    stopped.engine.dispatch({ type: 'resetTimer', timerId: 't1' });
    expect(stopped.pending()).toHaveLength(0);

    const late = setup();
    late.engine.dispatch({ type: 'startTimer', timerId: 't1' });
    late.tick(400_000);
    late.engine.dispatch({ type: 'goLive', presentationId: 'z', slideIndex: 0 });
    expect(late.pending()).toHaveLength(0);
    late.until(900_000);
    expect(late.engine.current.layers.slide?.slide.id).toBe('z0');
  });

  it('another slide, the timer alone or a clear before zero: nothing happens at zero', () => {
    const { engine, until, pending } = setup();
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    engine.dispatch({ type: 'goLive', presentationId: 'z', slideIndex: 0 });
    engine.dispatch({ type: 'showTimer', timerId: 't1' });
    expect(pending()).toHaveLength(0);
    engine.dispatch({ type: 'goLive', presentationId: 'z', slideIndex: 0 });
    engine.dispatch({ type: 'clearLayer', layer: 'slide' });
    expect(pending()).toHaveLength(0);
    until(500_000);
    expect(engine.current.layers.slide).toBeNull();
    expect(engine.current.live.slideIndex).toBe(0);
  });

  it('a zero that came and went unwaited for (its slide edited to go on afterwards): it holds', () => {
    const { engine, memory, until, pending, tick } = setup();
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    engine.dispatch({ type: 'goLive', presentationId: 'h', slideIndex: 0 });
    until(450_000);
    // Edited while it is up, at 0:00, to go on at zero: nothing happens now.
    memory.set('h', [timerOnSlide('h0', 't1', 'next'), textSlide('h1', 'Held')]);
    engine.refreshLive('h');
    expect(engine.current.layers.slide?.slide.elements[0]).toMatchObject({ atZero: 'next' });
    expect(pending()).toHaveLength(0);
    until(500_000);
    expect(engine.current.layers.slide?.slide.id).toBe('h0');
    // Reset and started again on it: at its zero, the next slide.
    tick(1000);
    engine.dispatch({ type: 'resetTimer', timerId: 't1' });
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    until(501_000 + 300_000);
    expect(engine.current.layers.slide?.slide.id).toBe('h1');
  });

  it('a wait that comes a moment early waits again for what is left', () => {
    const { engine, pending, tick } = setup();
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    engine.dispatch({ type: 'goLive', presentationId: 'z', slideIndex: 0 });
    const [job] = pending();
    tick(299_999);
    job?.run();
    expect(engine.current.layers.slide?.slide.id).toBe('z0');
    expect(
      pending()
        .filter((j) => j !== job)
        .map((j) => j.at),
    ).toEqual([400_000]);
  });

  it('on a last slide with nowhere to go, it holds, and waits for nothing more', () => {
    const { engine, until, pending } = setup();
    engine.dispatch({ type: 'startTimer', timerId: 't1' });
    engine.dispatch({ type: 'goLive', presentationId: 'solo', slideIndex: 0 });
    until(400_000);
    expect(engine.current.layers.slide?.slide.id).toBe('s0');
    expect(pending()).toHaveLength(0);
    // Anything else that changes: still nothing to wait for.
    engine.dispatch({ type: 'setBlackout', on: true });
    expect(pending()).toHaveLength(0);
  });
});
