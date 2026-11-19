import type { EngineSeen } from '../shared/controller-actions';
import type { EngineMessage } from '../shared/engine/protocol';

/** The engine view delivered to this window, for Main's controller conflict guard. */
export class EngineViewStamp {
  current: EngineSeen | undefined;
  private session: string | undefined;
  private newest = -1;

  remember(message: EngineMessage, feed = false): void {
    if (message.kind === 'snapshot') {
      if (!message.session) return;
      if (message.session !== this.session) {
        // Only the ordered feed can replace a known run. An old IPC ask may answer after it.
        if (this.session && !feed) return;
        if (!this.session && !feed && message.rev < this.newest) return;
        this.session = message.session;
        this.newest = message.rev;
      } else if (message.rev < this.newest) return;
      this.newest = message.rev;
      this.current = { session: message.session, rev: message.rev };
      return;
    }
    if (message.rev <= this.newest) return;
    this.newest = message.rev;
    if (this.current && message.baseRev === this.current.rev && message.rev === this.current.rev + 1)
      this.current = { ...this.current, rev: message.rev };
    else this.current = undefined;
  }
}
