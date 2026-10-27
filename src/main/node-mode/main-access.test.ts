import { describe, expect, it } from 'vitest';
import { ACCESS_STOP_AFTER_MS } from '../../shared/access-protocol';
import { MainAccess } from './main-access';

/*
 * A node shows only while it hears a Main that is let in (Session 54, access by Gmail): black at once when Main says
 * it is not, and 2 minutes after it last heard one (from its start, its last picture for those 2 minutes); showing
 * again when it hears one. On a clock the test moves.
 */

function setup() {
  let t = 5_000;
  let engine = 1_000_000;
  let timers: { at: number; run: () => void }[] = [];
  let changes = 0;
  const access = new MainAccess({
    engineNow: () => engine,
    setTimer: (ms, run) => {
      const timer = { at: t + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((x) => x !== timer);
      };
    },
    changed: () => {
      changes++;
    },
    log: () => undefined,
  });
  const move = (ms: number) => {
    t += ms;
    engine += ms;
    for (const timer of timers.filter((x) => x.at <= t)) {
      timers = timers.filter((x) => x !== timer);
      timer.run();
    }
  };
  return { access, move, changes: () => changes, engine: () => engine };
}

describe('a node and its Main’s access (Session 54)', () => {
  it('started while Main is away, shows its last picture for 2 minutes, then black until it hears a Main let in', () => {
    const { access, move, engine } = setup();
    expect(access.stopped).toBeNull();
    expect(access.stop).toBeNull();
    move(ACCESS_STOP_AFTER_MS - 1);
    expect(access.stopped).toBeNull();
    move(1);
    expect(access.stopped).toBe('not-heard');
    expect(access.stop).toEqual({ at: engine() });
    move(30_000);
    access.heard(true);
    expect(access.stopped).toBeNull();
    expect(access.stop).toBeNull();
  });

  it('goes black at once when Main says it is not let in, from that moment, and shows again when it is', () => {
    const { access, move, engine, changes } = setup();
    access.heard(true);
    move(10_000);
    const before = changes();
    access.heard(false);
    expect(access.stopped).toBe('main-stopped');
    expect(access.stop).toEqual({ at: engine() });
    expect(changes()).toBe(before + 1);
    access.heard(true);
    expect(access.stopped).toBeNull();
  });

  it('goes black 2 minutes after it last heard a Main let in, and not before', () => {
    const { access, move } = setup();
    access.heard(true);
    move(60_000);
    access.heard(true);
    move(ACCESS_STOP_AFTER_MS - 1);
    expect(access.stopped).toBeNull();
    move(1);
    expect(access.stopped).toBe('not-heard');
  });

  it('says why when the reason changes, and stops waiting when it goes', () => {
    const { access, move, changes } = setup();
    access.heard(true);
    move(ACCESS_STOP_AFTER_MS);
    expect(access.stopped).toBe('not-heard');
    const before = changes();
    access.heard(false);
    expect(access.stopped).toBe('main-stopped');
    expect(changes()).toBe(before + 1);
    access.dispose();
    move(ACCESS_STOP_AFTER_MS * 2);
    expect(access.stopped).toBe('main-stopped');
  });
});
