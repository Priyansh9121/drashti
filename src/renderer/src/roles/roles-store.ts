import { create } from 'zustand';
import type { RolesView } from '../../../shared/roles';
import { ROLES_OFF } from '../../../shared/roles';
import { useMode } from '../operator/mode-store';

/*
 * Roles in the operator window (Session 14, shared/roles.ts): whether they
 * are on, whether admin is unlocked (and until when), and the admin PIN
 * prompt. The bridge waits on the prompt before any admin request; a menu
 * item that needs admin asks for it through the main process.
 */

interface Asking {
  /** What it is for, in words ("back up the library"), or null for a button in the window. */
  what: string | null;
  /** Asked by a menu item through the main process: closing it tells the main process. */
  fromMain: boolean;
  resolve: (unlocked: boolean) => void;
  promise: Promise<boolean>;
}

export const useRoles = create<{ view: RolesView; asking: Asking | null; dialogOpen: boolean }>(() => ({
  view: ROLES_OFF,
  asking: null,
  dialogOpen: false,
}));

/** Ask for the admin PIN; true once admin is unlocked, false if the operator closed it. */
export function askAdminPin(what: string | null = null, fromMain = false): Promise<boolean> {
  const open = useRoles.getState().asking;
  if (open) return open.promise;
  let resolve: (unlocked: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  useRoles.setState({ asking: { what, fromMain, resolve, promise } });
  return promise;
}

/** The prompt is done: admin unlocked, or not. */
export function answerAdminPin(unlocked: boolean): void {
  const asking = useRoles.getState().asking;
  if (!asking) return;
  useRoles.setState({ asking: null });
  if (!unlocked && asking.fromMain) void window.drashti.roles.cancelAsk();
  asking.resolve(unlocked);
}

export function openRolesDialog(): void {
  useRoles.setState({ dialogOpen: true });
}

export function closeRolesDialog(): void {
  useRoles.setState({ dialogOpen: false });
}

let connected = false;

export function connectRoles(): void {
  if (connected) return;
  connected = true;
  window.drashti.roles.onChanged((view) => {
    useRoles.setState({ view });
  });
  window.drashti.roles.onAskAdmin((what) => {
    void askAdminPin(what, true);
  });
  window.drashti.roles.onOpen(openRolesDialog);
  // The bridge asks here before an admin request while admin is locked (never in Simple Mode,
  // which offers no admin request and refuses them all anyway).
  window.drashti.roles.setAdminAsker(() =>
    useMode.getState().mode === 'simple' ? Promise.resolve(false) : askAdminPin(),
  );
  void window.drashti.roles.view().then((view) => {
    useRoles.setState({ view });
  });
}
