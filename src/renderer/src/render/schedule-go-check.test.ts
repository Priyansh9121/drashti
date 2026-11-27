import { afterEach, describe, expect, it, vi } from 'vitest';
import { type GoHoldPage, scheduleGoCheck } from './schedule-go-check';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps a check not asked to go first (a later start that is no cue) on its timer, even with the task scheduler present', () => {
  vi.useFakeTimers();
  const task = vi.fn();
  vi.stubGlobal('scheduler', { postTask: task });
  const run = vi.fn();
  const cancel = scheduleGoCheck(run, 120, false);
  vi.advanceTimersByTime(119);
  expect(run).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(run).toHaveBeenCalledTimes(1);
  expect(task).not.toHaveBeenCalled();
  cancel();
});

it('aborts a superseded or stopped cue Go task', async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal('scheduler', {
    postTask: (_run: () => void, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    },
  });
  const cancel = scheduleGoCheck(vi.fn(), 120, true);
  expect(signal?.aborted).toBe(false);
  cancel();
  expect(signal?.aborted).toBe(true);
  await Promise.resolve();
});

it('retains a cancellable clock check where the browser has no task scheduler', () => {
  vi.useFakeTimers();
  vi.stubGlobal('scheduler', undefined);
  const run = vi.fn();
  const cancel = scheduleGoCheck(run, 120, true);
  cancel();
  vi.advanceTimersByTime(120);
  expect(run).not.toHaveBeenCalled();
});

/*
 * goearly (a24-bgblack-crossfade303.md, CI's Mac): a page's cue Go check, one user-blocking task due at Go, ran only when
 * the task in hand ended: LIVE +37.6 ms behind a 51 ms task begun at Go-12 (phase1 32cea1a9b, video-cue-crossfade:306),
 * LIVE +138 behind tasks begun at Go-17, the hall +22.5 behind one begun after Go-12; each started that late. A visible
 * page's cue Go is also checked 25 ms early, and that check holds the page until Go: work that comes in those last 25 ms
 * waits behind the start.
 */

/** One page's event loop, as Chromium runs it: a user-blocking task before an ordinary one, then by when each is due. */
function eventLoop(start: number) {
  let now = start;
  let order = 0;
  const queue: { due: number; first: boolean; order: number; run: () => void; signal?: AbortSignal }[] = [];
  const scheduler = {
    postTask: (run: () => void, options: { delay: number; priority: string; signal: AbortSignal }) => {
      queue.push({
        due: now + options.delay,
        first: options.priority === 'user-blocking',
        order: order++,
        run,
        signal: options.signal,
      });
      return new Promise(() => undefined);
    },
  };
  return {
    scheduler,
    /** The page's clock: each look at it takes a moment, as a real one does. */
    now: () => (now += 0.05),
    /** An ordinary task (a React commit, a rendering step) due at `at`, keeping the page `ms`. */
    busy: (at: number, ms: number) =>
      queue.push({ due: at, first: false, order: order++, run: () => (now += ms) }),
    /** Run every task as the page would, until none is left. */
    run: () => {
      for (;;) {
        const live = queue.filter((t) => !t.signal?.aborted);
        if (live.length === 0) return;
        // Idle until the next task is due, then the first of those due by then.
        now = Math.max(now, Math.min(...live.map((t) => t.due)));
        const pick = live
          .filter((t) => t.due <= now)
          .sort((a, b) => Number(b.first) - Number(a.first) || a.due - b.due || a.order - b.order)[0];
        if (!pick) return;
        queue.splice(queue.indexOf(pick), 1);
        pick.run();
      }
    },
  };
}

it("holds a visible page for its cue's Go from 25 ms before it: work begun at Go-12 waits behind the start", () => {
  const loop = eventLoop(1000);
  vi.stubGlobal('scheduler', loop.scheduler);
  const goAt = 1120;
  const page = { now: loop.now, realNow: loop.now, visible: () => true, held: () => false, lastGo: null };
  const ranAt: number[] = [];
  scheduleGoCheck(() => ranAt.push(loop.now()), 120, true, goAt, page);
  // CI's Mac, the control run's LIVE: a 51 ms task begun 12 ms before Go.
  loop.busy(goAt - 12, 51);
  loop.run();
  expect(ranAt, 'checked once').toHaveLength(1);
  const late = (ranAt[0] ?? Infinity) - goAt;
  expect(late, 'never before Go').toBeGreaterThanOrEqual(0);
  expect(late, `started ${late.toFixed(1)} ms after Go`).toBeLessThan(1);
});

it("holds a visible page for its cue's Go asked less than 25 ms before it, from at once (a warm-up that came late)", () => {
  const loop = eventLoop(1000);
  vi.stubGlobal('scheduler', loop.scheduler);
  const goAt = 1020;
  const page = { now: loop.now, realNow: loop.now, visible: () => true, held: () => false, lastGo: null };
  const ranAt: number[] = [];
  scheduleGoCheck(() => ranAt.push(loop.now()), 20, true, goAt, page);
  loop.busy(goAt - 5, 40);
  loop.run();
  expect(ranAt).toHaveLength(1);
  const late = (ranAt[0] ?? Infinity) - goAt;
  expect(late, `started ${late.toFixed(1)} ms after Go`).toBeLessThan(1);
  expect(late).toBeGreaterThanOrEqual(0);
});

describe('the early check for a cue’s Go: only where and when it can help, never long, once', () => {
  const setUp = (change: Partial<GoHoldPage> = {}) => {
    const loop = eventLoop(1000);
    const postTask = vi.fn(loop.scheduler.postTask);
    vi.stubGlobal('scheduler', { postTask });
    const page: GoHoldPage = {
      now: loop.now,
      realNow: loop.now,
      visible: () => true,
      held: () => false,
      lastGo: null,
      ...change,
    };
    const ranAt: number[] = [];
    const check = () => ranAt.push(loop.now());
    return { loop, postTask, page, ranAt, check };
  };

  it('asks for no early check on a hidden page, nor for a start that is no cue’s Go', () => {
    const hidden = setUp({ visible: () => false });
    scheduleGoCheck(hidden.check, 120, true, 1120, hidden.page);
    expect(hidden.postTask, 'hidden: the check at Go alone').toHaveBeenCalledTimes(1);
    const noCue = setUp();
    scheduleGoCheck(noCue.check, 120, true, undefined, noCue.page);
    expect(noCue.postTask, 'no cue’s Go: the check at Go alone').toHaveBeenCalledTimes(1);
  });

  it('never holds a page hidden since, or one whose clock stands still (a test’s hold, the warm-up’s pause)', () => {
    for (const what of ['hidden since', 'clock held'] as const) {
      const visible = vi.fn(() => true);
      const { loop, page, ranAt, check } = setUp(
        what === 'hidden since' ? { visible } : { held: () => true },
      );
      scheduleGoCheck(check, 120, true, 1120, page);
      visible.mockReturnValue(false);
      loop.busy(1108, 51);
      loop.run();
      expect(ranAt, `${what}: the check at Go did it, once`).toHaveLength(1);
      expect(page.lastGo, `${what}: never held`).toBeNull();
    }
  });

  it('holds 25 ms at most, by the page’s own clock: a Go the engine’s clock does not reach is left to the check at Go', () => {
    const loop = eventLoop(1000);
    vi.stubGlobal('scheduler', loop.scheduler);
    // The engine's clock stopped short of Go, without being held.
    const page: GoHoldPage = {
      now: () => 1110,
      realNow: loop.now,
      visible: () => true,
      held: () => false,
      lastGo: null,
    };
    const ranAt: number[] = [];
    // Two players starting at that Go: the page is held for it once, not again by the second's early check.
    scheduleGoCheck(() => ranAt.push(loop.now()), 120, true, 1120, page);
    scheduleGoCheck(() => ranAt.push(loop.now()), 120, true, 1120, page);
    loop.run();
    expect(ranAt, 'the checks at Go did it, once each').toHaveLength(2);
    expect(page.lastGo, 'held for that Go').toBe(1120);
    // Held from 1095, it gave up by 1120, so the checks due at Go ran then, not later.
    for (const at of ranAt) expect(at).toBeLessThan(1121);
  });

  it('holds a page once for a Go, however many of its players start at it', () => {
    const { loop, page, ranAt, check } = setUp();
    const holds = vi.spyOn(page, 'now');
    scheduleGoCheck(check, 120, true, 1120, page);
    scheduleGoCheck(check, 120, true, 1120, page);
    scheduleGoCheck(check, 120, true, 1120, page);
    loop.run();
    expect(ranAt, 'each player checked once').toHaveLength(3);
    for (const at of ranAt) expect(at - 1120).toBeGreaterThanOrEqual(0);
    // One hold of 25 ms reads the clock about 500 times (0.05 ms a look); three would be 1,500.
    expect(holds.mock.calls.length).toBeLessThan(700);
  });

  it('leaves a Go still more than 25 ms off when the early check runs (the clock set back meanwhile) to the check at Go', () => {
    const { loop, page, ranAt, check } = setUp();
    scheduleGoCheck(check, 120, true, 1120, page);
    page.now = () => 1080;
    loop.run();
    expect(ranAt, 'the check at Go did it, once').toHaveLength(1);
    expect(page.lastGo, 'never held').toBeNull();
  });

  it('runs at once an early check that comes after Go (a page busy past it), and drops the check at Go', () => {
    const { loop, page, ranAt, check } = setUp();
    scheduleGoCheck(check, 120, true, 1120, page);
    loop.busy(1090, 40);
    loop.run();
    expect(ranAt, 'checked once').toHaveLength(1);
    expect(page.lastGo, 'nothing to hold for').toBeNull();
  });

  it('a superseded or stopped cue Go asks no early check either', () => {
    const { loop, page, ranAt, check } = setUp();
    const cancel = scheduleGoCheck(check, 120, true, 1120, page);
    cancel();
    loop.run();
    expect(ranAt).toHaveLength(0);
  });
});
