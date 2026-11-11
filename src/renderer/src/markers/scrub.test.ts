import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../../shared/engine/commands';
import type { PlayingRef } from '../../../shared/engine/playing';
import { Scrub, SCRUB_EVERY_MS, type ScrubStart } from './scrub';

/*
 * Dragging the time bar (Session 56): a video's picture follows the finger, paused while held, a move at most every
 * SCRUB_EVERY_MS, and plays on from where it is let go; Esc puts it back; a click is one move.
 */

const BG: PlayingRef = { layer: 'background' };

function setup() {
  const sent: EngineCommand[] = [];
  let clock = 0;
  const waits: { at: number; run: () => void; cancelled: boolean }[] = [];
  const scrub = new Scrub({
    send: (command) => {
      sent.push(command);
      return Promise.resolve();
    },
    now: () => clock,
    later: (ms, run) => {
      const wait = { at: clock + ms, run, cancelled: false };
      waits.push(wait);
      return () => {
        wait.cancelled = true;
      };
    },
  });
  /** Let `ms` pass, running the waits that come due. */
  const pass = (ms: number) => {
    clock += ms;
    for (const w of waits.filter((x) => !x.cancelled && x.at <= clock)) {
      w.cancelled = true;
      w.run();
    }
  };
  /** Every command sent so far, once each has had its turn. */
  const settled = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    return sent.map((c) => (c.type === 'moveTo' ? `move ${String(c.toMs)}` : c.type));
  };
  return { scrub, pass, settled };
}

const start =
  (paused = false, at = 12_000, endMs: number | null = null): (() => ScrubStart) =>
  () => ({ ref: BG, paused, endMs, at: () => at });

describe('dragging the time bar (Session 56)', () => {
  it('pauses what plays at the first move, follows the finger a move at most every SCRUB_EVERY_MS, and plays on from where it is let go', async () => {
    const { scrub, pass, settled } = setup();
    scrub.hold(start(), 10_000);
    expect(scrub.scrubbing).toBe(true);
    expect(scrub.pausedBefore).toBe(false);
    pass(40);
    scrub.hold(start(), 11_000);
    pass(40);
    scrub.hold(start(), 12_500);
    // The latest time under the finger goes once SCRUB_EVERY_MS have passed since the last move; the ones between not.
    expect(await settled()).toEqual(['pausePlaying', 'move 10000']);
    pass(SCRUB_EVERY_MS);
    expect(await settled()).toEqual(['pausePlaying', 'move 10000', 'move 12500']);
    pass(SCRUB_EVERY_MS);
    scrub.hold(start(), 20_000);
    expect(await settled()).toEqual(['pausePlaying', 'move 10000', 'move 12500', 'move 20000']);
    scrub.letGo(BG, 21_000);
    expect(scrub.scrubbing).toBe(false);
    expect(await settled()).toEqual([
      'pausePlaying',
      'move 10000',
      'move 12500',
      'move 20000',
      'move 21000',
      'resumePlaying',
    ]);
    // Nothing waiting goes after it.
    pass(1000);
    expect(await settled()).toHaveLength(6);
  });

  it('paused before, it stays paused where it is let go; let go at the end point of one played once, it holds there', async () => {
    const paused = setup();
    paused.scrub.hold(start(true), 5000);
    paused.scrub.letGo(BG, 6000);
    expect(await paused.settled()).toEqual(['move 5000', 'move 6000']);
    const ending = setup();
    ending.scrub.hold(start(false, 0, 30_000), 29_000);
    ending.scrub.letGo(BG, 30_000);
    expect(await ending.settled()).toEqual(['pausePlaying', 'move 29000', 'move 30000']);
  });

  it('a click, or a key, is one move, as before', async () => {
    const { scrub, settled } = setup();
    scrub.letGo(BG, 8000);
    scrub.letGo(BG, 13_000);
    expect(await settled()).toEqual(['move 8000', 'move 13000']);
  });

  it('Esc or the pointer taken away puts it back where it would be had it never moved, playing on (or paused, as it was)', async () => {
    const { scrub, pass, settled } = setup();
    scrub.hold(start(false, 12_345.6), 40_000);
    pass(500);
    scrub.cancel();
    expect(await settled()).toEqual(['pausePlaying', 'move 40000', 'move 12346', 'resumePlaying']);
    // With no drag under way, nothing.
    scrub.cancel();
    expect(await settled()).toHaveLength(4);
  });

  it('its row gone mid-drag (another file, another showing): nothing more is sent', async () => {
    const { scrub, pass, settled } = setup();
    scrub.hold(start(), 1000);
    expect(await settled()).toEqual(['pausePlaying', 'move 1000']);
    pass(10);
    // Waiting for its turn, and the row redrawn for another file before it comes.
    scrub.hold(start(), 2000);
    scrub.dispose();
    pass(1000);
    scrub.letGo(BG, 3000);
    scrub.cancel();
    expect(await settled()).toEqual(['pausePlaying', 'move 1000']);
    // Drawn again (React's StrictMode does it once in development): it sends again.
    scrub.open();
    scrub.letGo(BG, 4000);
    expect(await settled()).toEqual(['pausePlaying', 'move 1000', 'move 4000']);
  });
});
