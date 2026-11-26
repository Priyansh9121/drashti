import { type EngineState, nothingUpButTheBox } from './engine/state';
import type { Wallpaper } from './wallpapers';

/*
 * A wallpaper whose pictures are gone from the library (QA24-WALLBLACK-1, the owner's "the wallpaper goes black"):
 * deleted from Media, or gone at a start after that, or never found. The screens leave such a picture out, as they
 * always have: with none of its pictures left, they show black whenever nothing is up, as with no wallpaper chosen
 * (render/NothingUp.tsx). The operator window says so, never a silent black: its tile, the Wallpapers panel (with
 * Find…, Find missing media… for those pictures) and LIVE.
 */

export interface WallpaperMissing {
  /** All or some pictures unavailable, or it has none at all ('none'). */
  kind: 'all' | 'some' | 'none';
  /** How many pictures are missing or need conversion. */
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
  // A picture whose row is gone from the library has no name, and nothing Find… could look for.
  const find = [...new Set(gone.filter((p) => p.name !== '').map((p) => p.mediaId))];
  const needsConversion = all.filter((p) => !p.missing && p.unplayable);
  if (needsConversion.length > 0) {
    const count = gone.length + needsConversion.length;
    const allUnavailable = count === all.length;
    const [first] = needsConversion;
    const named = needsConversion.length === 1 && first?.name ? `: “${first.name}”` : '';
    const subject =
      all.length === 1
        ? 'The wallpaper’s picture'
        : needsConversion.length === 1
          ? 'One of the wallpaper’s pictures'
          : `${String(needsConversion.length)} of the wallpaper’s pictures`;
    const issue = `${subject} ${needsConversion.length === 1 ? 'needs' : 'need'} conversion${named}.`;
    const advice = needsConversion.length === 1 ? 'Convert it in Media.' : 'Convert them in Media.';
    const missing =
      gone.length === 0
        ? ''
        : gone.length === 1
          ? ' 1 picture is missing.'
          : ` ${String(gone.length)} pictures are missing.`;
    return {
      kind: allUnavailable ? 'all' : 'some',
      count,
      label:
        gone.length > 0
          ? `${String(count)} of them are missing or need conversion`
          : all.length === 1
            ? 'its picture needs conversion'
            : `${String(count)} of them ${count === 1 ? 'needs' : 'need'} conversion`,
      tile: !allUnavailable
        ? ''
        : gone.length > 0
          ? 'Check pictures'
          : all.length === 1
            ? 'Convert picture'
            : 'Convert pictures',
      notice: `${issue} ${advice}${missing} ${allUnavailable ? BLACK : 'Pictures needing conversion show black on their turns.'}`,
      live: allUnavailable ? `${issue}${missing} ${LIVE_BLACK}` : null,
      find,
    };
  }
  if (gone.length === 0) return null;
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

/**
 * LIVE's line for the chosen wallpaper (operator/LivePreview.tsx), while the screens show black for it: with nothing up
 * (a box up and not swapped over nothing else too, as the screens draw it: QA24-WALLBLACK-2, the one rule of
 * shared/engine/state.ts nothingUpBehindBox), or under the Wallpaper; null when none is chosen, its pictures are there,
 * or something is up.
 */
export function wallpaperMissingLive(
  state: Pick<EngineState, 'layers' | 'wallpaper'>,
  chosen: Pick<Wallpaper, 'pictures'> | null,
): string | null {
  if (chosen === null || !(nothingUpButTheBox(state.layers) || state.wallpaper)) return null;
  return wallpaperMissing(chosen)?.live ?? null;
}
