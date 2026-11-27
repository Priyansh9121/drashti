import { afterEach, expect, it, vi } from 'vitest';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../../shared/engine/state';
import type { EngineMessage, PatchOp } from '../../../shared/engine/protocol';

afterEach(() => {
  vi.useRealTimers();
});

it('holds only the operator’s Go cleanup redraw, without losing revisions or a later Clear', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { connectEngineSource, useEngine } = await import('./engine-store');
  let send: (message: EngineMessage) => void = () => undefined;
  const state = initialEngineState();
  state.videoStart = { id: 'placeholder-cue', at: Date.now(), mediaIds: [], soundIds: [] };
  connectEngineSource(
    {
      onMessage: (listener) => {
        send = listener;
      },
      resync: vi.fn(),
    },
    { deferCueCleanup: true },
  );
  send({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 1, state, sentAt: Date.now() });
  const before = useEngine.getState().state;
  const redraw = vi.fn();
  const unsubscribe = useEngine.subscribe((next, previous) => {
    if (next.state !== previous.state) redraw();
  });
  send({
    kind: 'patch',
    version: ENGINE_STATE_VERSION,
    baseRev: 1,
    rev: 2,
    ops: [{ path: ['videoStart'], value: null }],
    sentAt: Date.now(),
  });
  expect(useEngine.getState().rev).toBe(2);
  expect(useEngine.getState().drawnRev).toBe(1);
  expect(useEngine.getState().state).toBe(before);
  expect(redraw).not.toHaveBeenCalled();
  send({
    kind: 'patch',
    version: ENGINE_STATE_VERSION,
    baseRev: 2,
    rev: 3,
    ops: [{ path: ['blackout'], value: true }],
    sentAt: Date.now(),
  });
  expect(useEngine.getState().state?.videoStart).toBeNull();
  expect(useEngine.getState().state?.blackout).toBe(true);
  expect(redraw).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(250);
  expect(redraw).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it('publishes the held cleanup once at Go + 250 ms even without another message', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { connectEngineSource, useEngine } = await import('./engine-store');
  let send: (message: EngineMessage) => void = () => undefined;
  const state = initialEngineState();
  state.videoStart = { id: 'placeholder-cue', at: Date.now(), mediaIds: [], soundIds: [] };
  connectEngineSource(
    {
      onMessage: (listener) => {
        send = listener;
      },
      resync: vi.fn(),
    },
    { deferCueCleanup: true },
  );
  send({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 1, state, sentAt: Date.now() });
  send({
    kind: 'patch',
    version: ENGINE_STATE_VERSION,
    baseRev: 1,
    rev: 2,
    ops: [{ path: ['videoStart'], value: null }],
    sentAt: Date.now(),
  });
  vi.advanceTimersByTime(249);
  expect(useEngine.getState().state?.videoStart?.id).toBe('placeholder-cue');
  vi.advanceTimersByTime(1);
  expect(useEngine.getState().state?.videoStart).toBeNull();
});

it.each(['audience', 'cancel', 'combined', 'snapshot', 'late'] as const)(
  'publishes %s immediately rather than holding a real show change',
  async (kind) => {
    vi.useFakeTimers();
    vi.resetModules();
    const { connectEngineSource, useEngine } = await import('./engine-store');
    let send: (message: EngineMessage) => void = () => undefined;
    const state = initialEngineState();
    state.videoStart = {
      id: 'placeholder-cue',
      at: Date.now() + (kind === 'cancel' ? 120 : kind === 'late' ? -300 : 0),
      mediaIds: [],
      soundIds: [],
    };
    connectEngineSource(
      {
        onMessage: (listener) => {
          send = listener;
        },
        resync: vi.fn(),
      },
      { deferCueCleanup: kind !== 'audience' },
    );
    send({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 1, state, sentAt: Date.now() });
    if (kind === 'snapshot') {
      send({
        kind: 'snapshot',
        version: ENGINE_STATE_VERSION,
        rev: 2,
        state: { ...state, videoStart: null },
        sentAt: Date.now(),
      });
    } else {
      send({
        kind: 'patch',
        version: ENGINE_STATE_VERSION,
        baseRev: 1,
        rev: 2,
        ops: [
          { path: ['videoStart'], value: null },
          ...(kind === 'combined' ? [{ path: ['blackout'], value: true }] : []),
        ],
        sentAt: Date.now(),
      });
    }
    expect(useEngine.getState().state?.videoStart).toBeNull();
    expect(useEngine.getState().drawnRev).toBe(2);
  },
);


/** An already prepared cue, as Main sends it on Go: the same decoder, armed 120 ms ahead. */
async function preparedGo(operator = true, lead = 120) {
  vi.useFakeTimers();
  vi.resetModules();
  const { connectEngineSource, useEngine } = await import('./engine-store');
  const cue = await import('../render/cue-started');
  let send: (message: EngineMessage) => void = () => undefined;
  const resync = vi.fn();
  const state = initialEngineState();
  state.layers.background = { kind: 'color', color: '#205020' };
  state.videoCue = {
    id: 'placeholder-cue',
    label: 'Placeholder video',
    background: {
      kind: 'media',
      media: 'video',
      mediaId: 'placeholder-video',
      fit: 'fit',
      loop: false,
      startedAt: Date.now(),
      cueId: 'placeholder-cue',
      clip: { startMs: 1000, endMs: 7000 },
    },
    playlist: null,
    required: ['live'],
    ready: ['live'],
  };
  connectEngineSource(
    { onMessage: (listener) => (send = listener), resync },
    { deferCueCleanup: operator },
  );
  send({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 1, state, sentAt: Date.now(), session: 'run-1' });
  const before = useEngine.getState().state;
  let rev = 1;
  const patch = (ops: PatchOp[]) => {
    send({ kind: 'patch', version: ENGINE_STATE_VERSION, baseRev: rev, rev: ++rev, ops, sentAt: Date.now() });
  };
  const at = Date.now() + lead;
  const go = () => patch([
    { path: ['videoStart'], value: { id: 'placeholder-cue', at, mediaIds: [], soundIds: [] } },
    { path: ['videoCue'], value: null },
    { path: ['layers', 'background'], value: { ...state.videoCue!.background, seek: { at, toMs: 1000 } } },
  ]);
  return { useEngine, cue, send, resync, state, before, patch, go, at };
}

it('delivers Go to LIVE immediately while the operator redraw waits for its first moving frame', async () => {
  const { useEngine, cue, before, go } = await preparedGo();
  const redraw = vi.fn();
  const unsubscribe = useEngine.subscribe((next, previous) => {
    if (next.state !== previous.state) redraw();
  });
  go();
  expect(useEngine.getState().state, 'no window-wide Go render ahead of LIVE').toBe(before);
  expect(useEngine.getState()).toMatchObject({ rev: 2, drawnRev: 1, liveRev: 2 });
  const live = useEngine.getState().liveState;
  expect(live?.videoStart?.id, 'LIVE receives its scheduled start at once').toBe('placeholder-cue');
  vi.advanceTimersByTime(120);
  cue.cueStarted('placeholder-cue');
  expect(redraw, 'the rate alone must not release work over the first frames').not.toHaveBeenCalled();
  cue.cueShown('another-placeholder-cue');
  expect(redraw).not.toHaveBeenCalled();
  cue.cueShown('placeholder-cue');
  expect(useEngine.getState().state).toBe(live);
  expect(useEngine.getState().drawnRev).toBe(2);
  expect(redraw).toHaveBeenCalledTimes(1);
  cue.cueShown('placeholder-cue');
  vi.advanceTimersByTime(250);
  expect(redraw, 'one publication, with the fallback cancelled').toHaveBeenCalledTimes(1);
  unsubscribe();
});

it('keeps the Go cleanup behind the same first frame without interrupting LIVE or extending the deadline', async () => {
  const { useEngine, cue, before, patch, go } = await preparedGo();
  go();
  const live = useEngine.getState().liveState;
  vi.advanceTimersByTime(120);
  patch([{ path: ['videoStart'], value: null }]);
  expect(useEngine.getState().state).toBe(before);
  expect(useEngine.getState().liveState, 'cleanup must not redraw LIVE at Go').toBe(live);
  expect(useEngine.getState()).toMatchObject({ rev: 3, drawnRev: 1, liveRev: 2 });
  cue.cueShown('placeholder-cue');
  expect(useEngine.getState().state?.videoStart).toBeNull();
  expect(useEngine.getState().state).toBe(useEngine.getState().liveState);
  expect(useEngine.getState()).toMatchObject({ rev: 3, drawnRev: 3, liveRev: 3 });
});

it.each([false, true])('publishes by Go + 250 ms without a shown signal (cleanup=%s)', async (cleanup) => {
  const { useEngine, before, patch, go } = await preparedGo();
  go();
  vi.advanceTimersByTime(120);
  if (cleanup) patch([{ path: ['videoStart'], value: null }]);
  vi.advanceTimersByTime(249);
  expect(useEngine.getState().state).toBe(before);
  vi.advanceTimersByTime(1);
  expect(useEngine.getState().state?.videoCue).toBeNull();
  expect(useEngine.getState().state).toBe(useEngine.getState().liveState);
  expect(useEngine.getState().drawnRev).toBe(cleanup ? 3 : 2);
});

it.each(['Clear all', 'cancel', 'new cue'] as const)(
  'publishes %s during the Go wait immediately, cancelling both the signal and the fallback',
  async (kind) => {
    const { useEngine, cue, state, patch, go } = await preparedGo();
    go();
    vi.advanceTimersByTime(50);
    patch([
      { path: ['videoStart'], value: null },
      { path: ['layers', 'background'], value: kind === 'Clear all' ? null : state.layers.background },
      { path: ['videoCue'], value: kind === 'new cue' ? { ...state.videoCue, id: 'placeholder-next' } : null },
    ]);
    const current = useEngine.getState().state;
    expect(current?.videoStart).toBeNull();
    expect(current?.videoCue?.id ?? null).toBe(kind === 'new cue' ? 'placeholder-next' : null);
    expect(current?.layers.background).toEqual(kind === 'Clear all' ? null : state.layers.background);
    expect(useEngine.getState().liveState).toBe(current);
    expect(useEngine.getState()).toMatchObject({ rev: 3, drawnRev: 3, liveRev: 3 });
    const redraw = vi.fn();
    const unsubscribe = useEngine.subscribe(redraw);
    cue.cueShown('placeholder-cue');
    vi.advanceTimersByTime(500);
    expect(useEngine.getState().state).toBe(current);
    expect(redraw).not.toHaveBeenCalled();
    unsubscribe();
  },
);

it('never holds a real show change combined with the cleanup after Go', async () => {
  const { useEngine, cue, patch, go } = await preparedGo();
  go();
  vi.advanceTimersByTime(150);
  patch([{ path: ['videoStart'], value: null }, { path: ['blackout'], value: true }]);
  const current = useEngine.getState().state;
  expect(current?.blackout).toBe(true);
  expect(useEngine.getState().liveState).toBe(current);
  cue.cueShown('placeholder-cue');
  vi.advanceTimersByTime(500);
  expect(useEngine.getState().state).toBe(current);
});

it('publishes a restart snapshot immediately and cancels a previous run’s deferred work', async () => {
  const { useEngine, cue, send, go } = await preparedGo();
  go();
  const state = { ...initialEngineState(), blackout: true };
  send({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 0, state, sentAt: Date.now(), session: 'run-2' });
  expect(useEngine.getState().state).toBe(state);
  expect(useEngine.getState().liveState).toBe(state);
  expect(useEngine.getState()).toMatchObject({ rev: 0, drawnRev: 0, liveRev: 0, session: 'run-2' });
  const changed = vi.fn();
  const unsubscribe = useEngine.subscribe(changed);
  cue.cueShown('placeholder-cue');
  vi.advanceTimersByTime(500);
  expect(changed).not.toHaveBeenCalled();
  unsubscribe();
});

it.each([['audience', false, 120], ['late Go', true, -1]] as const)(
  'publishes %s to both views immediately',
  async (_kind, operator, lead) => {
    const { useEngine, go } = await preparedGo(operator, lead);
    go();
    expect(useEngine.getState().state?.videoStart?.id).toBe('placeholder-cue');
    expect(useEngine.getState().state).toBe(useEngine.getState().liveState);
    expect(useEngine.getState()).toMatchObject({ rev: 2, drawnRev: 2, liveRev: 2 });
  },
);

it('keeps a pending Go through stale messages and resync requests without losing protocol revisions', async () => {
  const { useEngine, cue, send, resync, before, patch, go } = await preparedGo();
  go();
  send({ kind: 'patch', version: ENGINE_STATE_VERSION, baseRev: 0, rev: 1, ops: [], sentAt: Date.now() });
  send({ kind: 'patch', version: ENGINE_STATE_VERSION, baseRev: 99, rev: 100, ops: [], sentAt: Date.now() });
  expect(resync).toHaveBeenCalledTimes(1);
  expect(useEngine.getState().state).toBe(before);
  expect(useEngine.getState().rev).toBe(2);
  vi.advanceTimersByTime(120);
  patch([{ path: ['videoStart'], value: null }]);
  cue.cueShown('placeholder-cue');
  expect(useEngine.getState()).toMatchObject({ rev: 3, drawnRev: 3, liveRev: 3 });
});
