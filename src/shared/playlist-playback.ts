import type { PlaylistItemInfo } from './playlists';

/** Timed media in this playlist, between their own start and end points. */
export function playlistTotals(items: readonly PlaylistItemInfo[]): {
  rows: number;
  durationMs: number;
  unknown: number;
} {
  void items;
  return { rows: 0, durationMs: 0, unknown: 0 };
}

/** Time left along automatic Next item links; null when its end cannot be known. */
export function playlistLeftMs(
  items: readonly PlaylistItemInfo[],
  order: readonly string[],
  liveId: string,
  leftMs: number,
  repeatAll: boolean,
): number | null {
  void items;
  void order;
  void liveId;
  void leftMs;
  void repeatAll;
  return null;
}
