import { create } from 'zustand';
import type { SabhaFlow, SabhaFlowSnapshot, SabhaFlowState } from '../../../shared/sabha-flow';
import { nextUpIndex, nowWithin } from '../../../shared/sabha-flow';
import { readPersisted, writePersisted } from '../ui/persist';

/*
 * Sabha flow in the operator window (alpha.23, QA23-FLOW-1 and QA23-FLOW-2): the current flow and Now, as the main
 * process says (read once, then told as they change: flow:changed), and the panel's own asks: Choose PDF… (Replace…),
 * Remove, and marking Now (a row's click, Back and Next). Main keeps the PDF, what was read from it and Now, across
 * restarts; nothing here reaches a screen.
 */

interface FlowStore {
  flow: SabhaFlow | null;
  /** Now: an index into the flow's items, or null (not started). */
  now: number | null;
  /** The first read has come. */
  loaded: boolean;
  /** Choose PDF… is open or reading. */
  choosing: boolean;
  /** Why the last ask did not go (a PDF refused, Now refused), until the next ask. */
  problem: string | null;
}

export const useFlow = create<FlowStore>(() => ({
  flow: null,
  now: null,
  loaded: false,
  choosing: false,
  problem: null,
}));

/** Now as the state says it, for this flow only (a state for another flow is not this one's). */
const nowOf = (flow: SabhaFlow | null, state: SabhaFlowState | null): number | null =>
  flow !== null && state !== null && state.flowId === flow.id ? nowWithin(flow, state.now) : null;

function apply({ flow, state }: SabhaFlowSnapshot): void {
  useFlow.setState({ flow, now: nowOf(flow, state), loaded: true });
}

/** Whether the panel is open (its heading is the toggle): remembered on this computer, folded to begin with. */
const OPEN_KEY = 'panel.sabha-flow.open';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

export const useFlowPanel = create<{ open: boolean }>(() => ({
  open: readPersisted(OPEN_KEY, false, isBoolean),
}));

export function setFlowPanelOpen(open: boolean): void {
  useFlowPanel.setState({ open });
  writePersisted(OPEN_KEY, open);
}

let connected = false;

/** Read the flow and Now once, and follow their changes (once per window). */
export function connectFlow(): void {
  if (connected) return;
  connected = true;
  // A change told before the first read is answered is newer than that answer.
  let told = false;
  window.drashti.flow.onChanged((snapshot) => {
    told = true;
    apply(snapshot);
  });
  void window.drashti.flow.get().then(
    (snapshot) => {
      if (!told) apply(snapshot);
    },
    () => {
      if (!told) useFlow.setState({ loaded: true });
    },
  );
}

/** Choose PDF… (and Replace…): Main's file dialog; the new flow starts with nothing Now. */
export async function chooseFlow(): Promise<void> {
  if (useFlow.getState().choosing) return;
  useFlow.setState({ choosing: true, problem: null });
  try {
    const result = await window.drashti.flow.choose();
    if (result === null) return;
    if (result.ok) useFlow.setState({ flow: result.flow, now: null, loaded: true });
    else useFlow.setState({ problem: result.message });
  } catch {
    useFlow.setState({ problem: 'Drashti couldn’t take that PDF. Try again, or choose another.' });
  } finally {
    useFlow.setState({ choosing: false });
  }
}

/** Remove: Drashti's copy goes (the operator's own PDF stays where it is). */
export async function removeFlow(): Promise<void> {
  useFlow.setState({ problem: null });
  try {
    await window.drashti.flow.remove();
  } catch {
    // Refused (Drashti stopped, say): the flow stays, and the panel says so (a22-review-flow S10).
    useFlow.setState({ problem: 'Drashti couldn’t remove the Sabha flow. Try again.' });
    return;
  }
  useFlow.setState({ flow: null, now: null });
}

/**
 * The Now last asked of Main and not answered yet (a22-review-flow M3): Back and Next step from it, so two quick presses
 * are two steps, never one from a Now Main has not said yet. `ask` counts the asks: only the latest one's answer is
 * shown (an answer a newer ask overtook says nothing; Main keeps the newest Now and says it).
 */
let asked: { flowId: string; now: number | null } | null = null;
let ask = 0;

/** Said when a mark could not reach Main at all (its ask failed on its way). */
export const NOW_NOT_MARKED = 'Drashti couldn’t mark Now in the Sabha flow. Try again.';

/** Where Back and Next step from: the Now last asked for this flow, while Main has not answered it; else Now. */
function stepFrom(flow: SabhaFlow, now: number | null): number | null {
  return asked !== null && asked.flowId === flow.id ? asked.now : now;
}

/**
 * Mark Now (null: not started). Refused for a flow replaced meanwhile: the panel then shows the new one. An ask that
 * fails on its way says so (NOW_NOT_MARKED), Now staying as Main has it.
 */
export async function setFlowNow(now: number | null): Promise<void> {
  const { flow } = useFlow.getState();
  if (flow === null) return;
  const mine = ++ask;
  asked = { flowId: flow.id, now };
  try {
    const result = await window.drashti.flow.setNow(flow.id, now);
    // A newer ask is on its way: its answer says where Now is.
    if (mine !== ask) return;
    if (!result.ok) {
      useFlow.setState({ problem: result.message });
      return;
    }
    const current = useFlow.getState().flow;
    useFlow.setState({ now: nowOf(current, result.state), problem: null });
  } catch {
    if (mine === ask) useFlow.setState({ problem: NOW_NOT_MARKED });
  } finally {
    if (mine === ask) asked = null;
  }
}

/** Next: Now moves to the item after it (the first item when nothing is Now yet); nothing after the last. */
export function flowNext(): void {
  const { flow, now } = useFlow.getState();
  if (flow === null) return;
  const next = nextUpIndex(flow, stepFrom(flow, now));
  if (next !== null) void setFlowNow(next);
}

/** Back: Now moves to the item before it; from the first item, back to not started; nothing before that. */
export function flowBack(): void {
  const { flow, now } = useFlow.getState();
  if (flow === null) return;
  const from = stepFrom(flow, now);
  if (from === null) return;
  void setFlowNow(from > 0 ? from - 1 : null);
}
