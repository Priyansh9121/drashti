/*
 * Whether this computer is let in (Session 54, access by Gmail): the one answer every part of the main process asks
 * before it acts (the IPC handlers, the engine's commands, the outputs, the stream and recording, the phones' API and
 * the nodes), so a window, its devtools or a changed clock can never open Drashti. Only the access service changes
 * it, from the list's signed answers. While it is neither 'in' nor 'warning' (let in, with no answer for a while and
 * the countdown to the stop running), everything stops and only Quit works.
 */

export type AccessPhase =
  /** At start, before the list has answered: nothing opens yet. */
  | 'checking'
  /** This computer is not let in: the lock screen (Request Access, or I Have a Token). */
  | 'locked'
  /** Let in, and the last check was answered. */
  | 'in'
  /** Let in, but the list has not answered for a while: the countdown to the stop runs. */
  | 'warning'
  /** Stopped: revoked, rejected, unknown, or 2 minutes with no answer. Only Quit works. */
  | 'stopped';

export interface AccessState {
  phase: AccessPhase;
  /** The Gmail let in, or asking, as it was typed; null before any. */
  gmail: string | null;
  /** This computer's Gmail is the owner's (the approver's): only then the Access List. */
  owner: boolean;
  /** Why it is locked or stopped, as a code the window puts into words; null otherwise. */
  reason: string | null;
  /** While 'warning': when the stop comes, in ms on the main process's monotonic clock (never the computer's). */
  stopsAt: number | null;
}

let state: AccessState = { phase: 'checking', gmail: null, owner: false, reason: null, stopsAt: null };
const listeners = new Set<(state: AccessState) => void>();

export function accessState(): AccessState {
  return state;
}

/** Let in: the controls, the outputs, the stream, the phones and the nodes may run. */
export function isLetIn(): boolean {
  return state.phase === 'in' || state.phase === 'warning';
}

/** The owner's computer, let in: the only one that sees the Access List. */
export function isOwner(): boolean {
  return isLetIn() && state.owner;
}

/** Hear of every change; returns a way to stop hearing. */
export function onAccessChange(listener: (state: AccessState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The access service's alone: everything listening hears the new state at once. */
export function setAccessState(next: AccessState): void {
  state = next;
  for (const listener of listeners) listener(state);
}
