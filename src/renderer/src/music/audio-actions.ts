import type { DragEvent } from 'react';
import { itemsMadeBy } from '../../../shared/import-items';
import { useConvert } from '../library/convert-store';
import { copyFor } from '../library/converting';
import { importPaths } from '../library/import-store';
import { useNotice } from '../operator/actions';
import { dragKind, droppedIds, droppedPaths, hasFiles } from '../playlists/drag';
import { musicAction, useMusic } from './music-store';

/*
 * Bringing sounds into Audio (Session 44; Priyansh: "I can add by drag and drop, in audio and import audio via
 * a small plus sign which says create playlist and import, only 2 options"). Audio's + makes an audio
 * playlist or imports sounds into the one shown; sound files dragged from the Finder or Explorer, or sounds
 * dragged from the library's sheet, go into the audio playlist they are dropped on. Only sounds go into an
 * audio playlist: anything else dropped is imported into the library as any import is, and said.
 */

const BASE = 'Audio playlist';

/** "Audio playlist", or the first "Audio playlist N" no audio playlist has. */
function freshName(): string {
  const taken = new Set((useMusic.getState().view?.playlists ?? []).map((p) => p.name.toLocaleLowerCase()));
  if (!taken.has(BASE.toLocaleLowerCase())) return BASE;
  for (let n = 2; ; n++)
    if (!taken.has(`${BASE} ${String(n)}`.toLocaleLowerCase())) return `${BASE} ${String(n)}`;
}

/** Create playlist: a new, empty audio playlist, shown; `rename` puts its name in a field at once. Its id. */
export async function createAudioPlaylist(rename = true): Promise<string | null> {
  const result = await musicAction(() => window.drashti.music.create(freshName()));
  if (!result.ok || result.id === undefined) return null;
  useMusic.setState({ shownId: result.id, renamingId: rename ? result.id : null });
  return result.id;
}

/** Sounds of the library into an audio playlist (a new one when there is none yet), at its end. */
export async function addSoundsTo(playlistId: string | null, mediaIds: readonly string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  const target = playlistId ?? (await createAudioPlaylist(false));
  if (target === null) return;
  const count = () => useMusic.getState().view?.playlists.find((p) => p.id === target)?.tracks.length ?? 0;
  const before = count();
  const result = await musicAction(() => window.drashti.music.addTracks(target, [...mediaIds], null));
  if (result.ok && count() === before)
    useNotice.setState({
      text: 'Only sounds go into an audio playlist. Pictures and videos stay in the library, for a playlist of the slides.',
    });
}

/** Files from the computer: imported as any import is, then the sounds among them into the audio playlist. */
export async function importSoundsInto(playlistId: string | null, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const result = await importPaths([...paths], undefined, { report: false });
  if (!result?.ok) return;
  const report = await window.drashti.library.getImportReport(result.run.id);
  const made = itemsMadeBy(report?.items ?? [], [...paths]);
  // A sound Drashti converted by itself goes in as its copy (Session 50); one still converting moves to its
  // copy once that is done, as everything that uses it does.
  const jobs = useConvert.getState().jobs;
  await addSoundsTo(
    playlistId,
    made.flatMap((i) => (i.kind === 'media' ? [copyFor(i.mediaId, jobs)] : [])),
  );
}

/** Import (Audio's +): the system's dialog for sounds, then into the audio playlist shown (a new one when none). */
export async function importSounds(playlistId: string | null): Promise<void> {
  await importSoundsInto(playlistId, await window.drashti.library.pickImportPaths('sounds'));
}

/** Whether a drag is something an audio playlist takes: files, or media from the library. */
export const takesSounds = (e: DragEvent): boolean => hasFiles(e) || dragKind(e) === 'media';

/** A drop on an audio playlist: files imported, the library's sounds added. Kept from the window's own drop. */
export function dropSounds(e: DragEvent, playlistId: string | null): void {
  if (!takesSounds(e)) return;
  e.preventDefault();
  // The window imports files dropped anywhere else: this playlist has them.
  e.stopPropagation();
  if (hasFiles(e)) void importSoundsInto(playlistId, droppedPaths(e));
  else void addSoundsTo(playlistId, droppedIds(e, 'media'));
}
