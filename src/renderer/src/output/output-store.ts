import { create } from 'zustand';
import type { OutputContext } from '../../../shared/screens';
import { setClockOffset } from '../render/clock';
import { watchGpuRestarts, watchMediaReady } from '../render/media-attempts';

interface OutputView {
  context: OutputContext | null;
  identify: { name: string; groupName: string; until: number } | null;
}

export const useOutput = create<OutputView>(() => ({ context: null, identify: null }));

let started = false;

/** Learn which screen this window is, and follow changes to its settings. */
export function connectOutput(): void {
  if (started) return;
  started = true;
  const take = (context: OutputContext) => {
    // On a node, the engine's clock is Main's: this window draws by it (Session 13).
    setClockOffset(context.clockOffsetMs ?? 0);
    useOutput.setState({ context });
  };
  window.drashti.output.onContext(take);
  // On a node: copies that land after a screen asked for them are loaded again.
  watchMediaReady();
  // Videos that failed with a GPU process that stopped play again once another starts (ROB-5).
  watchGpuRestarts();
  window.drashti.output.onIdentify((who) => {
    useOutput.setState({
      // eslint-disable-next-line no-restricted-properties -- Identify's card (setting up, never the show), for its few seconds
      identify: { name: who.name, groupName: who.groupName, until: Date.now() + 5000 },
    });
  });
  void window.drashti.output.getContext().then((context) => {
    if (context) take(context);
  });
}
