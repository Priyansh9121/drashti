import type { PlaylistPlayOptions } from '../../../shared/playlist-playback';
import type { PlaylistResult } from '../../../shared/playlists';

export interface PlayOptionsPort {
  read(playlistId: string): Promise<PlaylistPlayOptions | null>;
  write(playlistId: string, options: PlaylistPlayOptions): Promise<PlaylistResult>;
}

/** Each tick changes its own option after the previous tick is committed, even when an import holds a write. */
export function playlistOptionChanges(port: PlayOptionsPort) {
  let queued = Promise.resolve();
  return (playlistId: string, option: 'shuffle' | 'repeatAll'): Promise<PlaylistResult> => {
    const result = queued.then(async () => {
      const options = await port.read(playlistId);
      if (!options)
        return { ok: false as const, message: 'That playlist is no longer there: open it again.' };
      return port.write(playlistId, { ...options, [option]: !options[option] });
    });
    // A failed request is said by its caller and does not hold the next tick forever.
    queued = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export const changePlaylistPlayOption = playlistOptionChanges({
  read: async (playlistId) => {
    const node = (await window.drashti.playlists.tree()).find((p) => p.id === playlistId);
    return node && !node.isFolder && !node.template
      ? {
          shuffle: node.playback?.shuffle ?? false,
          repeatAll: node.playback?.repeatAll ?? false,
          ...(node.playback?.crossfadeMs ? { crossfadeMs: node.playback.crossfadeMs } : {}),
        }
      : null;
  },
  write: (playlistId, options) => window.drashti.playlists.setPlayOptions(playlistId, options),
});
