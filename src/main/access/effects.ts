import type { EngineState } from '../../shared/engine/state';
import type { StreamStatus } from '../../shared/stream';
import { accessState, isLetIn, onAccessChange } from './gate';
import type { ActivityKind } from './service';

/*
 * What the gate's changes do in a Drashti that has opened (Session 54, access by Gmail, E3). On a stop (revoked,
 * rejected, unknown, or 2 minutes with no answer) everything stops at once, in the main process: the engine fades
 * every screen to black from its own time and changes nothing after (so the hall's screens, the stage, key and
 * fill, the nodes, the phones and the stream's picture all go black together), the stream and the recording end,
 * the nodes are told, the menu keeps only Quit and no key works system-wide. The phones' API and every window's
 * request ask the gate themselves (network-service.ts, ipc/handle.ts). Main's nodes hear whether it is let in at
 * every change and every 15 s: a node stops when told, or 2 minutes after it last heard a Main let in.
 */

/** How often Main tells its nodes it is let in. */
export const TELL_NODES_EVERY_MS = 15_000;

export interface AccessEffects {
  /** The engine: the screens fade to black from now, and nothing changes after. */
  stopShow: () => void;
  stream: { wanted(): { live: boolean; recording: boolean }; end(): unknown; stopRecording(): unknown };
  /** Main's nodes: whether it is let in. */
  tellNodes: (letIn: boolean) => void;
  /** The menu with Quit and the editing keys only. */
  lockMenu: () => void;
  /** No key works system-wide (the uncover shortcut). */
  dropShortcuts: () => void;
  /** Run `run` every `ms`; what it returns stops it. */
  every: (ms: number, run: () => void) => () => void;
  log: (message: string, error?: unknown) => void;
}

/** Follow the gate from now on; what it returns stops following. */
export function followAccess(e: AccessEffects): () => void {
  let stopped = false;
  /** Each step on its own: one that fails never keeps the others from stopping. */
  const step = (what: string, run: () => unknown) => {
    try {
      run();
    } catch (error) {
      e.log(`Access: ${what} did not stop cleanly`, error);
    }
  };
  const stopAll = () => {
    if (stopped) return;
    stopped = true;
    e.log(
      'Access: everything stops: the screens fade to black, the stream and recording end, the nodes and phones stop',
    );
    step('the screens', e.stopShow);
    step('the stream', () => {
      const wanted = e.stream.wanted();
      if (wanted.live) e.stream.end();
      if (wanted.recording) e.stream.stopRecording();
    });
    step('the nodes', () => {
      e.tellNodes(false);
    });
    step('the menu', e.lockMenu);
    step('the keys', e.dropShortcuts);
  };
  const off = onAccessChange((state) => {
    if (state.phase === 'stopped') stopAll();
    else if (!stopped) e.tellNodes(isLetIn());
  });
  const told = e.every(TELL_NODES_EVERY_MS, () => {
    e.tellNodes(isLetIn());
  });
  if (accessState().phase === 'stopped') stopAll();
  else e.tellNodes(isLetIn());
  return () => {
    off();
    told();
  };
}

/** A show counted each time a presentation goes up after another (or the first): never which. */
export function showCounter(count: (kind: ActivityKind) => void): (state: EngineState) => void {
  let last: string | null = null;
  return (state) => {
    const id = state.live.presentationId;
    if (id === null || id === last) return;
    last = id;
    count('shows');
  };
}

/** A stream and a recording counted as each starts (from off): a reconnect is not another. */
export function streamCounter(count: (kind: ActivityKind) => void): (status: StreamStatus) => void {
  let live = false;
  let recording = false;
  return (status) => {
    const liveNow = status.live.state !== 'off';
    const recordingNow = status.recording.state !== 'off';
    if (liveNow && !live) count('streams');
    if (recordingNow && !recording) count('recordings');
    live = liveNow;
    recording = recordingNow;
  };
}
