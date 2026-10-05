import { describe, expect, it } from 'vitest';
import { EngineMirror } from './mirror';
import type { EnginePatchMessage, EngineSnapshotMessage } from './protocol';
import { ENGINE_STATE_VERSION, initialEngineState } from './state';

const snapshot = (rev: number, blackout = false): EngineSnapshotMessage => ({
  kind: 'snapshot',
  version: ENGINE_STATE_VERSION,
  rev,
  state: { ...initialEngineState(), blackout },
  sentAt: 0,
});
const patch = (baseRev: number, rev: number, blackout: boolean): EnginePatchMessage => ({
  kind: 'patch',
  version: ENGINE_STATE_VERSION,
  baseRev,
  rev,
  ops: [{ path: ['blackout'], value: blackout }],
  sentAt: 0,
});

describe('EngineMirror', () => {
  it('needs a snapshot before patches', () => {
    const m = new EngineMirror();
    expect(m.state).toBeNull();
    expect(m.apply(patch(0, 1, true))).toBe('resync');
  });

  it('applies a snapshot then consecutive patches', () => {
    const m = new EngineMirror();
    expect(m.apply(snapshot(4))).toBe('applied');
    expect(m.apply(patch(4, 5, true))).toBe('applied');
    expect(m.state?.blackout).toBe(true);
    expect(m.rev).toBe(5);
  });

  it('asks for a resync when a revision is missing', () => {
    const m = new EngineMirror();
    m.apply(snapshot(1));
    expect(m.apply(patch(2, 3, true))).toBe('resync');
    expect(m.state?.blackout).toBe(false);
    expect(m.rev).toBe(1);
  });

  it('ignores stale messages', () => {
    const m = new EngineMirror();
    m.apply(snapshot(5));
    expect(m.apply(patch(3, 4, true))).toBe('stale');
    expect(m.apply(patch(4, 5, true))).toBe('stale');
    expect(m.apply(snapshot(2, true))).toBe('stale');
    expect(m.state?.blackout).toBe(false);
  });

  it('accepts a newer snapshot at any time', () => {
    const m = new EngineMirror();
    m.apply(snapshot(1));
    expect(m.apply(snapshot(9, true))).toBe('applied');
    expect(m.rev).toBe(9);
  });

  it('takes a snapshot from a new run of the engine whatever its revision (Drashti restarted)', () => {
    const m = new EngineMirror();
    expect(m.apply({ ...snapshot(40), session: 'run-1' })).toBe('applied');
    // The same run: an older snapshot is old news.
    expect(m.apply({ ...snapshot(3, true), session: 'run-1' })).toBe('stale');
    // A new run starts again from 0: its snapshot replaces the copy, and its patches follow it.
    expect(m.apply({ ...snapshot(3, true), session: 'run-2' })).toBe('applied');
    expect(m.session).toBe('run-2');
    expect(m.rev).toBe(3);
    expect(m.state?.blackout).toBe(true);
    expect(m.apply(patch(3, 4, false))).toBe('applied');
    expect(m.state?.blackout).toBe(false);
  });

  it('refuses a different state version', () => {
    const m = new EngineMirror();
    const future: EngineSnapshotMessage = { ...snapshot(1), version: ENGINE_STATE_VERSION + 1 };
    expect(m.apply(future)).toBe('incompatible');
    expect(m.state).toBeNull();
  });
});
