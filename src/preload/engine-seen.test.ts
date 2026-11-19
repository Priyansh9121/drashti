import { describe, expect, it } from 'vitest';
import { initialEngineState, ENGINE_STATE_VERSION } from '../shared/engine/state';
import type { EngineMessage } from '../shared/engine/protocol';
import { EngineViewStamp } from './engine-seen';
const snapshot = (rev: number, session = 'placeholder-run'): EngineMessage => ({
  kind: 'snapshot',
  version: ENGINE_STATE_VERSION,
  rev,
  session,
  state: initialEngineState(),
  sentAt: rev,
});
const patch = (baseRev: number, rev: number): EngineMessage => ({
  kind: 'patch',
  version: ENGINE_STATE_VERSION,
  baseRev,
  rev,
  ops: [],
  sentAt: rev,
});

describe('Main’s seen revision while controller actions are on', () => {
  it('never goes backwards when an older snapshot answers after a newer feed message', () => {
    const seen = new EngineViewStamp();
    seen.remember(snapshot(1));
    seen.remember(patch(1, 2), true);
    seen.remember(snapshot(1));
    expect(seen.current).toEqual({ session: 'placeholder-run', rev: 2 });
  });
  it('waits for a fresh snapshot after a gap, even if an older ask answers in between', () => {
    const seen = new EngineViewStamp();
    seen.remember(snapshot(1));
    seen.remember(patch(2, 3), true);
    expect(seen.current).toBeUndefined();
    seen.remember(snapshot(2));
    expect(seen.current).toBeUndefined();
    seen.remember(snapshot(3));
    expect(seen.current).toEqual({ session: 'placeholder-run', rev: 3 });
  });
  it('takes a new run from the feed, and ignores a late ask from the former run', () => {
    const seen = new EngineViewStamp();
    seen.remember(snapshot(20));
    seen.remember(snapshot(0, 'placeholder-new-run'), true);
    seen.remember(snapshot(20));
    expect(seen.current).toEqual({ session: 'placeholder-new-run', rev: 0 });
  });
  it('does not stamp a patch with the wrong base as an applied view', () => {
    const seen = new EngineViewStamp();
    seen.remember(snapshot(1));
    seen.remember(patch(0, 2), true);
    expect(seen.current).toBeUndefined();
  });
});
