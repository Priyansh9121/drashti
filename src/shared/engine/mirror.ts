import { applyPatch } from './patch';
import type { EngineMessage } from './protocol';
import { ENGINE_STATE_VERSION, type EngineState } from './state';

export type MirrorResult =
  /** The message was applied. */
  | 'applied'
  /** Old news (an earlier revision); nothing changed. */
  | 'stale'
  /** A revision is missing; ask for a fresh snapshot. */
  | 'resync'
  /** A different state version; this client cannot use it. */
  | 'incompatible';

/**
 * A renderer's (or remote Node's) copy of the engine state, kept in sync
 * from snapshot and patch messages.
 */
export class EngineMirror {
  private current: EngineState | null = null;
  private revision = -1;
  private run: string | undefined = undefined;

  get state(): EngineState | null {
    return this.current;
  }

  get rev(): number {
    return this.revision;
  }

  /** The engine run this copy follows (undefined before the first snapshot that says). */
  get session(): string | undefined {
    return this.run;
  }

  apply(message: EngineMessage): MirrorResult {
    if (message.version !== ENGINE_STATE_VERSION) return 'incompatible';
    if (message.kind === 'snapshot') {
      // A snapshot from a new run of the engine (Drashti restarted) replaces what was here, whatever
      // its revision: revisions start again from 0.
      const sameRun = message.session === undefined || message.session === this.run;
      if (this.current && sameRun && message.rev < this.revision) return 'stale';
      this.current = message.state;
      this.revision = message.rev;
      if (message.session !== undefined) this.run = message.session;
      return 'applied';
    }
    if (!this.current) return 'resync';
    if (message.rev <= this.revision) return 'stale';
    if (message.baseRev !== this.revision) return 'resync';
    this.current = applyPatch(this.current, message.ops);
    this.revision = message.rev;
    return 'applied';
  }
}
