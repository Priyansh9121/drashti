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
  /** The details as being edited (null until the kirtan's are known). */
  draft: KirtanDetails | null;
  /** The details as stored, to tell whether the draft changed. */
  saved: KirtanDetails | null;
  /** Every category a kirtan can have. */
  categories: string[];
  saving: boolean;
  problem: string | null;
}

export const useKirtan = create<KirtanView>(() => ({
  open: null,
  draft: null,
  saved: null,
  categories: [],
  saving: false,
  problem: null,
}));

export function openKirtan(presentationId: string, name: string): void {
  useKirtan.setState({
    open: { presentationId, name },
    draft: null,
    saved: null,
    saving: false,
    problem: null,
  });
  void window.drashti.kirtans.categories().then((categories) => {
    useKirtan.setState({ categories });
  });
}

export function closeKirtan(): void {
  useKirtan.setState({ open: null, draft: null, saved: null, saving: false, problem: null });
}

/** Start editing these details (the kirtan's as stored). */
export function loadDraft(details: KirtanDetails | null): void {
  useKirtan.setState({ draft: details, saved: details });
}

export function editDraft(patch: Partial<KirtanDetails>): void {
  useKirtan.setState((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {}));
}

/** Whether the details being edited differ from those stored. */
export const draftChanged = (s: KirtanView): boolean =>
  s.draft !== null && JSON.stringify(s.draft) !== JSON.stringify(s.saved);

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
  useKirtan.setState({ saving: false, draft: null, saved: null });
  if (useLibrary.getState().selectedId === id) await selectPresentation(id);
  return true;
}

export const makeKirtan = () => saveKirtan({ ...NO_DETAILS, category: 'Kirtan' }, 'Made a kirtan');
export const notKirtan = () => saveKirtan(null, 'No longer a kirtan');

/** Save the details being edited, if they changed. Returns whether all is saved. */
export async function saveDraft(): Promise<boolean> {
  const s = useKirtan.getState();
  if (!s.draft || !draftChanged(s)) return true;
  return saveKirtan(s.draft, 'Changed the kirtan’s details');
}

/** A new category for every kirtan to use. */
export async function addCategory(name: string): Promise<boolean> {
  const result = await window.drashti.kirtans.addCategory(name);
  if (!result.ok) {
    useKirtan.setState({ problem: result.message });
    return false;
  }
  useKirtan.setState({ categories: result.categories, problem: null });
  editDraft({ category: name.trim() });
  return true;
}
