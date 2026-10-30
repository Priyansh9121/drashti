import { describe, expect, it } from 'vitest';
import type { LowerThird } from '../../shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../shared/lower-thirds';
import { parseEngineCommand } from '../../shared/engine/commands';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * A lower third in the engine (Session 44): shown as the library has it, from a moment by the engine's clock;
 * the same one again changes its words without playing its in again; hidden, its out plays from then; Clear
 * all takes it off at once (no out) and Put it back brings it back; Black-out covers it without taking it off.
 */

const lowerThird = (id: string, name: string): LowerThird => ({
  id,
  lines: [name, 'Placeholder title'],
  look: DEFAULT_LOWER_THIRD_LOOK,
  where: 'both',
  animation: 'fade-steady',
});

function setup() {
  const source = makeSource();
  source.set('kirtan', [textSlide('k1', 'Chorus')]);
  let clock = 1000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => (clock += 10));
  return { engine, advance: (ms: number) => (clock += ms) };
}

/** An engine whose clock stands still between steps, and whose waits run when the test lets the time pass. */
function timed() {
  const source = makeSource();
  source.set('kirtan', [textSlide('k1', 'Chorus')]);
  let clock = 100_000;
  const waiting: { at: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, undefined, {
    schedule: (delay, run) => {
      const job = { at: clock + delay, run, cancelled: false };
      waiting.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  /** Let `ms` pass, running each wait that came due, at its time. */
  const elapse = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const due = waiting.filter((j) => !j.cancelled && j.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      waiting.splice(waiting.indexOf(due), 1);
      clock = Math.max(clock, due.at);
      due.run();
    }
    clock = until;
  };
  const pending = () => waiting.filter((j) => !j.cancelled).length;
  return { engine, elapse, pending, now: () => clock };
}

describe('a lower third in the engine', () => {
  it('goes up from now, changes in place, and plays its out from when it was hidden', () => {
    const { engine, advance } = setup();
    expect(
      engine.dispatch({ type: 'showLowerThird', lowerThird: lowerThird('a', 'Placeholder name') }).ok,
    ).toBe(true);
    const up = engine.current.layers.lowerThird;
    expect(up).toMatchObject({ id: 'a', lines: ['Placeholder name', 'Placeholder title'] });
    const shownAt = up?.shownAt ?? 0;
    expect(shownAt).toBeGreaterThan(1000);
    advance(500);
    // Its words changed while up: the same time, so its in does not play again.
    engine.dispatch({ type: 'showLowerThird', lowerThird: lowerThird('a', 'Placeholder name, changed') });
    expect(engine.current.layers.lowerThird).toMatchObject({
      lines: ['Placeholder name, changed', 'Placeholder title'],
      shownAt,
    });
    // Another takes its place, from now.
    engine.dispatch({ type: 'showLowerThird', lowerThird: lowerThird('b', 'Placeholder other') });
    expect(engine.current.layers.lowerThird?.shownAt).toBeGreaterThan(shownAt);
    // Hidden: off the layers, its out from now.
    expect(engine.dispatch({ type: 'hideLowerThird' })).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.lowerThird).toBeNull();
    expect(engine.current.lowerThirdOff?.layer.id).toBe('b');
    // Hiding nothing changes nothing.
    expect(engine.dispatch({ type: 'hideLowerThird' })).toMatchObject({ ok: true, changed: false });
    // Shown again: no out any more.
    engine.dispatch({ type: 'showLowerThird', lowerThird: lowerThird('b', 'Placeholder other') });
    expect(engine.current.lowerThirdOff).toBeNull();
  });

  it('Clear all takes it off at once, as it takes off the slide; Put it back brings it back as it was', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'kirtan', slideIndex: 0 });
    engine.dispatch({ type: 'showLowerThird', lowerThird: lowerThird('a', 'Placeholder name') });
    const shownAt = engine.current.layers.lowerThird?.shownAt;
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.layers.lowerThird).toBeNull();
    expect(engine.current.layers.slide).toBeNull();
    // At once: no out plays.
    expect(engine.current.lowerThirdOff).toBeNull();
    expect(engine.current.canPutBack).toBe(true);
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.lowerThird).toMatchObject({ id: 'a', shownAt });
    expect(engine.current.layers.slide).not.toBeNull();
  });

  it('Black-out covers it and leaves it up, as it does the slide; its own clear plays its out', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'showLowerThird', lowerThird: lowerThird('a', 'Placeholder name') });
    engine.dispatch({ type: 'setBlackout', on: true });
    expect(engine.current.blackout).toBe(true);
    expect(engine.current.layers.lowerThird?.id).toBe('a');
    engine.dispatch({ type: 'setBlackout', on: false });
    engine.dispatch({ type: 'clearLayer', layer: 'lowerThird' });
    expect(engine.current.layers.lowerThird).toBeNull();
    expect(engine.current.lowerThirdOff?.layer.id).toBe('a');
  });

  it('a window, a phone or the API asking is refused one with no words, or an animation the library does not have', () => {
    expect(
      parseEngineCommand({ type: 'showLowerThird', lowerThird: lowerThird('a', 'Placeholder') }).ok,
    ).toBe(true);
    expect(
      parseEngineCommand({ type: 'showLowerThird', lowerThird: { ...lowerThird('a', ''), lines: [''] } }).ok,
    ).toBe(false);
    expect(
      parseEngineCommand({
        type: 'showLowerThird',
        lowerThird: { ...lowerThird('a', 'Placeholder'), animation: 'no-such' },
      }).ok,
    ).toBe(false);
  });

  it('one that hides itself (Session 55, Part 16, R): goes at the seconds chosen from when it went up, playing its out from then, the same on every screen', () => {
    const { engine, elapse, now } = timed();
    engine.dispatch({
      type: 'showLowerThird',
      lowerThird: { ...lowerThird('a', 'Placeholder name'), seconds: 5 },
    });
    const shownAt = engine.current.layers.lowerThird?.shownAt ?? 0;
    expect(shownAt).toBe(now());
    elapse(4999);
    expect(engine.current.layers.lowerThird?.id).toBe('a');
    elapse(1);
    expect(engine.current.layers.lowerThird).toBeNull();
    // Its out from the moment it was due, by the engine's clock.
    expect(engine.current.lowerThirdOff).toMatchObject({ layer: { id: 'a' }, at: shownAt + 5000 });
  });

  it('one that hides itself keeps its time when changed while up, and waits again from the start when shown again; hidden or replaced first, nothing goes by itself', () => {
    const { engine, elapse, pending } = timed();
    const a = { ...lowerThird('a', 'Placeholder name'), seconds: 10 };
    engine.dispatch({ type: 'showLowerThird', lowerThird: a });
    const shownAt = engine.current.layers.lowerThird?.shownAt ?? 0;
    elapse(6000);
    // Its words changed while up: the same time, so it still goes 10 s after it first went up.
    engine.dispatch({ type: 'showLowerThird', lowerThird: { ...a, lines: ['Placeholder name, changed'] } });
    elapse(3999);
    expect(engine.current.layers.lowerThird?.lines).toEqual(['Placeholder name, changed']);
    elapse(1);
    expect(engine.current.layers.lowerThird).toBeNull();
    expect(engine.current.lowerThirdOff?.at).toBe(shownAt + 10_000);
    // Hidden by hand first: nothing goes later, and nothing is left waiting.
    engine.dispatch({ type: 'showLowerThird', lowerThird: a });
    elapse(2000);
    engine.dispatch({ type: 'hideLowerThird' });
    const off = engine.current.lowerThirdOff;
    elapse(20_000);
    expect(engine.current.lowerThirdOff).toEqual(off);
    expect(pending()).toBe(0);
    // Another (until hidden) in its place before its time: that one stays.
    engine.dispatch({ type: 'showLowerThird', lowerThird: a });
    elapse(2000);
    engine.dispatch({ type: 'showLowerThird', lowerThird: lowerThird('b', 'Placeholder other') });
    elapse(60_000);
    expect(engine.current.layers.lowerThird?.id).toBe('b');
    expect(pending()).toBe(0);
  });

  it('one past its time when Put it back brings it back stays off; one still in its time comes back for the rest of it', () => {
    const { engine, elapse } = timed();
    engine.dispatch({ type: 'goLive', presentationId: 'kirtan', slideIndex: 0 });
    engine.dispatch({
      type: 'showLowerThird',
      lowerThird: { ...lowerThird('a', 'Placeholder name'), seconds: 5 },
    });
    const shownAt = engine.current.layers.lowerThird?.shownAt ?? 0;
    elapse(2000);
    engine.dispatch({ type: 'clearAll' });
    elapse(1000);
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.lowerThird).toMatchObject({ id: 'a', shownAt });
    elapse(2000);
    expect(engine.current.layers.lowerThird).toBeNull();
    expect(engine.current.lowerThirdOff?.at).toBe(shownAt + 5000);
    // Past its time by the time it comes back: it never shows again (no change on the screens, no out).
    engine.dispatch({
      type: 'showLowerThird',
      lowerThird: { ...lowerThird('b', 'Placeholder other'), seconds: 5 },
    });
    elapse(1000);
    engine.dispatch({ type: 'clearAll' });
    elapse(10_000);
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.lowerThird).toBeNull();
    expect(engine.current.layers.slide).not.toBeNull();
  });

  it('a window, a phone or the API asking: 5 to 60 seconds, whole, or none', () => {
    const ask = (seconds: unknown) =>
      parseEngineCommand({
        type: 'showLowerThird',
        lowerThird: { ...lowerThird('a', 'Placeholder'), seconds },
      }).ok;
    expect(ask(5)).toBe(true);
    expect(ask(60)).toBe(true);
    expect(ask(undefined)).toBe(true);
    for (const wrong of [4, 61, 2.5, '10', null]) expect(ask(wrong), String(wrong)).toBe(false);
  });
});
