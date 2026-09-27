import type { EngineState } from './state';

/**
 * Replace the value at `path` with `value`. Paths address plain objects only
 * (for example ['layers', 'slide']); arrays are always replaced whole.
 */
export interface PatchOp {
  path: string[];
  value: unknown;
}

export interface EngineSnapshotMessage {
  kind: 'snapshot';
  /** State version on the wire; receivers refuse versions they do not know. */
  version: number;
  rev: number;
  state: EngineState;
  /** Wall-clock milliseconds when main sent it (for latency measurements). */
  sentAt: number;
}

export interface EnginePatchMessage {
  kind: 'patch';
  version: number;
  /** The revision this patch applies on top of. */
  baseRev: number;
  rev: number;
  ops: PatchOp[];
  sentAt: number;
}

export type EngineMessage = EngineSnapshotMessage | EnginePatchMessage;
