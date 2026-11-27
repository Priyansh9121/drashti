import { describe, expect, it } from 'vitest';
import { MAX_WAIT_MS, STILL_MS, ShowStill } from './show-still';

/* A reading waits for a pause in the live commands (alpha.24, source-preparation-responsiveness.spec.ts:101). */

function clock() {
  let now = 1_000;
  const timers: { at: number; run: () => void }[] = [];
  const deps = {
    now: () => now,
    setTimer: (ms: number, run: () => void) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
  };
  /** Moves the clock on, running each timer that comes due, in order. */
  const pass = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift();
      now = next.at;
      next.run();
      await Promise.resolve();
    }
    now = until;
    await Promise.resolve();
  };
  return { deps, pass, waiting: () => timers.length };
}

const track = (promise: Promise<boolean>) => {
  const seen: { value?: boolean } = {};
  void promise.then((value) => {
    seen.value = value;
  });
  return seen;
};

describe('a pause in the live commands', () => {
  it('starts at once when no command has come', async () => {
    const { deps } = clock();
    const seen = track(new ShowStill(deps).still(new AbortController().signal));
    await Promise.resolve();
    expect(seen.value).toBe(true);
  });

  it('waits until no command has come for STILL_MS, however many came before', async () => {
    const { deps, pass } = clock();
    const still = new ShowStill(deps);
    still.noted();
    const seen = track(still.still(new AbortController().signal));
    // Next and Back every tenth of a second for a second: no start.
    for (let i = 0; i < 10; i++) {
      await pass(100);
      still.noted();
    }
    expect(seen.value).toBeUndefined();
    await pass(STILL_MS - 1);
    expect(seen.value, 'a moment before the pause is long enough').toBeUndefined();
    await pass(1);
    expect(seen.value).toBe(true);
  });

  it('waits MAX_WAIT_MS at most while the commands keep coming', async () => {
    const { deps, pass, waiting } = clock();
    const still = new ShowStill(deps);
    still.noted();
    const seen = track(still.still(new AbortController().signal));
    for (let at = 0; at < MAX_WAIT_MS - 100; at += 100) {
      await pass(100);
      still.noted();
    }
    expect(seen.value).toBeUndefined();
    await pass(100);
    expect(seen.value).toBe(true);
    expect(waiting(), 'no timer left behind').toBe(0);
  });

  it('says no, at once, when the reading is cancelled meanwhile, and leaves no timer', async () => {
    const { deps, waiting } = clock();
    const still = new ShowStill(deps);
    still.noted();
    const cancel = new AbortController();
    const seen = track(still.still(cancel.signal));
    await Promise.resolve();
    expect(seen.value).toBeUndefined();
    cancel.abort();
    await Promise.resolve();
    expect(seen.value).toBe(false);
    expect(waiting()).toBe(0);
    const already = track(still.still(cancel.signal));
    await Promise.resolve();
    expect(already.value).toBe(false);
  });
});
