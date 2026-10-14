import { create } from 'zustand';
import type { SmartPlaylistView } from '../../../shared/playlists';

/*
 * Smart playlists (Session 26c): how following each one's folder goes, by
 * playlist, for the open playlist's header. The playlists and their items
 * come as any playlist's do (playlist-store.ts).
 */

export const useSmart = create<{ views: Record<string, SmartPlaylistView> }>(() => ({ views: {} }));

function set(views: SmartPlaylistView[]): void {
  useSmart.setState({ views: Object.fromEntries(views.map((v) => [v.playlistId, v])) });
}

let connected = false;

export function connectSmart(): void {
  if (connected) return;
  connected = true;
  window.drashti.playlists.onSmartChanged(set);
  void window.drashti.playlists.smartViews().then(set);
}
