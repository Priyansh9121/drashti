import { create } from 'zustand';
import type { MusicPlaylist, MusicResult, MusicView } from '../../../shared/music';
import { describeSome, pushRemoval } from '../library/undo';
import { useNotice } from '../operator/actions';

/* Audio playlists in the operator window (Session 14): the library's lists, and which one the panel shows. */

export const useMusic = create<{
  view: MusicView | null;
  shownId: string | null;
  adding: boolean;
  /** The audio playlist whose name is being typed in its row (Session 44: a new one at once). */
  renamingId: string | null;
  /** Audio playlists, and sounds of the one shown, chosen together (Session 44): Delete takes them all. */
  markedLists: string[];
  listAnchor: string | null;
  markedTracks: string[];
  trackAnchor: string | null;
}>(() => ({
  view: null,
  shownId: null,
  adding: false,
  renamingId: null,
  markedLists: [],
  listAnchor: null,
  markedTracks: [],
  trackAnchor: null,
}));

/** Chosen ids after a click with Cmd/Ctrl (one more) or Shift (a range of `order` from the anchor). */
export function clickedMany(
  order: readonly string[],
  marked: readonly string[],
  anchor: string | null,
  id: string,
  mods: { toggle: boolean; range: boolean },
): { marked: string[]; anchor: string | null } {
  if (mods.range && anchor !== null) {
    const from = order.indexOf(anchor);
    const to = order.indexOf(id);
    if (from >= 0 && to >= 0)
      return { marked: order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor };
  }
  const set = new Set(marked);
  if (mods.toggle && set.has(id)) set.delete(id);
  else set.add(id);
  return { marked: [...set], anchor: id };
}

/** The audio playlist the panel shows: the one chosen, else the one playing, the one played last, or the first. */
export function shownMusic(
  view: MusicView | null,
  shownId: string | null,
  playingId: string | null,
): MusicPlaylist | null {
  const lists = view?.playlists ?? [];
  return (
    lists.find((p) => p.id === shownId) ??
    lists.find((p) => p.id === playingId) ??
    lists.find((p) => p.id === view?.lastId) ??
    lists[0] ??
    null
  );
}

let connected = false;

export function connectMusic(): void {
  if (connected) return;
  connected = true;
  window.drashti.music.onChanged((view) => {
    useMusic.setState({ view });
  });
  void window.drashti.music.view().then((view) => {
    useMusic.setState({ view });
  });
}

/** Run a change; what went wrong goes in the notice area. Returns the result. */
export async function musicAction(run: () => Promise<MusicResult>): Promise<MusicResult> {
  const result = await run();
  if (result.ok) useMusic.setState({ view: result.view, ...(result.id ? { shownId: result.id } : {}) });
  else useNotice.setState({ text: result.message });
  return result;
}

/** Delete an audio playlist (its trash button, after asking); Undo brings it back (Session 26a). */
export async function deleteMusic(id: string, name: string): Promise<void> {
  const result = await musicAction(() => window.drashti.music.remove(id));
  if (!result.ok) return;
  pushRemoval({
    text: `Deleted music “${name}”`,
    restore: async () => {
      await musicAction(() => window.drashti.music.restore(id));
    },
  });
}

/** Delete several audio playlists at once (after asking); one Undo brings them all back (Session 44). */
export async function deleteManyMusic(ids: readonly string[], names: readonly string[]): Promise<void> {
  const done: string[] = [];
  for (const id of ids) if ((await musicAction(() => window.drashti.music.remove(id))).ok) done.push(id);
  useMusic.setState({ markedLists: [], listAnchor: null });
  if (done.length === 0) return;
  pushRemoval({
    text: `Deleted ${describeSome(names, done.length, 'audio playlist')}`,
    restore: async () => {
      for (const id of done) await musicAction(() => window.drashti.music.restore(id));
    },
  });
}

/** Take several sounds out of an audio playlist at once; one Undo puts each back at its place (Session 44). */
export async function takeOutTracks(
  tracks: readonly { id: string; at: number; name: string }[],
  list: string,
): Promise<void> {
  const done: { id: string; at: number }[] = [];
  for (const t of tracks)
    if ((await musicAction(() => window.drashti.music.removeTrack(t.id))).ok)
      done.push({ id: t.id, at: t.at });
  useMusic.setState({ markedTracks: [], trackAnchor: null });
  if (done.length === 0) return;
  pushRemoval({
    text: `Removed ${describeSome(
      tracks.map((t) => t.name),
      done.length,
      'sound',
    )} from “${list}”`,
    restore: async () => {
      // From the top down, so each lands where it was.
      for (const t of [...done].sort((a, b) => a.at - b.at))
        await musicAction(() => window.drashti.music.restoreTrack(t.id, t.at));
    },
  });
}

/** Take a sound out of an audio playlist (the library keeps it); Undo puts it back at its place. */
export async function takeOutTrack(trackId: string, at: number, name: string, list: string): Promise<void> {
  const result = await musicAction(() => window.drashti.music.removeTrack(trackId));
  if (!result.ok) return;
  pushRemoval({
    text: `Removed “${name}” from “${list}”`,
    restore: async () => {
      await musicAction(() => window.drashti.music.restoreTrack(trackId, at));
    },
  });
}
