import { describe, expect, it } from 'vitest';
import { LEVEL_SEND_MS, latestSender } from './latest-sender';

/*
 * X33: a level dragged is sent the first time at once, then at most once each 100 ms, ending on where it was let go,
 * so every screen and the stream's page get a few changes a second, never one for each pixel moved.
 */

/** A clock and timers moved by hand. */
function clock() {
  let now = 0;
  const due: { at: number; run: () => void }[] = [];
  return {
    timers: {
      now: () => now,
      after: (ms: number, run: () => void) => {
        due.push({ at: now + ms, run });
      },
    },
    pass(ms: number) {
      const until = now + ms;
      for (;;) {
        due.sort((a, b) => a.at - b.at);
        const next = due[0];
        if (!next || next.at > until) break;
        due.shift();
        now = next.at;
        next.run();
      }
      now = until;
    },
  };
}

describe('a level sent as the operator moves it (X33)', () => {
  it('goes at once, then at most once each 100 ms, ending on where it was let go', () => {
    const c = clock();
    const sent: [number, number][] = [];
    const move = latestSender((v) => sent.push([c.timers.now(), v]), LEVEL_SEND_MS, c.timers);
    // A drag: a value each 16 ms (a frame) for about a third of a second.
    for (let i = 1; i <= 20; i++) {
      move(1 - i / 100);
      c.pass(16);
    }
    c.pass(500);
    expect(LEVEL_SEND_MS).toBe(100);
    expect(sent[0]).toEqual([0, 0.99]);
    // Never two within 100 ms.
    for (let i = 1; i < sent.length; i++)
      expect((sent[i]?.[0] ?? 0) - (sent[i - 1]?.[0] ?? 0)).toBeGreaterThanOrEqual(100);
    expect(sent.length).toBeLessThanOrEqual(5);
    // The last is where it was let go.
    expect(sent.at(-1)?.[1]).toBe(0.8);
  });

  it('a single move after a quiet moment goes at once; one key press, one level', () => {
    const c = clock();
    const sent: number[] = [];
    const move = latestSender((v) => sent.push(v), LEVEL_SEND_MS, c.timers);
    move(0.5);
    expect(sent).toEqual([0.5]);
    c.pass(1000);
    move(0.49);
    expect(sent).toEqual([0.5, 0.49]);
    // A second press soon after waits its turn, then goes.
    move(0.48);
    expect(sent).toEqual([0.5, 0.49]);
    c.pass(100);
    expect(sent).toEqual([0.5, 0.49, 0.48]);
    c.pass(1000);
    expect(sent).toEqual([0.5, 0.49, 0.48]);
  });
});
