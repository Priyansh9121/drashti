import { create } from 'zustand';
import type { IdleView } from '../../../shared/idle';

/*
 * The idle rotation's settings and quotes in the operator window (kept
 * current from the main process), and whether its dialog is open. Starting
 * and stopping it are engine commands; the screens read it from the
 * engine's state.
 */

interface IdleStore {
  view: IdleView | null;
  open: boolean;
}

export const useIdle = create<IdleStore>(() => ({ view: null, open: false }));

let started = false;

export function connectIdle(): void {
  if (started) return;
  started = true;
  window.drashti.idle.onChanged((view) => {
    useIdle.setState({ view });
  });
  void window.drashti.idle.view().then((view) => {
    useIdle.setState({ view });
  });
}

export function openIdle(open = true): void {
  connectIdle();
  useIdle.setState({ open });
}
