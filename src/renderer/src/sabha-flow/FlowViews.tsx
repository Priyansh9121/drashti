import type { SabhaFlow, SabhaFlowStatus } from '../../../shared/sabha-flow';

/* Red: the views are not built yet. */

export type FlowView = 'list' | 'page';

export const flowViews = (_status: SabhaFlowStatus): FlowView[] => [];
export const statusWords = (_status: SabhaFlowStatus): string | null => null;

export function FlowStatusNotice(_props: { status: SabhaFlowStatus }) {
  return null;
}

export function FlowReadList(_props: { flow: SabhaFlow; now: number | null; onPick: (index: number) => void }) {
  return null;
}

export function FlowNowNext(_props: {
  flow: SabhaFlow;
  now: number | null;
  onBack: () => void;
  onNext: () => void;
}) {
  return null;
}
