import type { EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';

/*
 * What an audience screen shows while nothing is up (Session 55, Part 1), and under the Wallpaper button (Part 13,
 * in the Logo's place): the one place for Part 6's chosen wallpaper. A screen that has just started (plugged in, at
 * the start, after Set Up Screens…) shows it until something is put up, and so does every screen after Clear all;
 * there is no test slide. The idle rotation that showed here went with Part 12.
 *
 * Today no wallpaper can be chosen, so both are black: nothing over the scene's own black (`NothingUp`), and the
 * Wallpaper's cover a black square over the layers (`WallpaperCover`). Part 6 plugs the chosen wallpaper in here, and
 * only here: it adds the chosen wallpaper to the engine's state, returns 'wallpaper' from nothingUpShows when one is
 * chosen, and draws it in WallpaperPicture (both NothingUp and WallpaperCover draw through it, on every audience
 * screen, node, key and fill's fill and phone alike, as Scene.tsx draws them).
 */

/**
 * What shows while nothing is up, as a screen's scene says it (data-nothing-up): black, or the chosen wallpaper
 * (Part 6: none can be chosen yet).
 */
export type NothingUpShows = 'black' | 'wallpaper';

/** What shows while nothing is up (Part 6: 'wallpaper' while one is chosen in `state`). */
export function nothingUpShows(_state: EngineState): NothingUpShows {
  return 'black';
}

/** The chosen wallpaper, filling the screen's canvas (Part 6). Nothing yet: the screen's black shows. */
function WallpaperPicture({ state: _state, canvas: _canvas }: { state: EngineState; canvas: Size }) {
  return null;
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
