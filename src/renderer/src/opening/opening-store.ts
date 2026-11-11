import { create } from 'zustand';
import type { OpeningResult, OpeningView } from '../../../shared/opening';
import { makeOpeningCopies } from './copies';

/*
 * File › Opening… in the operator window (Session 55, Pro Mode; alpha.16: one photo and the pack's sound): its view,
 * asked for as it opens, and the photo's copy for the opening made here as a photo is chosen or the opening pack is
 * loaded (copies.ts).
 */

export const useOpening = create<{
  open: boolean;
  view: OpeningView | null;
  problem: string | null;
  /** Load the opening pack… is under way. */
  loading: boolean;
}>(() => ({ open: false, view: null, problem: null, loading: false }));

let connected = false;

export function connectOpening(): void {
  if (connected) return;
  connected = true;
  window.drashti.opening.onOpen(openOpening);
}

/** Ask again how it stands (after a copy is made, say). */
async function refresh(): Promise<void> {
  const view = await window.drashti.opening.view();
  if (useOpening.getState().open) useOpening.setState({ view });
}

/** Make the copy the view's photo is waiting for. */
function makeCopies(view: OpeningView): void {
  const { photo } = view;
  if (photo && !photo.ready && !photo.gone)
    void makeOpeningCopies([photo.mediaId], () => {
      void refresh();
    });
}

export function openOpening(): void {
  void window.drashti.opening.view().then((view) => {
    useOpening.setState({ open: true, view, problem: null });
    // A copy not made yet (the window closed while it was being made, say) is made now.
    makeCopies(view);
  });
}

export function closeOpening(): void {
  useOpening.setState({ open: false, view: null, problem: null, loading: false });
}

/** Take what a change answered: its view (and the copy it now waits for), or why not. */
export function take(result: OpeningResult | null): void {
  if (result === null) return;
  if (!result.ok) {
    useOpening.setState({ problem: result.message });
    return;
  }
  useOpening.setState({ view: result.view, problem: null });
  makeCopies(result.view);
}

export async function loadPack(): Promise<void> {
  useOpening.setState({ loading: true, problem: null });
  try {
    take(await window.drashti.opening.loadPack());
  } finally {
    useOpening.setState({ loading: false });
  }
}
