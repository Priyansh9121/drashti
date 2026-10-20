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
});
