import { create } from 'zustand';
import type { OperatorMode } from '../../../shared/mode';

/** Simple Mode or Pro Mode, as the main process keeps it (null until it has said). */
export const useMode = create<{ mode: OperatorMode | null; askingToLeave: boolean }>(() => ({
  mode: null,
  askingToLeave: false,
}));

let connected = false;

export function connectMode(): void {
  if (connected) return;
  connected = true;
  window.drashti.app.onModeChanged((mode) => {
    useMode.setState({ mode, askingToLeave: false });
  });
  // View > Switch to Pro Mode…: ask for the word.
  window.drashti.app.onAskLeaveSimple(() => {
    if (useMode.getState().mode === 'simple') useMode.setState({ askingToLeave: true });
  });
  void window.drashti.app.getMode().then((mode) => {
    useMode.setState({ mode });
  });
}

export async function enterSimpleMode(): Promise<void> {
  const result = await window.drashti.app.setMode('simple');
  if (result.ok) useMode.setState({ mode: result.mode });
}

/** Back to Pro Mode with the word typed; the problem in words, or null when it worked. */
export async function leaveSimpleMode(word: string): Promise<string | null> {
  const result = await window.drashti.app.setMode('pro', word);
  if (!result.ok) return result.message;
  useMode.setState({ mode: result.mode, askingToLeave: false });
  return null;
}
