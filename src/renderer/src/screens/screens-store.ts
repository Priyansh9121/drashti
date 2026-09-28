import { create } from 'zustand';
import type { CoverOptions, ScreensResult, ScreensSnapshot } from '../../../shared/screens';

interface PendingCover {
  message: string;
  /** Repeat the request with the operator's consent. */
  proceed: () => void;
}

interface ScreensView {
  snapshot: ScreensSnapshot | null;
  error: string | null;
  busy: boolean;
  /** A request waiting for the operator to agree that an output may cover the controls. */
  pendingCover: PendingCover | null;
}

export const useScreens = create<ScreensView>(() => ({
  snapshot: null,
  error: null,
  busy: false,
  pendingCover: null,
}));

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

/**
 * Run a screen action and show its result (or its error message). If the
 * main process answers that the output would cover the controls, nothing has
 * changed yet: the operator is asked, and on "yes" the action runs again
 * with their consent.
 */
export async function screensAction(
  run: (options?: CoverOptions) => Promise<ScreensResult>,
): Promise<boolean> {
  useScreens.setState({ busy: true, error: null });
  try {
    const result = await run();
    if (result.ok) {
      useScreens.setState({ snapshot: result.snapshot, busy: false });
      return true;
    }
    if (result.confirm === 'covers-operator') {
      useScreens.setState({
        busy: false,
        pendingCover: {
          message: result.message,
          proceed: () => {
            useScreens.setState({ pendingCover: null });
            void screensAction(() => run({ coverOperator: true }));
          },
        },
      });
      return false;
    }
    useScreens.setState({ error: result.message, busy: false });
    return false;
  } catch (error) {
    useScreens.setState({ error: error instanceof Error ? error.message : String(error), busy: false });
    return false;
  }
}

export function cancelCover(): void {
  useScreens.setState({ pendingCover: null });
}
