import { create } from 'zustand';
import type { MediaSummary } from '../../../shared/playlists';
import { COMBINE_MOST, type CombineJob, type ExportCopyResult } from '../../../shared/video-copies';
import { addFileMenuItems, type FileTarget } from '../files/file-menu';
import { Layers } from '../ui/icons';
import type { MenuEntry } from '../ui/Menu';
import { useMedia } from './library-store';

/*
 * Combine videos… (alpha.22; the owner, 24 Nov 2026: "new feature, combine 2 videos", "Yes, one after other"): in
 * Media, the right-click menu of a video chosen with one or more other videos (Cmd-click on a Mac, Ctrl-click on
 * Windows) opens a small window to put them in order and join them into one new video. Pro Mode's menu only.
 */
export interface CombineVideo {
  id: string;
  name: string;
}
export const useCombineVideos = create<{ videos: CombineVideo[] | null }>(() => ({ videos: null }));
export const closeCombineVideos = () => useCombineVideos.setState({ videos: null });

/** A video that can be combined: in Media, its file there, and one Drashti plays. */
const combinable = (m: MediaSummary) => m.kind === 'video' && !m.missing && m.unplayable === null;

/** The chosen videos, in Media's order, when the right-click is on one of two or more of them; else nothing. */
export function combineItems(
  target: FileTarget,
  media: readonly MediaSummary[],
  marked: readonly string[],
  open = (videos: CombineVideo[]) => useCombineVideos.setState({ videos }),
): MenuEntry[] {
  const id = target.mediaId;
  if (target.place !== 'media' || target.kind !== 'video' || !id || !marked.includes(id)) return [];
  const chosen = media.filter((m) => marked.includes(m.id) && combinable(m));
  if (chosen.length < 2 || !chosen.some((m) => m.id === id)) return [];
  const videos = chosen.slice(0, COMBINE_MOST).map((m) => ({ id: m.id, name: m.name }));
  return [{ label: 'Combine videos…', icon: Layers, onSelect: () => open(videos) }];
}

export function addCombineToMenu(): () => void {
  return addFileMenuItems((target) => {
    const { media, marked } = useMedia.getState();
    return combineItems(target, media, marked);
  });
}

/** The list moved: the video at `at` one place up (-1) or down (+1). */
export function moved<T>(list: readonly T[], at: number, by: -1 | 1): T[] {
  const to = at + by;
  if (at < 0 || at >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(at, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** A file's name from its full path, on a Mac or Windows. */
const fileName = (path: string) => path.split(/[\\/]/u).pop() ?? path;
const secondsWords = (ms: number) => `${String(ms / 1000)} s`;

/** What a combine is doing, in plain words: its line, then what to know about it (a cut, a copy saved, a problem). */
export function combineJobWords(job: CombineJob): string[] {
  const lines: string[] = [];
  if (job.state === 'done') lines.push(`Added “${job.name}” to Media.`);
  else if (job.state === 'waiting') lines.push(job.note ?? `Waiting to combine “${job.name}”.`);
  else if (job.state === 'preparing')
    lines.push(job.note ?? `Combining “${job.name}”… ${String(Math.round((job.progress ?? 0) * 100))}%`);
  else if (job.state === 'stopped') lines.push(job.message ?? 'Stopped. Nothing was added to Media.');
  else lines.push(job.message ?? 'The videos could not be combined. Check them, then Combine again.');
  if (job.state !== 'failed' && job.state !== 'stopped')
    for (const name of job.short)
      lines.push(
        `“${name}” is too short for the ${secondsWords(job.transitionMs)} transition: it is joined with a plain cut.`,
      );
  if (job.state === 'done' && job.savedTo) lines.push(`A copy was saved as “${fileName(job.savedTo)}”.`);
  if (job.state === 'done' && job.message) lines.push(job.message);
  return lines;
}

/** Export…'s words: where it went, or why not (nothing when its save dialog was cancelled). */
export function exportWords(result: ExportCopyResult): string | null {
  if (!result.ok) return result.message;
  return result.path ? `Exported as “${fileName(result.path)}”.` : null;
}
