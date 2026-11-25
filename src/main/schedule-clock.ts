/*
 * The schedules' clock (Session 14's scheduled backups; alpha.23's chat: its day, its Chat QR's 10 minutes and every
 * chat limit): this computer's own, which only a test moves or holds (DRASHTI_TEST_ARTI_CLOCK, never when packaged).
 * The engine's clock is never moved.
 */
export interface ScheduleClock {
  /** Now on the schedules' clock (ms since 1970). */
  now(): number;
  /** Tests only: the clock set to `wallMs` on this computer's clock, running on from there (held, it stays there). */
  move(wallMs: number): void;
  /**
   * Tests only: held where it is, so nothing that reads it sees time pass (a chat person's allowance comes back by it:
   * a22-phonemac), or let go, running on from where it was held, without a jump.
   */
  hold(held: boolean): void;
}

/** The schedules' clock, `offsetMs` ahead of this computer's (`wall`) until a test moves or holds it. */
export function scheduleClock(offsetMs = 0, wall: () => number = Date.now): ScheduleClock {
  let offset = offsetMs;
  let heldAt: number | null = null;
  const now = () => heldAt ?? wall() + offset;
  return {
    now,
    move(wallMs) {
      if (heldAt === null) offset = wallMs - wall();
      else heldAt = wallMs;
    },
    hold(held) {
      if (held) {
        heldAt ??= now();
        return;
      }
      if (heldAt === null) return;
      offset = heldAt - wall();
      heldAt = null;
    },
  };
}
