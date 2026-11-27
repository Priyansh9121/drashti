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
 * reloaded (a reload would only warm up, and fail, again). Every error of an output's scene is heard, not only
 * those its log line says (x53, x52's D6a: the line's 10 s hid a page failing again after its reload): first
 * `failed`, which takes off a video the page keeps failing on (keeps-failing.ts), and else the watchdog, which
 * reloads it once and gives up on it if it fails again (Stopped and said).
 */
export function hearRenderErrors(o: {
  log: (line: string) => void;
  watchdog: RendererWatchdog;
  /** Which window sent it: its name, and for an output, the page to reload. */
  windowOf: (sender: WebContents) => { name: string; output: WatchTarget | null };
  /**
   * An output's scene failed: true when what it keeps failing on was taken off (nothing more is done then). Told the
   * output's own page, never only its name, which two outputs may share (S1-1).
   */
  failed?: (window: { name: string; output: WatchTarget }) => boolean;
}): void {
  const lines = new RenderErrorLog(o.log);
  const warmUps = new RenderErrorLog(o.log);
  handle(IPC.app.renderError, (e, raw) => {
    const report = parseRenderErrorReport(raw);
    if (!report) return null;
    const { name, output } = o.windowOf(e.sender);
    if (report.kind === 'warm-up') {
      warmUps.report(name, report);
      return null;
    }
    lines.report(name, report);
    if (output && o.failed?.({ name, output }) !== true) o.watchdog.renderError(output, name, report.message);
    return null;
  });
}
