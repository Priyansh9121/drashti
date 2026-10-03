import { create } from 'zustand';
import type { LookResult, LooksView } from '../../../shared/looks';

/*
 * The Looks, as the operator window keeps them: the list (Screens changes
 * them), kept current from the main process. Which one is live comes with
 * the engine state (state.look.id), and switching it is the engine's
 * setLook command.
 */

interface LooksStore {
  view: LooksView | null;
  error: string | null;
}

export const useLooks = create<LooksStore>(() => ({ view: null, error: null }));

let started = false;

export function connectLooks(): void {
  if (started) return;
  started = true;
  window.drashti.looks.onChanged((view) => {
    useLooks.setState({ view });
  });
  void window.drashti.looks.list().then((view) => {
    useLooks.setState({ view });
  });
}

/** Run a change to the Looks and keep what it answers (or say why not). */
export async function lookAction(run: () => Promise<LookResult>): Promise<boolean> {
  const result = await run();
  if (result.ok) useLooks.setState({ view: result.view, error: null });
  else useLooks.setState({ error: result.message });
  return result.ok;
}
