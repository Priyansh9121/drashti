import type { IpcMainInvokeEvent } from 'electron';
import type { InvokeChannel, InvokeResult } from '../../shared/ipc';
import type { ModelPackStore } from './store';

/* Help › Caption and Translation Models…'s requests (alpha.22, cap-pack). Red: not built yet. */

export interface ModelPacksIpcDeps {
  handle: <C extends InvokeChannel>(
    channel: C,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => InvokeResult<C> | Promise<InvokeResult<C>>,
  ) => void;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  store: ModelPackStore;
  pick: (kind: 'folder' | 'zip') => Promise<string | null>;
}

export const NOT_THE_OPERATOR = 'Only the operator window can change the caption and translation models.';
export const NOTHING_CHOSEN = 'No pack was chosen.';

export function handleModelPacks(d: ModelPacksIpcDeps): void {
  void d;
}
