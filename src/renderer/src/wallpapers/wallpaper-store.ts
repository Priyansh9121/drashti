import { create } from 'zustand';
import type { Wallpaper, WallpaperResult, WallpapersView } from '../../../shared/wallpapers';
import { refusedWords } from '../../../shared/wallpapers';
import { askRenameWithUndo } from '../files/rename-in-window';
import { useConvert } from '../library/convert-store';
import { copyFor } from '../library/converting';
import { importPaths } from '../library/import-store';
import { showImportNotice } from '../library/import-notices';
import { pushRemoval } from '../library/undo';
import { useNotice } from '../operator/actions';
import { drawQuotes } from './quote-pictures';

/*
 * The wallpapers in the operator window (Session 55, Part 6; their place in the Playlists panel:
 * WallpapersPanel.tsx): the library's, as the main process says them, and what the window does with them. Files
 * dropped from the Finder or Explorer, or picked with Import…, are imported as any import is and each becomes a
 * wallpaper (or, dropped on one, more pictures for it); anything not a picture is said, with why. Choosing,
 * renaming, deleting (Undo) and editing a wallpaper's pictures and timing are the main process's; each change can be
 * undone from the undo bar. The idle rotation's quotes still to be drawn as pictures are drawn here (quote-pictures.ts).
 */

export const useWallpapers = create<{
  view: WallpapersView | null;
  /** The wallpaper whose pictures and timing are being changed, or null. */
  editing: string | null;
  /** The chosen one, asked about before it is deleted (it is on the screens whenever nothing is up). */
  asking: { id: string; name: string } | null;
}>(() => ({ view: null, editing: null, asking: null }));

const api = () => window.drashti.wallpapers;

function shown(view: WallpapersView): void {
  useWallpapers.setState((s) => ({
    view,
    // One deleted elsewhere (or by Undo) is no longer edited or asked about.
    editing: s.editing !== null && view.wallpapers.some((w) => w.id === s.editing) ? s.editing : null,
  }));
  if (view.quotesToDraw) void drawQuotes(view.quotesToDraw);
}

let watching = false;

/** Follow the wallpapers from the main process (once for the window). */
export function watchWallpapers(): void {
  if (watching) return;
  watching = true;
  api().onChanged(shown);
  void api()
    .view()
    .then(shown)
    .catch(() => undefined);
}

/** A change that failed says why, in the window's notice line; true when it worked. */
function settled(result: WallpaperResult): result is { ok: true; ids: string[] } {
  if (!result.ok) useNotice.setState({ text: result.message });
  return result.ok;
}

const wallpaperOf = (id: string): Wallpaper | undefined =>
  useWallpapers.getState().view?.wallpapers.find((w) => w.id === id);

/** Pictures in the library as wallpapers (one each), or into one (`into`), with Undo. */
export async function addWallpapers(mediaIds: readonly string[], into: string | null = null): Promise<void> {
  if (mediaIds.length === 0) return;
  const before = into === null ? null : (wallpaperOf(into)?.pictures.map((p) => p.mediaId) ?? null);
  const result = await api().add([...mediaIds], into);
  if (!settled(result)) return;
  if (into !== null && before !== null) {
    const name = wallpaperOf(into)?.name ?? 'the wallpaper';
    pushRemoval({
      text: `Added ${String(mediaIds.length)} picture${mediaIds.length === 1 ? '' : 's'} to “${name}”`,
      restore: async () => {
        await api().setPictures(into, before);
      },
    });
    return;
  }
  const names = result.ids.map((id) => wallpaperOf(id)?.name ?? '');
  pushRemoval({
    text:
      result.ids.length === 1
        ? `Added the wallpaper “${names[0] ?? ''}”`
        : `Added ${String(result.ids.length)} wallpapers`,
    restore: async () => {
      for (const id of result.ids) await api().remove(id);
    },
  });
}

/**
 * Files from the computer (dropped, or picked with Import…): the pictures imported as any import is, then each a
 * wallpaper (or into `into`); anything else is said, with why, in the window's notice line.
 */
export async function addWallpaperFiles(paths: readonly string[], into: string | null = null): Promise<void> {
  if (paths.length === 0) return;
  const sorted = await api().sortFiles([...paths]);
  for (const refused of sorted.refused) {
    const message = refusedWords([refused]);
    if (message !== null) showImportNotice(message);
  }
  await importPaths(sorted.pictures, undefined, async (made) => {
    const jobs = useConvert.getState().jobs;
    const ids = made.flatMap((item) => (item.kind === 'media' ? [copyFor(item.mediaId, jobs)] : []));
    await addWallpapers(ids, into);
  });
}

/** Import…: the system's dialog for pictures. */
export async function importWallpapers(into: string | null = null): Promise<void> {
  await addWallpaperFiles(await api().pickFiles(), into);
}

/** Choose one (null: none, so the screens show black with nothing up). */
export async function chooseWallpaper(id: string | null): Promise<void> {
  settled(await api().choose(id));
}

/** Rename one (asked, with Undo, as a file's: Session 58, X3). */
export function renameWallpaper(wallpaper: Wallpaper): void {
  askRenameWithUndo('the wallpaper', wallpaper.name, (to) => api().rename(wallpaper.id, to));
}

/** Delete one, with Undo: the chosen one is asked about first (it is on the screens whenever nothing is up). */
export function requestDeleteWallpaper(wallpaper: Wallpaper): void {
  if (useWallpapers.getState().view?.chosenId === wallpaper.id)
    useWallpapers.setState({ asking: { id: wallpaper.id, name: wallpaper.name } });
  else void deleteWallpaper(wallpaper.id, wallpaper.name);
}

export async function deleteWallpaper(id: string, name: string): Promise<void> {
  useWallpapers.setState({ asking: null });
  if (!settled(await api().remove(id))) return;
  pushRemoval({
    text: `Deleted the wallpaper “${name}”`,
    restore: async () => {
      await api().restore(id);
    },
  });
}

/** Its pictures in this order, and its timing, as the editor leaves them (one Undo for the change). */
export async function saveWallpaper(
  id: string,
  pictures: readonly string[],
  timing: { secondsEach: number; fadeMs: number },
): Promise<boolean> {
  const was = wallpaperOf(id);
  if (!was) return false;
  const before = was.pictures.map((p) => p.mediaId);
  const samePictures = before.length === pictures.length && before.every((p, i) => p === pictures[i]);
  const sameTiming = was.secondsEach === timing.secondsEach && was.fadeMs === timing.fadeMs;
  if (samePictures && sameTiming) return true;
  if (!samePictures && !settled(await api().setPictures(id, [...pictures]))) return false;
  if (!sameTiming && !settled(await api().setTiming(id, timing))) return false;
  pushRemoval({
    text: `Changed the wallpaper “${was.name}”`,
    restore: async () => {
      if (!samePictures) await api().setPictures(id, before);
      if (!sameTiming) await api().setTiming(id, { secondsEach: was.secondsEach, fadeMs: was.fadeMs });
    },
  });
  return true;
}
