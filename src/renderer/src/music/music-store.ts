import { create } from 'zustand';
import type { MusicResult, MusicView } from '../../../shared/music';
import { pushRemoval } from '../library/undo';
import { useNotice } from '../operator/actions';

/* Audio playlists in the operator window (Session 14): the library's lists, and which one the panel shows. */

export const useMusic = create<{ view: MusicView | null; shownId: string | null; adding: boolean }>(() => ({
  view: null,
  shownId: null,
  adding: false,
}));

let connected = false;

export function connectMusic(): void {
  if (connected) return;
  connected = true;
  window.drashti.music.onChanged((view) => {
    useMusic.setState({ view });
  });
  void window.drashti.music.view().then((view) => {
    useMusic.setState({ view });
  });
}

/** Run a change; what went wrong goes in the notice area. Returns the result. */
export async function musicAction(run: () => Promise<MusicResult>): Promise<MusicResult> {
  const result = await run();
  if (result.ok) useMusic.setState({ view: result.view, ...(result.id ? { shownId: result.id } : {}) });
  else useNotice.setState({ text: result.message });
  return result;
}

/** Delete an audio playlist (its trash button, after asking); Undo brings it back (Session 26a). */
export async function deleteMusic(id: string, name: string): Promise<void> {
  const result = await musicAction(() => window.drashti.music.remove(id));
  if (!result.ok) return;
  pushRemoval({
    text: `Deleted music “${name}”`,
    restore: async () => {
      await musicAction(() => window.drashti.music.restore(id));
    },
  });
}

/** Take a sound out of an audio playlist (the library keeps it); Undo puts it back at its place. */
export async function takeOutTrack(trackId: string, at: number, name: string, list: string): Promise<void> {
  const result = await musicAction(() => window.drashti.music.removeTrack(trackId));
  if (!result.ok) return;
  pushRemoval({
    text: `Removed “${name}” from “${list}”`,
    restore: async () => {
      await musicAction(() => window.drashti.music.restoreTrack(trackId, at));
    },
  });
}
