import type { ScreenStatus } from '../../shared/screens';

/** The parts of an output's window the heartbeat's judging needs (easy to fake in tests). */
export interface JudgedWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  readonly webContents: { isCrashed(): boolean };
}

/**
 * The outputs the heartbeat judges now, on Main and on a node alike (a23-heartbeat, review MA1): showing, or stopped
 * and tried again since; never a page that has crashed and waits for the watchdog, nor one closed, hidden or minimized.
 */
export function judgedOutputs(
  status: readonly Pick<ScreenStatus, 'screenId' | 'state'>[],
  windowOf: (screenId: string) => JudgedWindow | undefined,
): string[] {
  return (
    status
      // Stopped too, as Main always judged (Session 23: a retry that hangs is noticed). On a node it was showing only, so
      // a kept page tried again by the watchdog and still silent was never judged again (review MA1).
      .filter((st) => st.state === 'showing' || st.state === 'stopped')
      .map((st) => st.screenId)
      .filter((id) => {
        const w = windowOf(id);
        return (
          w !== undefined &&
          !w.isDestroyed() &&
          !w.webContents.isCrashed() &&
          w.isVisible() &&
          !w.isMinimized()
        );
      })
  );
}
