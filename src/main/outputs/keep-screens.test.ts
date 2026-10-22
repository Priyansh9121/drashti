import { beforeEach, describe, expect, it } from 'vitest';
import type { PendingScreens } from '../../shared/keep-screens';
import { KEEP_SCREENS_MS } from '../../shared/keep-screens';
import type { ScreensResult, ScreensSnapshot } from '../../shared/screens';
import type { KeepEnding } from './keep-screens';
import { controlsToPutBack, coveringScreens, KeepScreens, putsOutputOn } from './keep-screens';

/*
 * Keep these screens? (Session 50): a change that puts an output on a display waits 15 s for Keep or Go back,
 * and goes back by itself to exactly the screens as they were. Here the screens are a small pretend world
 * (each screen on a display, in a group with a role), the clock the tests' own.
 */

interface Screen {
  id: string;
  name: string;
  group: string;
  role: string;
  display: number;
  on: boolean;
  width: number;
}
type World = Screen[];

const EMPTY: ScreensSnapshot = { displays: [], groups: [], status: [], nodes: [] };
const ok = (): ScreensResult => ({ ok: true, snapshot: EMPTY });

let world: World;
let covers: boolean;
let now: number;
let timers: { at: number; fn: () => void; cancelled: boolean }[];
let told: (PendingScreens | null)[];
let ended: KeepEnding[];
let restored: { quitting: boolean; world: World }[];
let order: string[];

const advance = (ms: number) => {
  now += ms;
  for (const t of timers.filter((x) => x.at <= now && !x.cancelled)) {
    t.cancelled = true;
    t.fn();
  }
};

function keeper(options: { asks?: boolean; waitMs?: number } = {}): KeepScreens<World> {
  return new KeepScreens<World>({
    capture: () => world.map((s) => ({ ...s })),
    restore: (setup, quitting) => {
      world = setup.map((s) => ({ ...s }));
      restored.push({ quitting, world: setup });
      order.push('restored');
      return ok();
    },
    placed: () =>
      new Map(
        world.filter((s) => s.on).map((s) => [`here ${String(s.display)}`, `${s.id} ${s.group} ${s.role}`]),
      ),
    coversControls: () => covers,
    snapshot: () => EMPTY,
    changed: (pending) => {
      told.push(pending);
      order.push(pending ? 'asked' : 'answered');
    },
    ended: (how) => {
      ended.push(how);
    },
    now: () => now,
    later: (fn, ms) => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    ...options,
  });
}

const hall: Screen = {
  id: 's1',
  name: 'Hall TV',
  group: 'g1',
  role: 'audience',
  display: 2,
  on: true,
  width: 1920,
};
const stage: Screen = {
  id: 's2',
  name: 'Stage TV',
  group: 'g2',
  role: 'stage',
  display: 3,
  on: true,
  width: 1920,
};

/** A change to the world, answered as a screen change is. */
const change = (fn: () => void) => (): ScreensResult => {
  fn();
  return ok();
};

beforeEach(() => {
  world = [{ ...hall }];
  covers = false;
  now = 1_000_000;
  timers = [];
  told = [];
  ended = [];
  restored = [];
  order = [];
});

describe('Keep these screens?', () => {
  it('asks after a change that puts an output on a display, with 15 s to answer; Keep keeps it', () => {
    const keep = keeper();
    expect(keep.current()).toBeNull();
    const result = keep.change(
      change(() => {
        world.push({ ...stage });
      }),
    );
    expect(result.ok).toBe(true);
    const asked = { deadline: now + KEEP_SCREENS_MS, coversControls: false };
    expect(keep.current()).toEqual(asked);
    expect(told).toEqual([asked]);

    expect(keep.keep()).toMatchObject({ ok: true });
    expect(keep.current()).toBeNull();
    expect(told).toEqual([asked, null]);
    expect(ended).toEqual(['kept']);
    // Kept: nothing goes back, now or when the 15 s would have ended.
    advance(KEEP_SCREENS_MS * 2);
    expect(restored).toEqual([]);
    expect(world.map((s) => s.id)).toEqual(['s1', 's2']);
    // Nothing waits any more.
    expect(keep.keep()).toMatchObject({ ok: false });
    expect(keep.goBack()).toMatchObject({ ok: false });
  });

  it('Go back puts back exactly the screens as they were before the change, then says it was answered', () => {
    const keep = keeper();
    const before = world.map((s) => ({ ...s }));
    keep.change(
      change(() => {
        // The setup wizard changes several things at once: a display moved to another group, a new one.
        world[0] = { ...hall, group: 'g9', role: 'stage', name: 'Moved' };
        world.push({ ...stage });
      }),
    );
    expect(keep.goBack()).toMatchObject({ ok: true });
    expect(world).toEqual(before);
    expect(restored).toEqual([{ quitting: false, world: before }]);
    expect(keep.current()).toBeNull();
    // The screens first, then the question goes: the operator window has the screens as they were by then.
    expect(order).toEqual(['asked', 'restored', 'answered']);
    expect(ended).toEqual(['went-back']);
    advance(KEEP_SCREENS_MS);
    expect(restored).toHaveLength(1);
  });

  it('nothing pressed: after 15 s it goes back by itself', () => {
    const keep = keeper();
    const before = world.map((s) => ({ ...s }));
    keep.change(
      change(() => {
        world.push({ ...stage });
      }),
    );
    advance(KEEP_SCREENS_MS - 1);
    expect(keep.current()).not.toBeNull();
    expect(restored).toEqual([]);
    advance(1);
    expect(world).toEqual(before);
    expect(keep.current()).toBeNull();
    expect(told.at(-1)).toBeNull();
    expect(ended).toEqual(['went-back-by-itself']);
  });

  it('turning an output off needs no question, nor does a change that fails or puts nothing new on a display', () => {
    const keep = keeper();
    keep.change(
      change(() => {
        world[0] = { ...hall, on: false };
      }),
    );
    expect(keep.current()).toBeNull();
    // A canvas size: the same output on the same display.
    world = [{ ...hall }];
    keep.change(
      change(() => {
        world[0] = { ...hall, width: 1280 };
      }),
    );
    expect(keep.current()).toBeNull();
    // Refused (the display is used, the operator has not agreed to cover the controls): nothing changed.
    expect(keep.change(() => ({ ok: false, message: 'No.' }))).toEqual({ ok: false, message: 'No.' });
    expect(keep.current()).toBeNull();
    expect(told).toEqual([]);
    advance(KEEP_SCREENS_MS);
    expect(restored).toEqual([]);
  });

  it('asks when a display shows another screen, group or role than it did', () => {
    const keep = keeper();
    // The same screen, now in the stage group (the setup wizard's "The stage view" on that display).
    keep.change(
      change(() => {
        world[0] = { ...hall, group: 'g2', role: 'stage' };
      }),
    );
    expect(keep.current()).not.toBeNull();
    keep.keep();
    // An output turned back on.
    world = [{ ...hall, on: false }];
    keep.change(
      change(() => {
        world[0] = { ...hall };
      }),
    );
    expect(keep.current()).not.toBeNull();
  });

  it('a second change while one waits: Go back returns to the screens before both, and the countdown starts again', () => {
    const keep = keeper();
    const before = world.map((s) => ({ ...s }));
    keep.change(
      change(() => {
        world.push({ ...stage });
      }),
    );
    advance(10_000);
    keep.change(
      change(() => {
        world.push({ ...stage, id: 's3', display: 4 });
      }),
    );
    expect(keep.current()).toEqual({ deadline: now + KEEP_SCREENS_MS, coversControls: false });
    // The first change's 15 s are over, but the countdown started again with the second.
    advance(KEEP_SCREENS_MS - 1);
    expect(restored).toEqual([]);
    advance(1);
    expect(world).toEqual(before);
    expect(restored).toHaveLength(1);
  });

  it('a change that puts nothing on a display while one waits is taken in: Go back undoes it too', () => {
    const keep = keeper();
    const before = world.map((s) => ({ ...s }));
    keep.change(
      change(() => {
        world.push({ ...stage });
      }),
    );
    const asked = keep.current();
    advance(5000);
    keep.change(
      change(() => {
        world[0] = { ...hall, on: false };
      }),
    );
    // The same question, its countdown going on.
    expect(keep.current()).toEqual(asked);
    expect(keep.goBack()).toMatchObject({ ok: true });
    expect(world).toEqual(before);
  });

  it('says when an output covers the controls, and again when that changes (Uncover turned it off)', () => {
    const keep = keeper();
    covers = true;
    keep.change(
      change(() => {
        world.push({ ...stage });
      }),
    );
    expect(keep.current()).toMatchObject({ coversControls: true });
    expect(told).toHaveLength(1);
    // Nothing changed: nothing said.
    keep.refresh();
    expect(told).toHaveLength(1);
    // Uncover: the question stays on the operator window, the covering output's own goes.
    covers = false;
    keep.refresh();
    expect(told.at(-1)).toMatchObject({ coversControls: false });
    expect(keep.current()).toMatchObject({ coversControls: false });
    // Its countdown goes on: nothing pressed, it goes back by itself.
    advance(KEEP_SCREENS_MS);
    expect(ended).toEqual(['went-back-by-itself']);
    // With nothing waiting, nothing is said.
    keep.refresh();
    expect(told.at(-1)).toBeNull();
  });

  it('Drashti quitting while one waits puts the screens back as they were, opening no window', () => {
    const keep = keeper();
    const before = world.map((s) => ({ ...s }));
    keep.change(
      change(() => {
        world.push({ ...stage });
      }),
    );
    keep.quitting();
    expect(restored).toEqual([{ quitting: true, world: before }]);
    expect(keep.current()).toBeNull();
    advance(KEEP_SCREENS_MS);
    expect(restored).toHaveLength(1);
    // Nothing waiting: quitting puts nothing back.
    keep.quitting();
    expect(restored).toHaveLength(1);
  });

  it('takes the time it is given (a test’s), and never asks when told not to (tests not about it)', () => {
    const short = keeper({ waitMs: 3000 });
    short.change(
      change(() => {
        world.push({ ...stage });
      }),
    );
    expect(short.current()).toEqual({ deadline: now + 3000, coversControls: false });
    advance(3000);
    expect(short.current()).toBeNull();

    const never = keeper({ asks: false });
    never.change(
      change(() => {
        world.push({ ...stage });
      }),
    );
    expect(never.current()).toBeNull();
    advance(KEEP_SCREENS_MS);
    expect(world.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('a Go back that fails still ends the question, and says so', () => {
    const keep = new KeepScreens<World>({
      capture: () => world,
      restore: () => {
        throw new Error('the library is busy');
      },
      placed: () => new Map(world.map((s) => [`here ${String(s.display)}`, s.id])),
      coversControls: () => false,
      snapshot: () => EMPTY,
      changed: (pending) => {
        told.push(pending);
      },
      ended: (how) => {
        ended.push(how);
      },
      now: () => now,
      later: () => () => undefined,
      log: () => undefined,
    });
    keep.change(
      change(() => {
        world = [...world, { ...stage }];
      }),
    );
    expect(keep.goBack()).toMatchObject({ ok: false });
    expect(keep.current()).toBeNull();
    expect(told.at(-1)).toBeNull();
    // Said whoever asked: the operator window ignores an answer that was not needed (a race with the 15 s).
    expect(ended).toEqual(['could-not-go-back']);
  });
});

describe('what puts an output on a display, and what covers the controls', () => {
  it('a display that shows something it did not before', () => {
    const was = new Map([['here 2', 's1 g1 audience']]);
    expect(putsOutputOn(was, new Map(was))).toBe(false);
    expect(putsOutputOn(was, new Map())).toBe(false);
    expect(putsOutputOn(was, new Map([['here 2', 's1 g2 stage']]))).toBe(true);
    expect(putsOutputOn(was, new Map([...was, ['here 3', 's2 g1 audience']]))).toBe(true);
    expect(putsOutputOn(was, new Map([['node-1 2', 's1 g1 audience']]))).toBe(true);
  });

  it('the outputs over the display the controls are on (a stopped one is still a window over it)', () => {
    const status = [
      { screenId: 'a', state: 'showing' as const, displayId: 1 },
      { screenId: 'b', state: 'stopped' as const, displayId: 1 },
      { screenId: 'c', state: 'showing' as const, displayId: 2 },
      { screenId: 'd', state: 'disabled' as const, displayId: null },
      { screenId: 'e', state: 'missing-display' as const, displayId: null },
    ];
    expect(coveringScreens(status, 1)).toEqual(['a', 'b']);
    expect(coveringScreens(status, 2)).toEqual(['c']);
    expect(coveringScreens(status, 3)).toEqual([]);
    // Windowed outputs never cover the controls: no display for them.
    expect(coveringScreens(status, null)).toEqual([]);
  });
});

// Section 3's review (Session 50): with another display free, the controls move off an output put on their display
// before the question; Go back puts them back where they were, unless that display has gone.
describe('the controls, put back where they were when the change began', () => {
  const was = { displayId: 1, bounds: { x: 10, y: 20, width: 1280, height: 800 } };
  it('moved to another display by the change: put back', () => {
    expect(controlsToPutBack(was, [1, 2], 2)).toEqual(was.bounds);
  });
  it('still where they were, their display gone, or nothing known: left alone', () => {
    expect(controlsToPutBack(was, [1, 2], 1)).toBeNull();
    expect(controlsToPutBack(was, [2], 2)).toBeNull();
    expect(controlsToPutBack(null, [1, 2], 2)).toBeNull();
    expect(controlsToPutBack({ displayId: null, bounds: null }, [1, 2], 2)).toBeNull();
  });
});
