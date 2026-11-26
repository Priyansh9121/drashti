/** Check after every synchronous listener has had its chance to refuse the quit. */
export function onQuitRefused(
  event: { readonly defaultPrevented: boolean },
  resume: () => void,
  unload = false,
  _isHeld: () => boolean = () => false,
): void {
  queueMicrotask(() => {
    // will-prevent-unload is inverted: preventDefault permits the unload.
    if (event.defaultPrevented !== unload) resume();
  });
}
