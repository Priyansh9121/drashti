import { describe, expect, it } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import { EngineMirror } from '../../shared/engine/mirror';
import { ShowEngine } from './show-engine';
import { MemorySlideSource } from './slide-source';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * Drashti stopped (Session 54, access by Gmail: revoked, rejected, unknown, or 2 minutes with no answer). The engine
 * says so in its state with the time by its own clock, so every screen, node, phone and the stream's picture fades to
 * black from the same moment; and from then on nothing changes the show: no command, nothing moving on by itself.
 */

function setup() {
  let clock = 1000;
  const transport = new RecordingTransport();
  const waits: { run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(makeSource(), transport, () => ++clock, undefined, {
    schedule: (_ms, run) => {
      const wait = { run, cancelled: false };
      waits.push(wait);
      return () => {
        wait.cancelled = true;
      };
    },
  });
  return { engine, transport, waits, now: () => clock };
}

describe('the stop (Session 54)', () => {
  it('fades every screen to black from the engine’s time, sent to every copy of the state', () => {
    const { engine, transport } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    const copy = new EngineMirror();
    copy.apply(engine.snapshot());
    expect(engine.current.stopped ?? null).toBeNull();
    const sent = transport.messages.length;
    expect(engine.stop()).toMatchObject({ ok: true, changed: true });
    const at = engine.current.stopped?.at ?? 0;
    expect(at).toBeGreaterThan(1000);
    for (const m of transport.messages.slice(sent)) copy.apply(m);
    expect(copy.state?.stopped).toEqual({ at });
    // What was up stays in the state (a node's last picture, Put it back): the screens draw black over it.
    expect(copy.state?.layers.slide?.presentationId).toBe('p1');
  });

  it('then changes nothing: every command is refused, and nothing made in here moves the show', () => {
    const { engine } = setup();
    engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    engine.stop();
    const rev = engine.rev;
    expect(engine.dispatch({ type: 'next' })).toEqual({
      ok: false,
      error: 'forbidden',
      message: STOPPED_REFUSAL,
    });
    expect(engine.dispatch({ type: 'toggleBlackout' })).toMatchObject({ ok: false, error: 'forbidden' });
    engine.refreshNext();
    engine.showTicker({ id: 'placeholder', text: 'Placeholder announcement' });
    engine.setQuote(null);
    expect(engine.rev).toBe(rev);
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(engine.stop()).toMatchObject({ ok: true, changed: false });
    expect(engine.rev).toBe(rev);
  });

  it('cancels what was waiting to move on by itself', () => {
    // A slide that moves on by itself after 4 s (auto-advance).
    const source = new MemorySlideSource();
    source.set('p', [textSlide('a', 'One'), textSlide('b', 'Two')], [], {
      autoAdvance: [4000, 4000],
      loop: true,
    });
    const waits: { run: () => void; cancelled: boolean }[] = [];
    const engine = new ShowEngine(source, new RecordingTransport(), () => 1000, undefined, {
      schedule: (_ms, run) => {
        const wait = { run, cancelled: false };
        waits.push(wait);
        return () => {
          wait.cancelled = true;
        };
      },
    });
    engine.dispatch({ type: 'goLive', presentationId: 'p', slideIndex: 0 });
    expect(waits.length).toBeGreaterThan(0);
    engine.stop();
    for (const w of waits) expect(w.cancelled).toBe(true);
    const rev = engine.rev;
    for (const w of waits) w.run();
    expect(engine.rev).toBe(rev);
  });
});
