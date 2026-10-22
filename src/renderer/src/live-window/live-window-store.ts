import { create } from 'zustand';
import { type LiveWindowStatus, type WindowList, WINDOWS_FAILED } from '../../../shared/live-window';

/*
 * Show a Window… (Session 48) in the operator window: the picker (open from the library's Media tab, Pro
 * Mode), its list of other apps' windows, and how the window on the screens stands (the notice in the
 * window's flow, in either mode, when it was closed or hidden).
 */

interface LiveWindowUi {
  picking: boolean;
  /** The picker's list as last read, or null while the first is read. */
  list: WindowList | null;
  status: LiveWindowStatus;
}

export const useLiveWindowUi = create<LiveWindowUi>(() => ({
  picking: false,
  list: null,
  status: { state: 'off', name: null },
}));

let connected = false;

/** Follow how the window on the screens stands (once, as the operator window opens). */
export function connectLiveWindow(): void {
  if (connected) return;
  connected = true;
  window.drashti.liveWindow.onChanged((status) => {
    useLiveWindowUi.setState({ status });
  });
  void window.drashti.liveWindow.status().then((status) => {
    useLiveWindowUi.setState({ status });
  });
}

export function openWindowPicker(): void {
  useLiveWindowUi.setState({ picking: true, list: null });
  void refreshWindows();
}

export function closeWindowPicker(): void {
  useLiveWindowUi.setState({ picking: false, list: null });
}

/** Read the windows again (their small pictures stay live while the picker is open). */
export async function refreshWindows(): Promise<void> {
  let list: WindowList;
  try {
    list = await window.drashti.liveWindow.list();
  } catch {
    list = { ok: false, reason: 'unlisted', message: WINDOWS_FAILED };
  }
  if (useLiveWindowUi.getState().picking) useLiveWindowUi.setState({ list });
}
