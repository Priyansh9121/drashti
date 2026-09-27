import { create } from 'zustand';
import type { OutputContext } from '../../../shared/screens';

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
  window.drashti.output.onContext((context) => {
    useOutput.setState({ context });
  });
  window.drashti.output.onIdentify((who) => {
    useOutput.setState({ identify: { ...who, until: Date.now() + 4000 } });
  });
  void window.drashti.output.getContext().then((context) => {
    if (context) useOutput.setState({ context });
  });
}
