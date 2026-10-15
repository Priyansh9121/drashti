import { create } from 'zustand';
import type { DropFolderView } from '../../../shared/drop-folder';

/*
 * The drop folder in the operator window (Session 28): the dialog, opened by File › Drop Folder… once admin
 * is unlocked. How it stands is asked for only then: every drop folder request is an admin's.
 */

export const useDrop = create<{ view: DropFolderView | null; open: boolean }>(() => ({
  view: null,
  open: false,
}));

let connected = false;

export function connectDrop(): void {
  if (connected) return;
  connected = true;
  window.drashti.drop.onChanged((view) => {
    if (useDrop.getState().open) useDrop.setState({ view });
  });
  window.drashti.drop.onOpen(openDrop);
}

export function openDrop(): void {
  void window.drashti.drop.view().then((view) => {
    useDrop.setState({ view, open: true });
  });
}

export function closeDrop(): void {
  useDrop.setState({ open: false, view: null });
}
