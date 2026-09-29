import { create } from 'zustand';
import { clickPresentation, loadLibrary, selectPresentation, useLibrary } from './library-store';
import { pushRemoval } from './undo';

/*
 * The words editor: a presentation's words as plain text (the lyrics format),
 * or pasted words for a new presentation.
 */

interface WordsView {
  /** What the editor is open for, if it is open. */
  open: { mode: 'edit'; presentationId: string; name: string } | { mode: 'new' } | null;
  name: string;
  text: string;
  /** Fonts of legacy-font text: the words are shown but cannot be saved. */
  legacyFonts: string[];
  loading: boolean;
  saving: boolean;
  problem: string | null;
}

const closed: WordsView = {
  open: null,
  name: '',
  text: '',
  legacyFonts: [],
  loading: false,
  saving: false,
  problem: null,
};

export const useWords = create<WordsView>(() => closed);

export async function editWords(presentationId: string, name: string): Promise<void> {
  useWords.setState({ ...closed, open: { mode: 'edit', presentationId, name }, name, loading: true });
  const result = await window.drashti.library.words(presentationId);
  const now = useWords.getState().open;
  if (now?.mode !== 'edit' || now.presentationId !== presentationId) return;
  useWords.setState(
    result.ok
      ? { text: result.text, legacyFonts: result.legacyFonts, loading: false }
      : { problem: result.message, loading: false },
  );
}

export function newFromWords(): void {
  useWords.setState({ ...closed, open: { mode: 'new' } });
}

export function closeWords(): void {
  useWords.setState(closed);
}

export async function saveWords(): Promise<void> {
  const { open, text, name, saving, legacyFonts } = useWords.getState();
  if (!open || saving || legacyFonts.length > 0) return;
  useWords.setState({ saving: true, problem: null });
  if (open.mode === 'new') {
    const result = await window.drashti.library.newFromWords(name, text);
    if (!result.ok) {
      useWords.setState({ saving: false, problem: result.message });
      return;
    }
    closeWords();
    await loadLibrary();
    clickPresentation(result.id, { toggle: false, range: false });
    return;
  }
  const result = await window.drashti.library.saveWords(open.presentationId, text);
  if (!result.ok) {
    useWords.setState({ saving: false, problem: result.message });
    return;
  }
  const { revisionId } = result;
  const presentationId = open.presentationId;
  pushRemoval({
    text: `Edited the words of “${open.name}”`,
    restore: async () => {
      await window.drashti.library.restoreRevision(revisionId);
      if (useLibrary.getState().selectedId === presentationId) await selectPresentation(presentationId);
    },
  });
  closeWords();
  if (useLibrary.getState().selectedId === presentationId) await selectPresentation(presentationId);
}
