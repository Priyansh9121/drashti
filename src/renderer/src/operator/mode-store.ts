import { create } from 'zustand';
import type { OperatorMode } from '../../../shared/mode';

/** Simple Mode or Pro Mode, as the main process keeps it (null until it has said). */
export const useMode = create<{ mode: OperatorMode | null }>(() => ({
  mode: null,
}));

let connected = false;

export function connectMode(): void {
  if (connected) return;
  connected = true;
  window.drashti.app.onModeChanged((mode) => {
    useMode.setState({ mode });
  });
  // The window shows nothing until it knows (App), so it must always come to know (Session 38): when the
  // request fails, Simple Mode, the safe side (only the show's controls, each of which works in either mode),
  // until the main process says otherwise.
  void window.drashti.app.getMode().then(
    (mode) => {
      useMode.setState({ mode });
    },
    (error: unknown) => {
      console.warn('The mode could not be asked, so the window shows Simple Mode', error);
      if (useMode.getState().mode === null) useMode.setState({ mode: 'simple' });
    },
  );
}

export async function enterSimpleMode(): Promise<void> {
  const result = await window.drashti.app.setMode('simple');
  if (result.ok) useMode.setState({ mode: result.mode });
}

/**
 * Back to Pro Mode (Session 55, Part 18: a double-click on Simple Mode's Pro Mode, nothing typed): the problem in
 * words (Simple access refuses it), or null when it worked.
 */
export async function leaveSimpleMode(): Promise<string | null> {
  const result = await window.drashti.app.setMode('pro');
  if (!result.ok) return result.message;
  useMode.setState({ mode: result.mode });
  return null;
}
