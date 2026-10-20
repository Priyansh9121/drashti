import { create } from 'zustand';
import { usePlaylists } from '../playlists/playlist-store';
import { clearFilters, useFilters } from './KirtanFilters';
import { useLibraryTab } from './library-store';

/*
 * View › Show Shastra, Templates and Kirtan Details (Session 26a): off to
 * begin with, an admin's to turn on, kept with the library's settings. While
 * off, the operator window has no Shastra tab, no Templates beside the
 * playlists and no kirtan filters; their data, the remote's library, and the
 * API that names a passage stay as they were. Search still finds
 * kirtans by their details.
 */

export const useExtras = create<{ on: boolean }>(() => ({ on: false }));

/** Hidden things the window was showing: it goes back to what stays. */
function hideWhatIsHidden(): void {
  if (useLibraryTab.getState().tab === 'shastra') useLibraryTab.setState({ tab: 'presentations' });
  const filters = useFilters.getState();
  if (filters.open || Object.values(filters.f).some((v) => v !== null)) {
    clearFilters();
    useFilters.setState({ open: false });
  }
  const playlists = usePlaylists.getState();
  if (playlists.view === 'templates' || playlists.templates.some((t) => t.id === playlists.openId))
    usePlaylists.setState({ view: 'playlists', openId: null, items: [], marked: [], anchorId: null });
}

function set(on: boolean): void {
  useExtras.setState({ on });
  if (!on) hideWhatIsHidden();
}

let connected = false;

export function connectExtras(): void {
  if (connected) return;
  connected = true;
  window.drashti.library.onExtrasChanged(set);
  void window.drashti.library.extras().then(set);
}
