import { stat } from 'node:fs/promises';
import type { WallpaperFiles } from '../../shared/wallpapers';
import { extOf, formatOf, mediaKindOf } from '../import/scan';

/*
 * Files offered as wallpapers (Session 55, Part 6: dropped from the Finder or Explorer, or picked with Import…):
 * pictures only, of any type Drashti imports as a picture (the import's own list, import/scan.ts, so a type Part 5
 * adds there is a wallpaper's too); anything else is refused, each with why, never silently.
 */

/** Why a file that is not a picture was refused, in a few words. */
function whyNot(path: string): string {
  const kind = mediaKindOf(path);
  if (kind === 'video') return 'is a video';
  if (kind === 'audio') return 'is a sound';
  if (formatOf(path) === 'pictures') {
    const ext = extOf(path);
    if (ext === 'pdf') return 'is a PDF';
    if (ext === 'key') return 'is a Keynote deck';
    return 'is a PowerPoint deck';
  }
  return 'is not a picture';
}

const nameOf = (path: string) => path.split(/[\\/]/u).pop() ?? path;

/** The pictures among `paths`, in order, and the rest with why each is not one. `isFolder` asks the disk. */
export async function sortWallpaperFiles(
  paths: readonly string[],
  isFolder: (path: string) => Promise<boolean> = async (path) => {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
): Promise<WallpaperFiles> {
  const out: WallpaperFiles = { pictures: [], refused: [] };
  for (const path of paths) {
    if (await isFolder(path)) out.refused.push({ name: nameOf(path), why: 'is a folder' });
    else if (mediaKindOf(path) === 'image') out.pictures.push(path);
    else out.refused.push({ name: nameOf(path), why: whyNot(path) });
  }
  return out;
}
