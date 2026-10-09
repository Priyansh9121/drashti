import type { WebContents } from 'electron';
import { IPC } from '../shared/ipc';
import { parseRenderErrorReport } from '../shared/render-errors';
import { handle } from './ipc/handle';
import { RenderErrorLog } from './render-errors';
import type { RendererWatchdog, WatchTarget } from './watchdog';

/**
 * Hear render errors from every window, on Main or a node (Session 23): a line in the log (one per
 * window every 10 s at most), and an output reloaded once through the watchdog.
 */
export function hearRenderErrors(o: {
  log: (line: string) => void;
  watchdog: RendererWatchdog;
  /** Which window sent it: its name, and for an output, the page to reload. */
  windowOf: (sender: WebContents) => { name: string; output: WatchTarget | null };
}): void {
  const lines = new RenderErrorLog(o.log);
  handle(IPC.app.renderError, (e, raw) => {
    const report = parseRenderErrorReport(raw);
    if (!report) return null;
    const { name, output } = o.windowOf(e.sender);
    if (lines.report(name, report) && output) o.watchdog.renderError(output, name, report.message);
    return null;
  });
}
