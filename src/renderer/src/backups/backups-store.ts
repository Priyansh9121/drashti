import { create } from 'zustand';
import type { ScheduledBackupsView } from '../../../shared/backups';

/* Scheduled backups in the operator window (Session 14): how they stand, and the dialog. */

export const useBackups = create<{ view: ScheduledBackupsView | null; open: boolean }>(() => ({
  view: null,
  open: false,
}));

let connected = false;

export function connectBackups(): void {
  if (connected) return;
  connected = true;
  window.drashti.backups.onChanged((view) => {
    useBackups.setState({ view });
  });
  window.drashti.backups.onOpen(openBackups);
  void window.drashti.backups.view().then((view) => {
    useBackups.setState({ view });
  });
}

export function openBackups(): void {
  useBackups.setState({ open: true });
}

export function closeBackups(): void {
  useBackups.setState({ open: false });
}
