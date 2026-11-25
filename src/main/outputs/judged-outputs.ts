import type { ScreenStatus } from '../../shared/screens';

/** The parts of an output's window the heartbeat's judging needs (easy to fake in tests). */
export interface JudgedWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  readonly webContents: { isCrashed(): boolean };
}

/**
 * The outputs the heartbeat judges now, on Main and on a node alike (a23-heartbeat, review MA1): showing, and never a
 * page that has crashed and waits for the watchdog, nor one closed, hidden or minimized.
 */
export function judgedOutputs(
  status: readonly Pick<ScreenStatus, 'screenId' | 'state'>[],
  windowOf: (screenId: string) => JudgedWindow | undefined,
): string[] {
  return status
    .filter((st) => st.state === 'showing')
    .map((st) => st.screenId)
    .filter((id) => {
      const w = windowOf(id);
      return (
        w !== undefined && !w.isDestroyed() && !w.webContents.isCrashed() && w.isVisible() && !w.isMinimized()
      );
    });
}
