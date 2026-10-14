import { create } from 'zustand';
import type { SaveJob } from '../../../shared/trim';

/*
 * Save as MP4… (Session 26e): the saves going and ended, for the status bar
 * and the timeline dialog.
 */

export const useSaves = create<{ jobs: SaveJob[] }>(() => ({ jobs: [] }));

let connected = false;

export function connectSaves(): void {
  if (connected) return;
  connected = true;
  window.drashti.media.onSaves((jobs) => {
    useSaves.setState({ jobs });
  });
  void window.drashti.media.saves().then((jobs) => {
    useSaves.setState({ jobs });
  });
}

export const stopSave = (jobId: string) => window.drashti.media.stopSave(jobId);
export const showSave = (jobId: string) => window.drashti.media.showSave(jobId);
