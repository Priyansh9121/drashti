import { create } from 'zustand';
import type { SabhaFlow, SabhaFlowSnapshot } from '../../../../shared/sabha-flow';

/* Red: not built yet. */

export type FlowView = 'list' | 'page';

interface FlowPhone {
  snapshot: SabhaFlowSnapshot | null;
  problem: string | null;
  open: boolean;
  view: FlowView;
  page: number;
  zoom: number;
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
export const flowViews = (_flow: SabhaFlow | null): FlowView[] => [];
export const loadFlow = (): Promise<void> => Promise.resolve();
export const loadFlowPage = (_flowId: string, _page: number): Promise<void> => Promise.resolve();
export const openFlow = (): void => undefined;
export const closeFlow = (): void => undefined;
export const showFlowView = (_view: FlowView): void => undefined;
export const turnPage = (_by: number): void => undefined;
export const zoomBy = (_steps: number): void => undefined;
export const zoomFit = (): void => undefined;
export const startFlow = (): void => undefined;
