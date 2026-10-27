import type { EngineState } from '../../../../shared/engine/state';
import type { PlaylistNode } from '../../../../shared/playlists';
import { api } from '../device';

/*
 * Repeat Slides from the phone (Session 54, D5 review), as the operator window and Simple Mode start it
 * (playlists/repeat-actions.ts): a Repeat Slides playlist is never played item by item (a tap on its item would
 * play nothing), it goes round: from its first step (Start going round, or Next with nothing up), or from an item's
 * first step, which the main process finds from the item (POST /api/v1/repeat/{id}/start).
 */

/** Whether the playlist chosen on the phone is a Repeat Slides one. */
export const isRepeatPlaylist = (
  playlists: readonly PlaylistNode[] | null,
  playlistId: string | null,
): boolean => playlistId !== null && playlists?.find((p) => p.id === playlistId)?.kind === 'repeat';

/** While that playlist goes round, the item whose step is up (its steps are named "<item>/…"), as Simple Mode marks it. */
export function repeatItemUp(state: EngineState | null, playlistId: string | null): string | null {
  if (playlistId === null || state?.repeat?.playlistId !== playlistId) return null;
  return state.layers.slide?.slide.id.split('/')[0] ?? null;
}

/** Start it going round: from its first step, or from an item's. */
export const startGoingRound = (playlistId: string, itemId?: string) =>
  api<{ rev?: number }>(`/api/v1/repeat/${encodeURIComponent(playlistId)}/start`, {
    method: 'POST',
    body: itemId === undefined ? {} : { itemId },
  });
