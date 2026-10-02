import { create } from 'zustand';
import type { KirtanDetails } from '../../../shared/kirtans';
import { NO_DETAILS } from '../../../shared/kirtans';
import { selectPresentation, useLibrary } from '../library/library-store';
import { pushRemoval } from '../library/undo';

/*
 * The Kirtan dialog: whether a presentation is a kirtan, and its details.
 * Making it a kirtan, or not one, never moves its words: they stay on its
 * slides (src/shared/tracks.ts). Each change is one step for Undo.
 */

interface KirtanView {
  open: { presentationId: string; name: string } | null;
  saving: boolean;
  problem: string | null;
}

export const useKirtan = create<KirtanView>(() => ({ open: null, saving: false, problem: null }));

export function openKirtan(presentationId: string, name: string): void {
  useKirtan.setState({ open: { presentationId, name }, saving: false, problem: null });
}

export function closeKirtan(): void {
  useKirtan.setState({ open: null, saving: false, problem: null });
}

/** Save its details (null: it is not a kirtan any more). Returns whether it saved. */
export async function saveKirtan(details: KirtanDetails | null, what: string): Promise<boolean> {
  const open = useKirtan.getState().open;
  if (!open) return false;
  useKirtan.setState({ saving: true, problem: null });
  const result = await window.drashti.kirtans.setDetails(open.presentationId, details);
  if (!result.ok) {
    useKirtan.setState({ saving: false, problem: result.message });
    return false;
  }
  const { revisionId } = result;
  const id = open.presentationId;
  if (revisionId)
    pushRemoval({
      text: `${what}: “${open.name}”`,
      restore: async () => {
        await window.drashti.library.restoreRevision(revisionId);
        if (useLibrary.getState().selectedId === id) await selectPresentation(id);
      },
    });
  useKirtan.setState({ saving: false });
  if (useLibrary.getState().selectedId === id) await selectPresentation(id);
  return true;
}

export const makeKirtan = () => saveKirtan({ ...NO_DETAILS, category: 'Kirtan' }, 'Made a kirtan');
export const notKirtan = () => saveKirtan(null, 'No longer a kirtan');
