import type { TimerCue } from '../../shared/playlists';
/*
 * Playlists as the show engine plays them: each item is a presentation (in
 * its order), a picture, video or sound, or something to step over.
 */

export type PlayItem =
  | {
      id: string;
      kind: 'presentation';
      presentationId: string;
      /** The order: an arrangement, null for every slide, undefined for the presentation's own choice. */
      arrangementId: string | null | undefined;
      /** Its name in the playlist (for a stage screen's "coming up"). */
      label?: string;
      /** What it does to timers when it goes up. */
      timers?: readonly TimerCue[];
    }
  | {
      id: string;
      kind: 'media';
      mediaId: string;
      media: 'image' | 'video' | 'audio';
      label: string;
      timers?: readonly TimerCue[];
    }
  /** Nothing to play: a header, a placeholder, or something no longer there; `why` says which. */
  | { id: string; kind: 'skip'; why: string; label?: string; header?: boolean };

export interface PlaylistSource {
  /** A playlist's items in order, or null if it does not exist. */
  items(playlistId: string): readonly PlayItem[] | null;
}

/** A PlaylistSource over an in-memory map, for tests. */
export class MemoryPlaylistSource implements PlaylistSource {
  private readonly lists = new Map<string, PlayItem[]>();

  set(playlistId: string, items: PlayItem[]): void {
    this.lists.set(playlistId, items);
  }

  items(playlistId: string): readonly PlayItem[] | null {
    return this.lists.get(playlistId) ?? null;
  }
}

export const NO_PLAYLISTS: PlaylistSource = { items: () => null };
