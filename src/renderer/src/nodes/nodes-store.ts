import { create } from 'zustand';
import type { NodesResult, NodesStatus, ScreenThumb } from '../../../shared/nodes';

/*
 * Output nodes, as the operator window sees them (Session 13): their state
 * for Screens, the screens dashboard and the status bar's warnings, and the
 * dashboard's thumbnails while it is open.
 */

interface NodesView {
  status: NodesStatus | null;
  /** The latest picture of each screen, by screen id (while the dashboard is open). */
  thumbs: Record<string, ScreenThumb>;
  error: string | null;
}

export const useNodes = create<NodesView>(() => ({ status: null, thumbs: {}, error: null }));

let started = false;

export function connectNodes(): void {
  if (started) return;
  started = true;
  window.drashti.nodes.onChanged((status) => {
    useNodes.setState({ status });
  });
  window.drashti.nodes.onThumbs((list) => {
    const thumbs = { ...useNodes.getState().thumbs };
    for (const t of list) thumbs[t.screenId] = t;
    useNodes.setState({ thumbs });
  });
  void window.drashti.nodes.status().then((status) => {
    useNodes.setState({ status });
  });
}

/** Run a change; its answer becomes the status, or its refusal the error shown. */
export async function nodesAction(run: () => Promise<NodesResult>): Promise<boolean> {
  const r = await run();
  if (r.ok) useNodes.setState({ status: r.status, error: null });
  else useNodes.setState({ error: r.message });
  return r.ok;
}
