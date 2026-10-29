import type { EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import { WallpaperView } from './WallpaperView';

/*
 * What an audience screen shows while nothing is up (Session 55, Part 1), and under the Wallpaper button (Part 13,
 * in the Logo's place): the one place for Part 6's chosen wallpaper. A screen that has just started (plugged in, at
 * the start, after Set Up Screens…) shows it until something is put up, and so does every screen after Clear all;
 * there is no test slide. The idle rotation that showed here went with Part 12.
 *
 * Part 6 (Session 55): the chosen wallpaper is in the engine's state (`chosenWallpaper`, set by the main process from
 * the library), and is drawn here alone, by WallpaperPicture (render/WallpaperView.tsx: one picture, or several going
 * round with a fade): both NothingUp and WallpaperCover draw through it, on every audience screen, node, key and
 * fill's fill and phone alike, as Scene.tsx draws them. With none chosen (or none of its pictures left in the
 * library), both are black: nothing over the scene's own black, and a black square over the layers.
 */

/** What shows while nothing is up, as a screen's scene says it (data-nothing-up): black, or the chosen wallpaper. */
export type NothingUpShows = 'black' | 'wallpaper';

/** What shows while nothing is up: the chosen wallpaper while one with a picture is chosen, else black. */
export function nothingUpShows(state: EngineState): NothingUpShows {
  return (state.chosenWallpaper?.pictures.length ?? 0) > 0 ? 'wallpaper' : 'black';
}

/** The chosen wallpaper, filling the screen's canvas (Part 6); none chosen: the screen's black shows. */
function WallpaperPicture({ state, canvas: _canvas }: { state: EngineState; canvas: Size }) {
  const chosen = state.chosenWallpaper;
  return chosen && chosen.pictures.length > 0 ? <WallpaperView wallpaper={chosen} /> : null;
}

/** With nothing up: the chosen wallpaper, or nothing over the scene's own black. */
export function NothingUp({
  shows,
  state,
  canvas,
}: {
  shows: NothingUpShows;
  state: EngineState;
  canvas: Size;
}) {
  return shows === 'black' ? null : <WallpaperPicture state={state} canvas={canvas} />;
}

/**
 * The Wallpaper up (F12, the bottom bar's Wallpaper, a phone's, the API's): black over the layers, which carry on
 * underneath, with the chosen wallpaper on it.
 */
export function WallpaperCover({ state, canvas }: { state: EngineState; canvas: Size }) {
  return (
    <div
      data-layer="wallpaper"
      data-testid="wallpaper"
      style={{ position: 'absolute', inset: 0, background: '#000000' }}
    >
      <WallpaperPicture state={state} canvas={canvas} />
    </div>
  );
}
