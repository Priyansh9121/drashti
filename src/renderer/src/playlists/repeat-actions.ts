import { repeatPresentationId } from '../../../shared/repeat';
import { dispatch } from '../operator/actions';

/*
 * Repeat Slides going round (Session 26d): its Start (on its row, its open
 * playlist, Simple Mode) and Stop (with Esc and LIVE's own). The engine does
 * the rest (shared/repeat.ts).
 */

/** Start a Repeat Slides playlist going round: from its first slide, or from an item's first. */
export async function startRepeat(playlistId: string, itemId: string | null = null): Promise<void> {
  let slideIndex = 0;
  if (itemId !== null) {
    const doc = await window.drashti.library.getPresentation(repeatPresentationId(playlistId));
    slideIndex = doc?.groups.find((g) => g.id === itemId)?.slides[0]?.index ?? 0;
  }
  await dispatch({ type: 'startRepeat', playlistId, slideIndex });
}

/** Stop it going round: its slide stays on the screens. */
export function stopRepeat(): Promise<void> {
  return dispatch({ type: 'stopRepeat' });
}
