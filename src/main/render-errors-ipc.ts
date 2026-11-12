import type { WebContents } from 'electron';
import { IPC } from '../shared/ipc';
import { parseRenderErrorReport } from '../shared/render-errors';
import { handle } from './ipc/handle';
import { RenderErrorLog } from './render-errors';
import type { RendererWatchdog, WatchTarget } from './watchdog';

/**
 * Hear render errors from every window, on Main or a node (Session 23): a line in the log (one per
 * window every 10 s at most), and an output reloaded once through the watchdog. An error in a page's GPU
 * warm-up (Session 57) ended the warm-up there, and the page draws the show without it: its line, on a count
 * of its own (never holding back the line, or the reload, of an error in the show just after it), and nothing
 * reloaded (a reload would only warm up, and fail, again).
 */
export function hearRenderErrors(o: {
  log: (line: string) => void;
  watchdog: RendererWatchdog;
  /** Which window sent it: its name, and for an output, the page to reload. */
  windowOf: (sender: WebContents) => { name: string; output: WatchTarget | null };
}): void {
  const lines = new RenderErrorLog(o.log);
  const warmUps = new RenderErrorLog(o.log);
  handle(IPC.app.renderError, (e, raw) => {
    const report = parseRenderErrorReport(raw);
    if (!report) return null;
    const { name, output } = o.windowOf(e.sender);
    if (report.kind === 'warm-up') warmUps.report(name, report);
    else if (lines.report(name, report) && output) o.watchdog.renderError(output, name, report.message);
    return null;
  });
}
