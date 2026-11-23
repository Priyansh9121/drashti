import { create } from 'zustand';
import type { ModelPacksStatus } from '../../../shared/model-packs';

/*
 * Help › Caption and Translation Models… in the operator window (alpha.22, cap-pack; Pro Mode): the dialog, how the
 * packs stand (asked only while it is open), and what the last import or removal said.
 */

export interface PacksNotice {
  tone: 'success' | 'danger';
  text: string;
}

export const useModelPacks = create<{
  status: ModelPacksStatus | null;
  open: boolean;
  notice: PacksNotice | null;
  /** The licence text shown, by pack and file. */
  licence: { packId: string; file: string; text: string } | null;
}>(() => ({ status: null, open: false, notice: null, licence: null }));

/** A reply that is how the packs stand (a refusal, in Simple Mode, is not). */
export const isPacksStatus = (v: unknown): v is ModelPacksStatus =>
  typeof v === 'object' && v !== null && 'packs' in v && 'importing' in v;

export function takeStatus(status: unknown): void {
  if (isPacksStatus(status) && useModelPacks.getState().open) useModelPacks.setState({ status });
}

let connected = false;

export function connectModelPacks(): void {
  if (connected) return;
  connected = true;
  window.drashti.modelPacks.onChanged(takeStatus);
  window.drashti.modelPacks.onOpen(openModelPacks);
}

export function openModelPacks(): void {
  void window.drashti.modelPacks.view().then((status) => {
    if (isPacksStatus(status)) useModelPacks.setState({ status, open: true, notice: null, licence: null });
  });
}

export function closeModelPacks(): void {
  useModelPacks.setState({ open: false, status: null, notice: null, licence: null });
}
