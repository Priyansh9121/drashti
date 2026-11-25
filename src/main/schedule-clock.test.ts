import { describe, expect, it } from 'vitest';
import { RateLimiter } from './network/limits';
import { scheduleClock } from './schedule-clock';

describe("the schedules' clock (backups, the chat's day, its Chat QR and limits)", () => {
  it('is this computer’s clock, ahead by the offset a test starts it with', () => {
    let wall = 1_000_000;
    const clock = scheduleClock(250, () => wall);
    expect(clock.now()).toBe(1_000_250);
    wall += 1500;
    expect(clock.now()).toBe(1_001_750);
  });

  it('moved by a test, runs on from where it was set', () => {
    let wall = 1_000_000;
    const clock = scheduleClock(0, () => wall);
    clock.move(5_000_000);
    expect(clock.now()).toBe(5_000_000);
    wall += 400;
    expect(clock.now()).toBe(5_000_400);
  });

  it('held by a test, stays where it is however long passes, and let go, runs on from there without a jump', () => {
    let wall = 1_000_000;
    const clock = scheduleClock(0, () => wall);
    wall += 100;
    clock.hold(true);
    expect(clock.now()).toBe(1_000_100);
    wall += 60_000;
    expect(clock.now()).toBe(1_000_100);
    // Held twice is held once: it stays at the first moment.
    clock.hold(true);
    wall += 1000;
    expect(clock.now()).toBe(1_000_100);
    clock.hold(false);
    expect(clock.now()).toBe(1_000_100);
    wall += 400;
    expect(clock.now()).toBe(1_000_500);
    // Let go when not held: nothing changes.
    clock.hold(false);
    expect(clock.now()).toBe(1_000_500);
  });

  it('moved while held, stays held at the moment it was moved to', () => {
    let wall = 1_000_000;
    const clock = scheduleClock(0, () => wall);
    clock.hold(true);
    clock.move(9_000_000);
    wall += 5000;
    expect(clock.now()).toBe(9_000_000);
    clock.hold(false);
    wall += 250;
    expect(clock.now()).toBe(9_000_250);
  });

  /*
   * chat-group.spec.ts:231 on CI Mac run 45670893526 (a22-phonemac): one message, then six at once 0.2 s later, took
   * four (the allowance at 4.1); the phone's Send was refused, asked again 400 ms and 1,200 ms later (web/device.ts,
   * ASK_AGAIN_MS), and its third ask was taken: about 1.7-1.8 s after the six, one message of the allowance (one every
   * 2 s) had come back, or nearly. Held, a person's spent allowance stays spent while the phone asks again.
   */
  it("a chat person's allowance (0.5 a second, 5 at once) comes back by the clock while a phone asks again, and not while it is held", () => {
    const run = (thirdAfterSix: number, hold: boolean) => {
      let wall = 0;
      const clock = scheduleClock(0, () => wall);
      const perPerson = new RateLimiter(0.5, 5, () => clock.now());
      // The 500-character message, then six at once 0.2 s later.
      perPerson.take('phone');
      wall = 200;
      if (hold) clock.hold(true);
      const six = Array.from({ length: 6 }, () => perPerson.take('phone'));
      // The phone's Send 40 ms later, asked again 400 ms and 1,200 ms after (each ask with its way there and back).
      const send = [240, 660, 200 + thirdAfterSix].map((at) => {
        wall = at;
        return perPerson.take('phone');
      });
      return { six, send };
    };
    const six = [true, true, true, true, false, false];
    // A tenth of a second decides it: the third ask refused 1.75 s after the six, taken 1.85 s after.
    expect(run(1750, false)).toEqual({ six, send: [false, false, false] });
    expect(run(1850, false)).toEqual({ six, send: [false, false, true] });
    // Held from before the six, every ask is refused, however late it comes.
    expect(run(1850, true)).toEqual({ six, send: [false, false, false] });
    expect(run(60_000, true)).toEqual({ six, send: [false, false, false] });
  });
});
