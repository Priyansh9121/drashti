import type { OutputManager } from '../outputs/output-manager';
import { onQuitRefused } from '../outputs/quit-refused';

/** An Electron event as the quit's listeners see it. */
interface QuitEvent {
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

export interface NodeQuitDeps {
  /** How many of this node's screens are showing now. */
  showing(): number;
  /** The tests' DRASHTI_NO_QUIT_CONFIRM: never asked. */
  noConfirm(): boolean;
  /** "Quit Drashti?": true for Quit Drashti, false for Keep showing. */
  ask(showing: number): boolean;
  manager: Pick<OutputManager, 'quitting' | 'cancelQuitting'>;
}

/**
 * A node's quit and its "Quit Drashti?" (review S2). Asked as the quit begins (before-quit: Cmd+Q, the Dock, File ›
 * Quit, a logout), as Main asks: Keep showing stops it there, before Electron closes any window, so no screen goes
 * black. Before, a node asked only as its own window closed, inside Electron's closing of every window: its screens
 * had closed (on a Mac, before the node's window) or went on closing (Windows), and each went black, then reloaded.
 * The window's own close (its X) still asks. Asked once a quit: Quit Drashti holds until the quit is refused.
 */
export class NodeQuit {
  private confirmed = false;
  constructor(private readonly deps: NodeQuitDeps) {}

  /** Whether the quit may go ahead: nothing showing, already said in this quit, or Quit Drashti. */
  private confirm(): boolean {
    if (this.confirmed) return true;
    const showing = this.deps.showing();
    if (showing === 0 || this.deps.noConfirm()) return true;
    this.confirmed = this.deps.ask(showing);
    return this.confirmed;
  }

  beforeQuit(event: QuitEvent): void {
    // A refusal by any listener, this one's Keep showing included, is seen once they have all run.
    onQuitRefused(event, this.refused);
    if (!this.confirm()) {
      event.preventDefault();
      return;
    }
    // No output opens or is put back now (QA24-QUITRACE-1).
    this.deps.manager.quitting();
  }

  windowClose(event: QuitEvent): void {
    if (!this.confirm()) event.preventDefault();
  }

  /** The quit was refused or cancelled: screens follow displays again, and the next quit asks again. */
  readonly refused = (): void => {
    this.confirmed = false;
    this.deps.manager.cancelQuitting();
  };
}
