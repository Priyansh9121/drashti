import { create } from 'zustand';
import type { PendingScreens } from '../../../shared/keep-screens';

/*
 * Keep these screens? in the operator window (Session 50): the change waiting for Keep or Go back, as the main
 * process says. The main process keeps the countdown and goes back by itself when nothing is pressed in time;
 * it also tells the operator how it ended (a notice), so an answer that came too late, the question already
 * gone, says nothing here.
 */

interface KeepView {
  pending: PendingScreens | null;
  /** An answer is on its way to the main process. */
  answering: boolean;
}

export const useKeepScreens = create<KeepView>(() => ({ pending: null, answering: false }));

let started = false;

/** Follow the question from the main process (once per page). */
export function connectKeepScreens(): void {
  if (started) return;
  started = true;
  let heard = false;
  window.drashti.screens.onPending((pending) => {
    heard = true;
    useKeepScreens.setState({ pending });
  });
  // One already waiting as the window opens (its page loaded again): unless the main process spoke since.
  void window.drashti.screens.pending().then((pending) => {
    if (!heard) useKeepScreens.setState({ pending });
  });
}

/** Keep (true) or Go back (false): one answer at a time. */
export async function answerKeepScreens(keep: boolean): Promise<void> {
  if (useKeepScreens.getState().answering) return;
  useKeepScreens.setState({ answering: true });
  try {
    await (keep ? window.drashti.screens.keep() : window.drashti.screens.goBack());
  } finally {
    useKeepScreens.setState({ answering: false });
  }
}

/** Whole seconds left until `deadline` (ms since the epoch), never below none. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
