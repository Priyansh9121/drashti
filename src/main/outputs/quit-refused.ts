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

/** A refused quit: Main as it was before it, its screens again. (Red: today's, the operator window never again.) */
export function resumeAfterRefusal(to: QuitResume, _sourceStop: boolean): void {
  if (!to.libraryOpen()) return;
  to.reset();
  to.screens();
}
