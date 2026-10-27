import { create } from 'zustand';
import type { AccessView } from '../../../shared/access';

/*
 * Access by Gmail (Session 54), as a window shows it: the main process's view, kept up to date. The main process
 * decides everything; a window only shows the view and asks it to act.
 */

export const useAccess = create<{ view: AccessView | null }>(() => ({ view: null }));

let connected = false;

/** Follow the view from now on (once a page). */
export function connectAccess(): void {
  if (connected) return;
  connected = true;
  window.drashti.access.onChanged((view) => {
    useAccess.setState({ view });
  });
  void window.drashti.access.view().then((view) => {
    // A change heard meanwhile is newer.
    if (useAccess.getState().view === null) useAccess.setState({ view });
  });
}

/** Ask the main process to act; the view it answers is shown. */
export async function act(run: () => Promise<AccessView>): Promise<void> {
  try {
    useAccess.setState({ view: await run() });
  } catch {
    // Refused (Drashti stopped meanwhile): the view it sends says so.
  }
}
