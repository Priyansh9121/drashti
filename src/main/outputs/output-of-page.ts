/** An open output window as Main and a node keep it, by its screen: alive or closed, and its page. */
export interface OpenOutput {
  isDestroyed(): boolean;
  readonly webContents: unknown;
}

/**
 * The screen whose open output shows this page (S1-1, the alpha.24 bug hunt): the watchdog's, the heartbeat's and
 * keeps-failing's word about a window goes to that window's own screen. Found by the page itself, never by a name: two
 * TVs of one model share their display's name, and a screen removed and made again keeps its name. A page whose window
 * was closed, or made again for its screen, is no screen's; so is a page that is not an output's (LIVE, the sound
 * player).
 */
export function screenOfPage(outputs: ReadonlyMap<string, OpenOutput>, page: unknown): string | undefined {
  for (const [screenId, w] of outputs) if (!w.isDestroyed() && w.webContents === page) return screenId;
  return undefined;
}
