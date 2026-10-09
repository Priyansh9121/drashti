import { renderErrorReport, type RenderErrorReport } from '../../../shared/render-errors';

/*
 * React's error handlers for a window's root (Session 23): every render error
 * goes to the window's console and, from Drashti's own windows, to the main
 * process's log. Without them React only left the page empty, and nothing
 * outside the window knew.
 */

export function reportRenderError(
  where: string,
  kind: RenderErrorReport['kind'],
  send?: (report: RenderErrorReport) => Promise<unknown>,
): (error: unknown, info: { componentStack?: string | undefined }) => void {
  return (error, info) => {
    console.error(`Render error in the ${where} (${kind})`, error);
    void send?.(renderErrorReport(where, kind, error, info.componentStack)).catch(() => undefined);
  };
}
