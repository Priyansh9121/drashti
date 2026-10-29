import type { MediaSummary } from './playlists';

/*
 * What a Remote reads to mirror the operator window (Session 54, D5): the library's pictures, videos and sounds,
 * the lower thirds and the audio playlists, each by name, to put up and take off as the window does, never to
 * change; and the keys the window answers now, so the phone's clears name them as the desktop's buttons do. A lower
 * third or a media item is put up by its id: the main process reads it from the library, so a phone never sends one
 * whole (as with messages, Session 10). Session 55 (Part 12): the props and the masks went.
 */

/** A picture, video or sound as a Remote lists it (the library's Media): never its file or where it is. */
export type RemoteMedia = Pick<MediaSummary, 'id' | 'name' | 'kind' | 'missing' | 'unplayable'>;

/** One page of the library's media for a Remote, by name: from `offset`, how many match, and what was asked. */
export interface RemoteMediaPage {
  media: RemoteMedia[];
  offset: number;
  total: number;
  /** The words its names were matched with ('' for every one). */
  query: string;
}

/** How many media items a Remote gets at once, unless it asks for fewer (and the most it may). */
export const REMOTE_MEDIA_PAGE = 100;
export const REMOTE_MEDIA_MAX = 200;

/** A lower third as a Remote lists it: its lines, as the window's row shows them. */
export interface RemoteLowerThird {
  id: string;
  lines: string[];
}

/** An audio playlist as a Remote lists it. */
export interface RemoteMusic {
  id: string;
  name: string;
  trackCount: number;
}

/** The keys the operator window answers now: its system (how a key is written) and the single-letter keys. */
export interface RemoteKeys {
  platform: string;
  /** B, . and ? act (Session 37); off, Black-out has no key (the Wallpaper keeps F12, Session 55). */
  singleKeys: boolean;
}

/**
 * Media whose names hold every word of `query`, in any letter case and any Unicode form: on a phone, scrolling
 * hundreds of names is slow, so a few letters of one find it.
 */
export function mediaMatching<T extends { name: string }>(media: readonly T[], query: string): T[] {
  const words = query.normalize('NFC').toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [...media];
  return media.filter((m) => {
    const name = m.name.normalize('NFC').toLocaleLowerCase();
    return words.every((w) => name.includes(w));
  });
}
