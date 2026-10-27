import { useLayoutEffect, type RefObject } from 'react';
import { create } from 'zustand';
import { playlistFolders } from '../../../shared/playlist-folders';
import type { NewItem } from '../../../shared/playlists';
import { useMode } from '../operator/mode-store';
import type { AddTarget } from '../playlists/add-made';
import { addMadeInto } from '../playlists/add-made';
import { openPlaylist, showsFolders, usePlaylists } from '../playlists/playlist-store';

/*
 * Where a download from a link goes (Session 54, F1): the playlist it went into last time, offered first (kept
 * with the library's settings, every person's), else the open one; with no playlist at all, a new one, whose
 * name the dialog asks for before the download starts. No playlist is still offered, last, but never to begin
 * with. When the download is in, that playlist opens with the new item chosen and brought into view, ready for
 * one click to put it up (F2). It never goes up by itself, the middle keeps the slides it showed (so Next carries
 * on with the show), and nothing takes the keyboard.
 */

/** The playlists a download can go into: the playlists, not their folders (templates are never in the tree). */
const playlistsNow = () => usePlaylists.getState().tree.filter((n) => !n.isFolder);

/**
 * Where a download goes to begin with: the playlist it went into last time while that is there, else the open
 * one, else a new one named after what the link holds (with no playlist at all, the only choice).
 */
export function linkTarget(lastPlaylist: string | null, name: string): AddTarget {
  const lists = playlistsNow();
  for (const id of [lastPlaylist, usePlaylists.getState().openId])
    if (id !== null && lists.some((n) => n.id === id)) return { kind: 'playlist', id };
  return { kind: 'new', name };
}

/** The choice made in the dialog (null: none made), while its playlist is there; else where it goes to begin with. */
export function chosenTarget(chosen: AddTarget | null, lastPlaylist: string | null, name: string): AddTarget {
  const gone = chosen?.kind === 'playlist' && !playlistsNow().some((n) => n.id === chosen.id);
  return chosen && !gone ? chosen : linkTarget(lastPlaylist, name);
}

/** The card a download just brought in, until the open playlist has brought it into view. */
export const useLanded = create<{ itemId: string | null }>(() => ({ itemId: null }));

/**
 * What a download brought in, into the playlist chosen for it (made now, when it is a new one): that playlist
 * is remembered for the next download and opens with the new items chosen. Its name, or null when nothing went
 * in (the library refused it, say).
 */
export async function landInPlaylist(target: AddTarget, items: NewItem[]): Promise<string | null> {
  const landed = await addMadeInto(target, items);
  if (!landed) return null;
  void window.drashti.links.setPlaylist(landed.playlistId);
  await showLanded(landed.playlistId, landed.itemIds);
  return landed.name;
}

/** Open the playlist a download went into, its new items chosen, the first brought into view. */
async function showLanded(playlistId: string, itemIds: readonly string[]): Promise<void> {
  // Simple Mode's playlist is the volunteer's to choose: it never changes by itself.
  if (useMode.getState().mode === 'simple') return;
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
