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

/** A node's quit and its "Quit Drashti?" question. (Red: today's node, asked only as its window closes.) */
export class NodeQuit {
  constructor(private readonly deps: NodeQuitDeps) {}

  beforeQuit(event: QuitEvent): void {
    this.deps.manager.quitting();
    onQuitRefused(event, this.refused);
  }

  windowClose(event: QuitEvent): void {
    const showing = this.deps.showing();
    if (showing === 0 || this.deps.noConfirm()) return;
    if (!this.deps.ask(showing)) event.preventDefault();
  }

  readonly refused = (): void => {
    this.deps.manager.cancelQuitting();
  };
}
