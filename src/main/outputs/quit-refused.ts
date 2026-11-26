/** Check after every synchronous listener has had its chance to refuse the quit. */
export function onQuitRefused(
  _event: { readonly defaultPrevented: boolean },
  _resume: () => void,
  _unload = false,
): void {}
