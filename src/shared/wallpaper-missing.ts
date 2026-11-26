import type { Wallpaper } from './wallpapers';

/*
 * A wallpaper whose pictures are gone from the library (QA24-WALLBLACK-1, the owner's "the wallpaper goes black"):
 * deleted from Media, or gone at a start after that, or never found. The screens leave such a picture out, as they
 * always have: with none of its pictures left, they show black whenever nothing is up, as with no wallpaper chosen
 * (render/NothingUp.tsx). The operator window says so, never a silent black: its tile, the Wallpapers panel (with
 * Find…, Find missing media… for those pictures) and LIVE.
 */

export interface WallpaperMissing {
  /** None of its pictures there ('all'), some ('some'), or it has none at all ('none'). */
  kind: 'all' | 'some' | 'none';
  /** How many of its pictures are missing. */
  count: number;
  /** Said after its name, for a screen reader ("its picture is missing"). */
  label: string;
  /** In its tile, where its picture would be ('all' and 'none'). */
  tile: string;
  /** The Wallpapers panel's line, for the chosen one. */
  notice: string;
  /** LIVE's line, while the screens show black for it ('all' and 'none'); null when the others go round. */
  live: string | null;
  /** The missing pictures Find… looks for (each once). */
  find: string[];
}

const BLACK = 'With nothing up, the screens show black.';
const LIVE_BLACK = 'The screens show black when the wallpaper is up.';

/** What is missing of a wallpaper's pictures, in words, or null when all of them are there. */
export function wallpaperMissing(wallpaper: Pick<Wallpaper, 'pictures'>): WallpaperMissing | null {
  const all = wallpaper.pictures;
  if (all.length === 0)
    return {
      kind: 'none',
      count: 0,
      label: 'it has no picture',
      tile: 'No picture',
      notice: `The wallpaper has no picture. ${BLACK} Drop a picture on it, or choose another.`,
      live: `Wallpaper has no picture. ${LIVE_BLACK}`,
      find: [],
    };
  const gone = all.filter((p) => p.missing);
  if (gone.length === 0) return null;
  // A picture whose row is gone from the library has no name, and nothing Find… could look for.
  const find = [...new Set(gone.filter((p) => p.name !== '').map((p) => p.mediaId))];
  const [first] = gone;
  const named = first && first.name !== '' ? `: “${first.name}”` : '';
  if (gone.length < all.length)
    return {
      kind: 'some',
      count: gone.length,
      label: `${String(gone.length)} of them missing`,
      tile: '',
      notice:
        gone.length === 1
          ? `One of the wallpaper’s pictures is missing${named}. The others go round on the screens.`
          : `${String(gone.length)} of the wallpaper’s pictures are missing. The others go round on the screens.`,
      live: null,
      find,
    };
  return all.length === 1
    ? {
        kind: 'all',
        count: 1,
        label: 'its picture is missing',
        tile: 'Picture missing',
        notice: `The wallpaper’s picture is missing${named}. ${BLACK}`,
        live: `Wallpaper’s picture missing${named}. ${LIVE_BLACK}`,
        find,
      }
    : {
        kind: 'all',
        count: gone.length,
        label: 'its pictures are missing',
        tile: 'Pictures missing',
        notice: `The wallpaper’s ${String(all.length)} pictures are missing. ${BLACK}`,
        live: `Wallpaper’s pictures missing. ${LIVE_BLACK}`,
        find,
      };
}
