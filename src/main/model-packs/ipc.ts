import type { IpcMainInvokeEvent } from 'electron';
import { IPC, type InvokeChannel, type InvokeResult } from '../../shared/ipc';
import type { ModelPackStore } from './store';

/*
 * Help › Caption and Translation Models… (alpha.22, cap-pack): the operator window's requests, Pro Mode's (Simple
 * Mode's lock refuses them all before they get here: main/simple-mode.ts). Only the operator window may ask. The
 * pack's folder or zip is chosen in main's own dialog (`pick`): a page never gives a path.
 */

export interface ModelPacksIpcDeps {
  handle: <C extends InvokeChannel>(
    channel: C,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => InvokeResult<C> | Promise<InvokeResult<C>>,
  ) => void;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  store: ModelPackStore;
  /** The admin's choice of a pack's folder or zip, or null when none was chosen. */
  pick: (kind: 'folder' | 'zip') => Promise<string | null>;
}

export const NOT_THE_OPERATOR = 'Only the operator window can change the caption and translation models.';
export const NOTHING_CHOSEN = 'No pack was chosen.';

export function handleModelPacks(d: ModelPacksIpcDeps): void {
  const refused = { ok: false as const, message: NOT_THE_OPERATOR };
  d.handle(IPC.modelPacks.view, () => d.store.status());
  d.handle(IPC.modelPacks.import, async (e, kind) => {
    if (!d.fromOperator(e) || (kind !== 'folder' && kind !== 'zip'))
      return { ...refused, status: d.store.status() };
    const chosen = await d.pick(kind);
    if (chosen === null)
      return { ok: false, message: NOTHING_CHOSEN, cancelled: true, status: d.store.status() };
    return d.store.importPack(chosen, kind);
  });
  d.handle(IPC.modelPacks.cancel, (e) => {
    if (!d.fromOperator(e)) return false;
    d.store.cancelImport();
    return true;
  });
  d.handle(IPC.modelPacks.remove, (e, packId) =>
    d.fromOperator(e) && typeof packId === 'string' && packId.length <= 64 ? d.store.remove(packId) : refused,
  );
  d.handle(IPC.modelPacks.licence, (e, packId, file) =>
    d.fromOperator(e) && typeof packId === 'string' && typeof file === 'string' && file.length <= 240
      ? d.store.licenceText(packId, file)
      : refused,
  );
}
