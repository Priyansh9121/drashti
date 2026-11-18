import { describe, expect, it } from 'vitest';
import { STREAM_WARM_CAP_MS, StreamWarm, type StreamWarmFacts, streamWarmAtStart } from './stream-warm';

/*
 * The stream's page's warm-up at Drashti's start (Session 59, X21): made once the start has settled, so its drawing
 * pipelines exist before the stream's page is opened on air (where making them stalled the hall's screens), and never
 * where it would cost the show anything.
 */

const facts = (over: Partial<StreamWarmFacts> = {}): StreamWarmFacts => ({
  node: false,
  selfTest: false,
  testNotAsking: false,
  noGpu: false,
  warmUpsSkipped: false,
  showBack: false,
  streamOpen: false,
  onAir: false,
  asked: false,
  ...over,
});

describe('whether the stream’s warm-up page opens at the start (X21)', () => {
  it('opens with a graphics chip', () => {
    expect(streamWarmAtStart(facts())).toEqual({ warm: true });
  });

  it('never where it would cost the show, nor where there is nothing to make', () => {
    const not = (over: Partial<StreamWarmFacts>) => streamWarmAtStart(facts(over));
    expect(not({ noGpu: true })).toMatchObject({
      warm: false,
      why: 'Chromium draws without a graphics chip',
    });
    expect(not({ showBack: true })).toMatchObject({
      warm: false,
      why: 'the show came back after an unexpected stop',
    });
    expect(not({ streamOpen: true })).toMatchObject({
      warm: false,
      why: 'the stream’s page is open: it warms itself',
    });
    expect(not({ onAir: true })).toMatchObject({ warm: false, why: 'something is on air already' });
    expect(not({ warmUpsSkipped: true })).toMatchObject({
      warm: false,
      why: 'no page warms up at this start',
    });
    expect(not({ node: true })).toMatchObject({ warm: false, why: 'on a node' });
    expect(not({ selfTest: true })).toMatchObject({ warm: false, why: 'in a self-test' });
    expect(not({ testNotAsking: true })).toMatchObject({
      warm: false,
      why: 'in a test that does not ask for it',
    });
    expect(not({ asked: true })).toMatchObject({ warm: false, why: 'it has been done at this start' });
  });
});

/** A controller with fake windows and timers. */
function harness(over: Partial<StreamWarmFacts> = {}) {
  const made: { destroyed: boolean; done: () => void }[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const lines: string[] = [];
  let now = 1000;
  let current = facts(over);
  const warm = new StreamWarm({
    facts: () => current,
    open: (done) => {
      const w = { destroyed: false, done };
      made.push(w);
      return {
        destroy: () => {
          w.destroyed = true;
        },
        isDestroyed: () => w.destroyed,
      };
    },
    log: (line) => lines.push(line),
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return {
        cancel: () => {
          t.cancelled = true;
        },
      };
    },
  });
  return {
    warm,
    made,
    timers,
    lines,
    pass: (ms: number) => {
      now += ms;
    },
    set: (next: Partial<StreamWarmFacts>) => {
      current = { ...current, ...next };
    },
  };
}

describe('the stream’s warm-up page, run once at a start (X21)', () => {
  it('opens once the start has settled, closes when its warm-up is done, and says so', () => {
    const h = harness();
    h.warm.settled();
    expect(h.made).toHaveLength(1);
    expect(h.warm.open).toBe(true);
    h.pass(2400);
    h.made[0]?.done();
    expect(h.made[0]?.destroyed).toBe(true);
    expect(h.warm.open).toBe(false);
    expect(h.lines.join('\n')).toContain('Stream warm-up: done in 2.4 s');
    // Once at a start: settled again, nothing more.
    h.warm.settled();
    expect(h.made).toHaveLength(1);
  });

  it('closes at its cap if its warm-up never says it is done', () => {
    const h = harness();
    h.warm.settled();
    const cap = h.timers.find((t) => t.ms === STREAM_WARM_CAP_MS);
    expect(cap).toBeDefined();
    cap?.fn();
    expect(h.made[0]?.destroyed).toBe(true);
    expect(h.lines.join('\n')).toContain('Stream warm-up: closed at its cap');
  });

  it('closes as the stream’s page opens (it warms itself), and never opens after it', () => {
    const h = harness();
    h.warm.settled();
    h.warm.streamOpened();
    expect(h.made[0]?.destroyed).toBe(true);
    expect(h.timers.every((t) => t.cancelled)).toBe(true);
    const later = harness();
    later.warm.streamOpened();
    later.warm.settled();
    expect(later.made).toHaveLength(0);
  });

  it('never opens where it would not warm, and says why once', () => {
    const h = harness({ noGpu: true });
    h.warm.settled();
    h.warm.settled();
    expect(h.made).toHaveLength(0);
    expect(h.lines).toEqual(['Stream warm-up: not at this start (Chromium draws without a graphics chip)']);
  });

  it('waits for Chromium to say how it draws, then decides (never warming in software before it has)', () => {
    const h = harness({ noGpu: null });
    h.warm.settled();
    expect(h.made).toHaveLength(0);
    h.set({ noGpu: true });
    h.warm.gpuSaid();
    expect(h.made).toHaveLength(0);
    expect(h.lines).toEqual([
      'Stream warm-up: waits for Chromium to say how it draws',
      'Stream warm-up: not at this start (Chromium draws without a graphics chip)',
    ]);
    const chip = harness({ noGpu: null });
    chip.warm.settled();
    chip.set({ noGpu: false });
    chip.warm.gpuSaid();
    expect(chip.made).toHaveLength(1);
  });

  it('closes as Drashti quits', () => {
    const h = harness();
    h.warm.settled();
    h.warm.stop();
    expect(h.made[0]?.destroyed).toBe(true);
    expect(h.timers.every((t) => t.cancelled)).toBe(true);
  });
});
