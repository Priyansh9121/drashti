import { cutText } from './text';

/*
 * A render error in one of Drashti's own windows (Session 23), as the window
 * reports it to the main process for the log. An output draws black when its
 * scene fails, and the main process reloads it once (src/main/watchdog.ts). One
 * in a page's GPU warm-up reloads nothing: the warm-up ended there, and the page
 * draws the show (Session 57).
 */

export interface RenderErrorReport {
  /** Which kind of window: output, operator, node, stream, gallery. */
  where: string;
  /**
   * Caught by an error boundary (the window drew its fallback), not caught (React left the page empty), or caught by
   * the GPU warm-up's own boundary (Session 57: the warm-up ended there, and the page draws the show without it).
   */
  kind: 'caught' | 'uncaught' | 'warm-up';
  message: string;
  /** The error's stack and React's component stack, cut short. */
  stack: string | null;
  componentStack: string | null;
}

const cut = (text: string | null | undefined, max: number) =>
  typeof text === 'string' && text.length > 0 ? cutText(text, max) : null;

/** A report from what React gives an error handler, safe to send (plain strings, cut short). */
export function renderErrorReport(
  where: string,
  kind: RenderErrorReport['kind'],
  error: unknown,
  componentStack?: string,
): RenderErrorReport {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return {
    where: cutText(where, 40),
    kind,
    message: cutText(message, 500),
    stack: cut(error instanceof Error ? error.stack : null, 2000),
    componentStack: cut(componentStack, 2000),
  };
}

/** A report as the main process receives it (from a page: checked, never trusted), or null. */
export function parseRenderErrorReport(raw: unknown): RenderErrorReport | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? cutText(v, max) : null);
  const where = text(r['where'], 40);
  const message = text(r['message'], 500);
  if (
    where === null ||
    message === null ||
    (r['kind'] !== 'caught' && r['kind'] !== 'uncaught' && r['kind'] !== 'warm-up')
  )
    return null;
  return {
    where,
    kind: r['kind'],
    message,
    stack: text(r['stack'], 2000),
    componentStack: text(r['componentStack'], 2000),
  };
}
