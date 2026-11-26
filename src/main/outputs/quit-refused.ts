/** Check after every synchronous listener has had its chance to refuse the quit. */
export function onQuitRefused(
  event: { readonly defaultPrevented: boolean },
  resume: () => void,
  unload = false,
  isHeld: () => boolean = () => false,
): void {
  queueMicrotask(() => {
    // will-prevent-unload is inverted: preventDefault permits the unload.
    if (!isHeld() && event.defaultPrevented !== unload) resume();
  });
}

export interface QuitResume {
  /** False once the library has closed: the quit's last stops have begun, and nothing comes back. */
  libraryOpen(): boolean;
  /** Main's quit flags as they were before the quit. */
  reset(): void;
  /** The screens open and follow displays again (OutputManager.cancelQuitting). */
  screens(): void;
  /** Whether the operator window is open. */
  operatorOpen(): boolean;
  /** The operator window made again. */
  openOperator(): void;
}

/**
 * A refused quit: Main as it was before it, its screens again. A refused source stop (the imported slides' own work
 * not stopping in time) after the operator window had closed (its X began the quit, on Windows the usual one) opens it
 * again too, after the screens (review S3, answered as recommended): before, the hall's screens came back with no
 * controls, and nothing but Task Manager could quit Drashti. Any other refusal leaves the operator window as it is.
 */
export function resumeAfterRefusal(to: QuitResume, sourceStop: boolean): void {
  if (!to.libraryOpen()) return;
  to.reset();
  to.screens();
  if (sourceStop && !to.operatorOpen()) to.openOperator();
}
