import { create } from 'zustand';
import type { OutputContext } from '../../../shared/screens';
import { setClockOffset } from '../render/clock';

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
  window.drashti.output.onIdentify((who) => {
    useOutput.setState({
      identify: { name: who.name, groupName: who.groupName, until: Date.now() + 5000 },
    });
  });
  void window.drashti.output.getContext().then((context) => {
    if (context) take(context);
  });
}
