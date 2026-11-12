import { renderErrorReport, type RenderErrorReport } from '../../../shared/render-errors';

/*
 * React's error handlers for a window's root (Session 23): every render error
 * goes to the window's console and, from Drashti's own windows, to the main
 * process's log. Without them React only left the page empty, and nothing
 * outside the window knew. One the GPU warm-up's own boundary caught is said to
 * be the warm-up's (Session 57): that warm-up ended there and the page draws the
 * show, so Main reloads nothing for it.
 */

/** Whether the boundary that caught an error says it is the GPU warm-up's (render/WarmUpBoundary.tsx). */
const warmUps = (boundary: unknown): boolean =>
  typeof boundary === 'object' && boundary !== null && 'warmUp' in boundary && boundary.warmUp === true;

export function reportRenderError(
  where: string,
  kind: Exclude<RenderErrorReport['kind'], 'warm-up'>,
  send?: (report: RenderErrorReport) => Promise<unknown>,
): (error: unknown, info: { componentStack?: string | undefined; errorBoundary?: unknown }) => void {
  return (error, info) => {
    const as = kind === 'caught' && warmUps(info.errorBoundary) ? 'warm-up' : kind;
    console.error(`Render error in the ${where} (${as})`, error);
    void send?.(renderErrorReport(where, as, error, info.componentStack)).catch(() => undefined);
  };
}
