import { create } from 'zustand';
import type { ArtiAnswer, ArtiScheduleInfo, ArtiView } from '../../../shared/arti';
import { useNotice } from '../operator/actions';

/*
 * The arti at its time, in the operator window: the schedules and the
 * prompt (kept current from the main process), answering the prompt, and
 * the schedule being edited.
 */

interface ArtiStore {
  view: ArtiView | null;
  /** The schedule in the dialog: 'new' for one not saved yet; null when the dialog is closed. */
  editing: ArtiScheduleInfo | 'new' | null;
}

export const useArti = create<ArtiStore>(() => ({ view: null, editing: null }));

let started = false;

export function connectArti(): void {
  if (started) return;
  started = true;
  window.drashti.arti.onChanged((view) => {
    useArti.setState({ view });
  });
  void window.drashti.arti.view().then((view) => {
    useArti.setState({ view });
  });
}

export function editArti(editing: ArtiScheduleInfo | 'new' | null): void {
  useArti.setState({ editing });
}

/** What went wrong goes in the notice area. */
function answered(result: ArtiAnswer): void {
  if (!result.ok) useNotice.setState({ text: result.message });
}

export async function putUpArti(key: string): Promise<void> {
  answered(await window.drashti.arti.putUp(key));
}

export async function notNowArti(key: string): Promise<void> {
  answered(await window.drashti.arti.notNow(key));
}

export async function cancelArtiCountdown(key: string): Promise<void> {
  answered(await window.drashti.arti.cancel(key));
}
