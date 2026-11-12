import { useLayoutEffect, type RefObject } from 'react';
import { create } from 'zustand';
import { playlistFolders } from '../../../shared/playlist-folders';
import type { NewItem } from '../../../shared/playlists';
import type { AddTarget } from '../playlists/add-made';
import { addMadeInto } from '../playlists/add-made';
import { openPlaylist, showsFolders, usePlaylists } from '../playlists/playlist-store';

/** The playlist open at the paste. Templates and folders do not take downloads. */
export function linkPlaylistId(): string | null {
  const { openId, tree } = usePlaylists.getState();
  return tree.some((node) => node.id === openId && !node.isFolder) ? openId : null;
}

/** The card a download just brought in, until the open playlist has brought it into view. */
export const useLanded = create<{ itemId: string | null }>(() => ({ itemId: null }));

/**
 * What a download brought in, into the playlist chosen for it (made now, when it is a new one): that playlist
 * opens with the new items chosen. Its name, or null when nothing went in.
 */
export async function landInPlaylist(target: AddTarget, items: NewItem[]): Promise<string | null> {
  const landed = await addMadeInto(target, items);
  if (!landed) return null;
  await showLanded(landed.playlistId, landed.itemIds);
  return landed.name;
}

/** Open the playlist a download went into, its new items chosen, the first brought into view. */
async function showLanded(playlistId: string, itemIds: readonly string[]): Promise<void> {
  // In Simple Mode too since Session 56: its window opens any playlist, as Pro Mode's does.
  if (usePlaylists.getState().openId !== playlistId) await openPlaylist(playlistId);
  const state = usePlaylists.getState();
  const first = state.openId === playlistId ? state.items.find((i) => itemIds.includes(i.id)) : undefined;
  if (!first) return;
  // Shown a folder at a time (Session 44): the folder it went into.
  const folder = showsFolders(state) ? (playlistFolders(state.items).folderOf.get(first.id) ?? '') : '';
  usePlaylists.setState({ marked: [...itemIds], anchorId: first.id, folder });
  useLanded.setState({ itemId: first.id });
}

/**
 * Bring the card a download just brought in into view once the open playlist draws it (`drawn`: its rows), only
 * scrolled to: never given the keyboard, which stays where the operator has it.
 */
export function useLandedInView(list: RefObject<HTMLElement | null>, drawn: unknown): void {
  const itemId = useLanded((s) => s.itemId);
  useLayoutEffect(() => {
    if (itemId === null) return;
    const row = list.current?.querySelector(`[data-item-row="${CSS.escape(itemId)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    useLanded.setState({ itemId: null });
  }, [itemId, drawn, list]);
}
