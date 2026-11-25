import { create } from 'zustand';
import type { SabhaFlow, SabhaFlowSnapshot } from '../../../../shared/sabha-flow';
import { api, current } from '../device';
import { onListsChanged, onOnline } from '../feed';
import { oneAtATime } from '../one-at-a-time';

/*
 * Sabha flow on a phone (alpha.23, QA23-FLOW-1 and QA23-FLOW-2): the running order the operator chose on the computer,
 * read from its PDF, and where the sabha is (Now), read over the network (GET /api/v1/flow) when the phone comes online
 * and again each time Drashti says the flow changed (another PDF chosen, it removed, Now marked) or the mode did.
 * Read only: the phone shows it and marks nothing. Its sheet shows the read list or the PDF page; another PDF chosen on
 * the computer starts the sheet again (its first page, the read list when it could be read), and the old pages' pictures
 * are let go. A page is fetched as a picture with this phone's token, for the flow it is of; one that comes after its
 * flow was replaced is let go, and one Drashti says is of an old flow (409) reads the flow again.
 */

export type FlowView = 'list' | 'page';

/** A page that could not be had: said so in the view, and not asked for again until the flow changes. */
export const FAILED = 'failed';

/** How far a page zooms: 1 is the screen's width; each step half as much again, up to four times. */
export const ZOOM_MAX = 4;
const ZOOM_STEP = 1.5;

interface FlowPhone {
  /** The operator's current flow and its Now, as last read (null: not read yet, or it could not be). */
  snapshot: SabhaFlowSnapshot | null;
  /** Why the flow could not be read, in Drashti's words (Simple Mode's, say), or null. */
  problem: string | null;
  /** The sheet over the remote. */
  open: boolean;
  view: FlowView;
  /** The page shown (from 0). */
  page: number;
  zoom: number;
  /** Each page's picture by pictureKey: a blob URL, or FAILED. */
  pictures: Record<string, string>;
}

export const useFlow = create<FlowPhone>(() => ({
  snapshot: null,
  problem: null,
  open: false,
  view: 'list',
  page: 0,
  zoom: 1,
  pictures: {},
}));

export const pictureKey = (flowId: string, page: number): string => `${flowId}:${String(page)}`;

/** The views a flow has: the read list and the page when it was read, else the page alone (none without a flow). */
export function flowViews(flow: SabhaFlow | null): FlowView[] {
  if (!flow) return [];
  return flow.status === 'read' ? ['list', 'page'] : ['page'];
}

const firstView = (flow: SabhaFlow | null): FlowView => flowViews(flow)[0] ?? 'list';

function letGo(pictures: Record<string, string>): void {
  for (const url of Object.values(pictures)) if (url !== FAILED) URL.revokeObjectURL(url);
}

/** The flow as Drashti says it is now: another flow (or none) starts the view again and lets the old pages go. */
function took(snapshot: SabhaFlowSnapshot | null, problem: string | null): void {
  const before = useFlow.getState();
  const was = before.snapshot?.flow?.id ?? null;
  const flow = snapshot?.flow ?? null;
  if ((flow?.id ?? null) === was) {
    useFlow.setState({ snapshot, problem });
    return;
  }
  letGo(before.pictures);
  useFlow.setState({ snapshot, problem, view: firstView(flow), page: 0, zoom: 1, pictures: {} });
}

async function readFlow(): Promise<void> {
  const r = await api<SabhaFlowSnapshot>('/api/v1/flow');
  if (r.ok) took({ flow: r.flow, state: r.state }, null);
  // Not reached (status 0): the flow last read stays, as the remote's other lists do while it reconnects.
  else if (r.status !== 0) took(null, r.message);
}

/** The flow and its Now, read again; one read at a time (one-at-a-time.ts). */
export const loadFlow = oneAtATime(readFlow);

/** A page's picture (from 0) of the flow with this id: fetched once, kept while that flow is the current one. */
export async function loadFlowPage(flowId: string, page: number): Promise<void> {
  const key = pictureKey(flowId, page);
  if (useFlow.getState().pictures[key] !== undefined || asking.has(key)) return;
  asking.add(key);
  try {
    const token = current()?.token;
    let response: Response | null = null;
    try {
      response = await fetch(`/api/v1/flow/pages/${String(page)}?flow=${encodeURIComponent(flowId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
    } catch {
      // Not reached: asked again when the view next needs it.
      return;
    }
    if (response.status === 409) {
      await loadFlow();
      return;
    }
    const picture = response.ok ? URL.createObjectURL(await response.blob()) : FAILED;
    // Replaced or removed meanwhile: not this flow's to keep.
    if (useFlow.getState().snapshot?.flow?.id !== flowId) {
      if (picture !== FAILED) URL.revokeObjectURL(picture);
      return;
    }
    useFlow.setState((s) => ({ pictures: { ...s.pictures, [key]: picture } }));
  } finally {
    asking.delete(key);
  }
}

const asking = new Set<string>();

export function openFlow(): void {
  const { view, snapshot } = useFlow.getState();
  const views = flowViews(snapshot?.flow ?? null);
  useFlow.setState({ open: true, view: views.includes(view) ? view : firstView(snapshot?.flow ?? null) });
}

export function closeFlow(): void {
  useFlow.setState({ open: false });
}

/** The read list or the page, when the flow has it. */
export function showFlowView(view: FlowView): void {
  if (flowViews(useFlow.getState().snapshot?.flow ?? null).includes(view)) useFlow.setState({ view });
}

/** The page before or after, within the flow's pages. */
export function turnPage(by: number): void {
  const { page, snapshot } = useFlow.getState();
  const last = Math.max(0, (snapshot?.flow?.pageCount ?? 1) - 1);
  useFlow.setState({ page: Math.min(last, Math.max(0, page + by)) });
}

/** Zoomed in (a positive step) or out, between the screen's width and four times it. */
export function zoomBy(steps: number): void {
  const { zoom } = useFlow.getState();
  const next = zoom * ZOOM_STEP ** steps;
  useFlow.setState({ zoom: Math.min(ZOOM_MAX, Math.max(1, Math.round(next * 100) / 100)) });
}

/** The page at the screen's width again. */
export function zoomFit(): void {
  useFlow.setState({ zoom: 1 });
}

let started = false;

/** Follows the flow from now on. Once per page. */
export function startFlow(): void {
  if (started) return;
  started = true;
  onOnline(() => void loadFlow());
  onListsChanged((what) => {
    if (what === 'flow' || what === 'mode') void loadFlow();
  });
}
