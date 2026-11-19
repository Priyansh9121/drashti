import type { EngineSeen } from '../shared/controller-actions';
import type { EngineMessage } from '../shared/engine/protocol';

/** The engine view delivered to this window, for Main's controller conflict guard. */
export class EngineViewStamp {
  current: EngineSeen | undefined;
  remember(message: EngineMessage, _feed = false): void {
    if (message.kind === 'snapshot')
      this.current = message.session ? { session: message.session, rev: message.rev } : undefined;
    else if (this.current && message.rev === this.current.rev + 1)
      this.current = { ...this.current, rev: message.rev };
    else if (this.current && message.rev > this.current.rev) this.current = undefined;
  }
}
