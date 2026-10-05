import { create } from 'zustand';
import type { MusicResult, MusicView } from '../../../shared/music';
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
