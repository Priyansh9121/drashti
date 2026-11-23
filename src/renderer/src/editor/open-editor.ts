import { pushRemoval } from '../library/undo';
import { loadLibrary, selectPresentation, useLibrary } from '../library/library-store';
import { useNotice } from '../operator/actions';

/*
 * The slide editor from the operator window (Session 55, Part 17a): Edit slides opens its window on a presentation's
 * slides, at a slide (or brings it forward and tells it which); the show goes on here meanwhile. A save there comes
 * back here as one change for Undo, and the presentation shown here takes its new slides.
 */

/** Open the slide editor's window on a presentation, at a slide (or its first). */
export async function openSlideEditor(
  presentationId: string,
  _name: string,
  slideId: string | null = null,
): Promise<void> {
  const done = await window.drashti.slideEditor.open(presentationId, slideId);
  if (!done.ok) useNotice.setState({ text: done.message });
}

/** Slides saved in the editor's window: one change for Undo here, and the presentation shown takes them. */
export function connectSlideEditorSaves(): () => void {
  const offMade = connectMadeSlides();
  const offSaved = window.drashti.slideEditor.onSaved(({ presentationId, name, revisionId }) => {
    pushRemoval({
      text: `Edited the slides of “${name}”`,
      restore: async () => {
        await window.drashti.library.restoreRevision(revisionId);
        if (useLibrary.getState().selectedId === presentationId) await selectPresentation(presentationId);
      },
    });
    if (useLibrary.getState().selectedId === presentationId) void selectPresentation(presentationId);
  });
  return () => {
    offSaved();
    offMade();
  };
}

/**
 * A slide made in the editor's window from a PDF page (Make a slide…, alpha.21): one change for Undo here, which takes
 * its row out of the playlist and the presentation out of the library (Undo of that, Deleted…'s, is not offered: it was
 * never there before).
 */
function connectMadeSlides(): () => void {
  return window.drashti.slideEditor.onSlideMade(({ presentationId, name, itemId }) => {
    pushRemoval({
      text: `Made the slide “${name}”`,
      restore: async () => {
        if (itemId !== null) await window.drashti.playlists.removeItems([itemId]);
        await window.drashti.library.removePresentations([presentationId]);
        await loadLibrary();
      },
    });
    void loadLibrary();
  });
}
