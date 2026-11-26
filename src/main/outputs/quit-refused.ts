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
