/*
 * The schedules' clock (Session 14's scheduled backups; alpha.23's chat: its day, its Chat QR's 10 minutes and every
 * chat limit): this computer's own, which only a test moves (DRASHTI_TEST_ARTI_CLOCK, never when packaged). The
 * engine's clock is never moved.
 */
export interface ScheduleClock {
  /** Now on the schedules' clock (ms since 1970). */
  now(): number;
  /** Tests only: the clock set to `wallMs` on this computer's clock, running on from there. */
  move(wallMs: number): void;
}

/** The schedules' clock, `offsetMs` ahead of this computer's (`wall`) until a test moves it. */
export function scheduleClock(offsetMs = 0, wall: () => number = Date.now): ScheduleClock {
  let offset = offsetMs;
  return {
    now: () => wall() + offset,
    move(wallMs) {
      offset = wallMs - wall();
    },
  };
}
