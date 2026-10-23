import { describe, expect, it } from 'vitest';
import type { EngineMessage, EngineSnapshotMessage } from '../../../shared/engine/protocol';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../../shared/engine/state';
import { connectEngineSource, useEngine } from './engine-store';

/*
 * A page's copy of the show (Session 53), as a phone's or a tablet's keeps it from the network's feed: a page left
 * open while Drashti restarts takes the new run's state, though its revisions start again from 0, and keeps which
 * run its revision counts in, for its Next to say. Placeholder states only.
 */

const run = (rev: number, session: string, blackout: boolean): EngineSnapshotMessage => ({
  kind: 'snapshot',
  version: ENGINE_STATE_VERSION,
  rev,
  state: { ...initialEngineState(), blackout },
  sentAt: 0,
  session,
});

describe('a page’s copy of the show', () => {
  it('follows a new run of the engine whatever its revision, and keeps which run it is', () => {
    let send: (message: EngineMessage) => void = () => undefined;
    let resyncs = 0;
    connectEngineSource({
      onMessage: (listener) => {
        send = listener;
      },
      resync: () => {
        resyncs++;
      },
    });
    send(run(57, 'placeholder-run-1', false));
    expect(useEngine.getState()).toMatchObject({ rev: 57, session: 'placeholder-run-1', connected: true });
    // Drashti restarted: the new run, a few revisions in.
    send(run(3, 'placeholder-run-2', true));
    expect(useEngine.getState()).toMatchObject({ rev: 3, session: 'placeholder-run-2' });
    expect(useEngine.getState().state?.blackout).toBe(true);
    // Its changes follow on.
    send({
      kind: 'patch',
      version: ENGINE_STATE_VERSION,
      baseRev: 3,
      rev: 4,
      ops: [{ path: ['blackout'], value: false }],
      sentAt: 0,
    });
    expect(useEngine.getState()).toMatchObject({ rev: 4, session: 'placeholder-run-2' });
    expect(useEngine.getState().state?.blackout).toBe(false);
    expect(resyncs).toBe(0);
  });
});
