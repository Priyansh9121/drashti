import { create } from 'zustand';
import type { PresentationDoc, PresentationSummary } from '../../../shared/library';

interface LibraryView {
  presentations: PresentationSummary[];
  selectedId: string | null;
  doc: PresentationDoc | null;
}

export const useLibrary = create<LibraryView>(() => ({ presentations: [], selectedId: null, doc: null }));

export async function selectPresentation(id: string): Promise<void> {
  useLibrary.setState({ selectedId: id });
  const doc = await window.drashti.library.getPresentation(id);
  // Ignore a slow answer for a presentation that is no longer selected.
  if (useLibrary.getState().selectedId === id) useLibrary.setState({ doc });
}

export async function loadLibrary(): Promise<void> {
  const presentations = await window.drashti.library.listPresentations();
  useLibrary.setState({ presentations });
  const { selectedId } = useLibrary.getState();
  const first = presentations[0];
  if (!selectedId && first) await selectPresentation(first.id);
}
