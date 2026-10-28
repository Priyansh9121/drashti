import { afterEach, describe, expect, it } from 'vitest';
import { initialEngineState } from '../../shared/engine/state';
import type { StreamStatus } from '../../shared/stream';
import { STOP_FADE_MS } from '../../shared/access';
import { followAccess, showCounter, streamCounter, TELL_NODES_EVERY_MS } from './effects';
import { type AccessState, setAccessState } from './gate';
import type { ActivityKind } from './service';

/*
 * What a stop does in a Drashti that has opened (Session 54, E3, effects.ts): everything at once, each step on its own
 * so one that fails never keeps the rest from stopping; Main's nodes told at each change and every 15 s; and the
 * Access List's counts (shows, streams, recordings), never what.
 */

const at = (phase: AccessState['phase']): AccessState => ({
  phase,
  gmail: 'placeholder.user@example.com',
  owner: false,
  reason: phase === 'stopped' ? 'revoked' : null,
  stopsAt: null,
});

afterEach(() => {
  setAccessState({ phase: 'checking', gmail: null, owner: false, reason: null, stopsAt: null });
});

function setup(o: { live?: boolean; recording?: boolean; failing?: string } = {}) {
  const did: string[] = [];
  const told: boolean[] = [];
  const laterRuns: { ms: number; run: () => void }[] = [];
  let every: (() => void) | null = null;
  const step = (name: string) => () => {
    did.push(name);
    if (o.failing === name) throw new Error(`placeholder: ${name} failed`);
  };
  const stop = followAccess({
    uncover: step('uncover'),
    later: (ms, run) => {
      laterRuns.push({ ms, run });
    },
    stopShow: step('screens'),
    stream: {
      wanted: () => ({ live: o.live ?? false, recording: o.recording ?? false }),
      end: step('stream'),
      stopRecording: step('recording'),
    },
    tellNodes: (letIn) => told.push(letIn),
    lockMenu: step('menu'),
    dropShortcuts: step('keys'),
    others: [
      { what: 'zoom', stop: step('zoom') },
      { what: 'downloads', stop: step('downloads') },
    ],
    every: (ms, run) => {
      expect(ms).toBe(TELL_NODES_EVERY_MS);
      every = run;
      return () => {
        every = null;
      };
    },
    log: () => undefined,
  });
  return { did, told, tick: () => every?.(), stop, laterRuns };
}

describe('a stop, once Drashti has opened (Session 54)', () => {
  it('stops everything at once, once: the screens, the stream and the recording, the nodes, the menu, the keys and the rest', () => {
    setAccessState(at('in'));
    const { did, told } = setup({ live: true, recording: true });
    expect(told).toEqual([true]);
    setAccessState(at('stopped'));
    expect(did).toEqual(['screens', 'stream', 'recording', 'menu', 'keys', 'zoom', 'downloads']);
    expect(told).toEqual([true, false]);
    // Heard again (a later change), nothing more.
    setAccessState(at('stopped'));
    expect(did).toEqual(['screens', 'stream', 'recording', 'menu', 'keys', 'zoom', 'downloads']);
  });

  it('once the screens have faded, uncovers the operator window: the stop and its Quit never sit under a screen', () => {
    setAccessState(at('in'));
    const { did, laterRuns } = setup();
    setAccessState(at('stopped'));
    expect(did).not.toContain('uncover');
    expect(laterRuns.map((l) => l.ms)).toEqual([STOP_FADE_MS]);
    laterRuns[0]?.run();
    expect(did.at(-1)).toBe('uncover');
  });

  it('with no internet (the list not answering, for up to an hour), stops nothing: the screens, the stream, the recording and the nodes go on', () => {
    setAccessState(at('in'));
    const s = setup({ live: true, recording: true });
    setAccessState(at('warning'));
    s.tick();
    expect(s.did).toEqual([]);
    expect(s.told.every(Boolean)).toBe(true);
    s.stop();
  });

  it('ends only what is going: no stream to end, none ended', () => {
    setAccessState(at('in'));
    const { did } = setup();
    setAccessState(at('stopped'));
    expect(did).toEqual(['screens', 'menu', 'keys', 'zoom', 'downloads']);
  });

  it('goes on with the rest when one step fails', () => {
    setAccessState(at('in'));
    const { did, told } = setup({ live: true, failing: 'screens' });
    setAccessState(at('stopped'));
    expect(did).toEqual(['screens', 'stream', 'menu', 'keys', 'zoom', 'downloads']);
    expect(told.at(-1)).toBe(false);
  });

  it('tells Main’s nodes it is let in at each change and every 15 s, the countdown included', () => {
    setAccessState(at('in'));
    const { told, tick, stop } = setup();
    setAccessState(at('warning'));
    tick();
    expect(told).toEqual([true, true, true]);
    stop();
    tick();
    setAccessState(at('stopped'));
    expect(told).toEqual([true, true, true]);
  });
});

describe('the Access List’s counts (Session 54)', () => {
  it('counts a show each time another presentation goes up, never the same one again', () => {
    const counted: ActivityKind[] = [];
    const seen = showCounter((kind) => counted.push(kind));
    const s = initialEngineState();
    const live = (presentationId: string | null) => ({ ...s, live: { ...s.live, presentationId } });
    for (const id of [null, 'p1', 'p1', null, 'p1', 'p2', 'p1']) seen(live(id));
    expect(counted).toEqual(['shows', 'shows', 'shows']);
  });

  it('counts a stream and a recording as each starts, a reconnect not another', () => {
    const counted: ActivityKind[] = [];
    const heard = streamCounter((kind) => counted.push(kind));
    const status = (live: string, recording: string) =>
      ({ live: { state: live }, recording: { state: recording } }) as unknown as StreamStatus;
    heard(status('off', 'off'));
    heard(status('starting', 'off'));
    heard(status('live', 'starting'));
    heard(status('reconnecting', 'recording'));
    heard(status('live', 'recording'));
    heard(status('off', 'off'));
    heard(status('live', 'off'));
    expect(counted).toEqual(['streams', 'recordings', 'streams']);
  });
});
