import type { RenderErrorReport } from '../shared/render-errors';

/*
 * Render errors in Drashti's windows, for the log (Session 23). A window whose
 * page fails as it draws can fail again on every change, so each window gets
 * one line every 10 s at most, and the next line says how many were held back.
 */

const EVERY_MS = 10_000;

export class RenderErrorLog {
  private readonly last = new Map<string, { at: number; held: number }>();

  constructor(
    private readonly write: (line: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Log this window's error, unless one went in the last 10 s (then it is counted). True when logged. */
  report(window: string, report: RenderErrorReport): boolean {
    const now = this.now();
    const seen = this.last.get(window);
    if (seen && now - seen.at < EVERY_MS) {
      seen.held++;
      return false;
    }
    const held = seen?.held ?? 0;
    this.last.set(window, { at: now, held: 0 });
    const where = /^\s*at (\S+)/mu.exec(report.componentStack ?? '')?.[1];
    this.write(
      `Render error in ${window} (${report.kind}): ${report.message}${where ? ` (in ${where})` : ''}${
        held > 0 ? `; ${held} more in this window since the last line` : ''
      }`,
    );
    return true;
  }
}
