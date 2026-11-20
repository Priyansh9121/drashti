import type { PlaylistPlayOptions } from '../../../shared/playlist-playback';
import type { PlaylistResult } from '../../../shared/playlists';

export interface PlayOptionsPort {
  read(playlistId: string): Promise<PlaylistPlayOptions | null>;
  write(playlistId: string, options: PlaylistPlayOptions): Promise<PlaylistResult>;
}

/** Each tick changes its own option, keeping the other option’s latest committed value. */
export function playlistOptionChanges(port: PlayOptionsPort) {
  return async (playlistId: string, option: keyof PlaylistPlayOptions): Promise<PlaylistResult> => {
    const options = await port.read(playlistId);
    if (!options) return { ok: false, message: 'That playlist is no longer there: open it again.' };
    return port.write(playlistId, { ...options, [option]: !options[option] });
  };
}
