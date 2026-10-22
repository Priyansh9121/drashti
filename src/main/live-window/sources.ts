/*
 * Show a Window… (Session 48): which windows the picker may offer. Only other apps' open windows, chosen by
 * name: never a whole display (whatever it is called), never one of Drashti's own windows (the operator
 * window, the window for Zoom, a hall screen's window), and never something it cannot name.
 */

export interface RawWindowSource {
  /** Chromium's capture id: "window:<number>:<n>" for a window, "screen:<number>:<n>" for a display. */
  id: string;
  name: string;
}

const WINDOW_ID = /^window:(\d+):\d+$/u;

/** A window's own part of its id ("window:4021"), or null for anything that is not a window's. */
export function windowKey(id: string): string | null {
  const m = WINDOW_ID.exec(id);
  return m ? `window:${m[1] ?? ''}` : null;
}

/** The windows the picker may offer, in the order given. `own` holds the ids of Drashti's own windows. */
export function othersWindows<T extends RawWindowSource>(
  sources: readonly T[],
  own: ReadonlySet<string>,
): T[] {
  const ours = new Set([...own].map(windowKey).filter((k): k is string => k !== null));
  return sources.filter((s) => {
    const key = windowKey(s.id);
    return key !== null && !ours.has(key) && s.name.trim() !== '';
  });
}
