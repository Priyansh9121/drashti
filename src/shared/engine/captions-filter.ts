import type { EngineMessage, EnginePatchMessage, EngineSnapshotMessage } from './protocol';
import type { EngineState } from './state';

/*
 * Live captions never leave this computer except burnt into the stream's own picture (Session 55, Part 10, the speech
 * interface's rule 7): a phone, a stage tablet, the network API and an output node are given every engine message
 * and state without them. A patch keeps its revisions with the captions' op taken out (even when none is left), so a
 * copy following every revision never has a gap to fill with a whole snapshot.
 */

/** The state with no captions (the same object when it has none). */
export function stateWithoutCaptions(state: EngineState): EngineState {
  return (state.captions ?? null) === null ? state : { ...state, captions: null };
}

/** An engine message as a phone or a node may be given it. */
export function withoutCaptions(message: EngineSnapshotMessage): EngineSnapshotMessage;
export function withoutCaptions(message: EnginePatchMessage): EnginePatchMessage;
export function withoutCaptions(message: EngineMessage): EngineMessage;
export function withoutCaptions(message: EngineMessage): EngineMessage {
  if (message.kind === 'snapshot') {
    const state = stateWithoutCaptions(message.state);
    return state === message.state ? message : { ...message, state };
  }
  const ops = message.ops.filter((op) => op.path[0] !== 'captions');
  return ops.length === message.ops.length ? message : { ...message, ops };
}
