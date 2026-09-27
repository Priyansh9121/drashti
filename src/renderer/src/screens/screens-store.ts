import { create } from 'zustand';
import type { ScreensResult, ScreensSnapshot } from '../../../shared/screens';

interface ScreensView {
  snapshot: ScreensSnapshot | null;
  error: string | null;
  busy: boolean;
}

export const useScreens = create<ScreensView>(() => ({ snapshot: null, error: null, busy: false }));

let started = false;

/** Load the screen setup and keep it current. */
export function connectScreens(): void {
  if (started) return;
  started = true;
  window.drashti.screens.onChanged((snapshot) => {
    useScreens.setState({ snapshot });
  });
  void window.drashti.screens.get().then((snapshot) => {
    useScreens.setState({ snapshot });
  });
}

/** Run a screen action and show its result (or its error message). */
export async function screensAction(run: () => Promise<ScreensResult>): Promise<boolean> {
  useScreens.setState({ busy: true, error: null });
  try {
    const result = await run();
    if (result.ok) {
      useScreens.setState({ snapshot: result.snapshot, busy: false });
      return true;
    }
    useScreens.setState({ error: result.message, busy: false });
    return false;
  } catch (error) {
    useScreens.setState({ error: error instanceof Error ? error.message : String(error), busy: false });
    return false;
  }
}
