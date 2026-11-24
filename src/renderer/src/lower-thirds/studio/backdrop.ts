import type { PictureLook } from '../../../../shared/picture-look';
import type { StudioLivePicture } from '../../../../shared/studio-live';
import type { ChosenWallpaper } from '../../../../shared/wallpapers';
import { readPersisted, writePersisted } from '../../ui/persist';

/*
 * What is behind the Lower Thirds studio's preview (Session 55, Part 16: Dark, Light or Picture; alpha.22, the owner:
 * "give wallpaper a default and aother option of live as well to see how lower thirds looks"):
 *
 * - Wallpaper, first and the default: the wallpaper chosen in Drashti, as the hall shows it (its pictures going
 *   round, each with its look); with none chosen, plain dark with the words "No wallpaper chosen". It took Picture's
 *   place (a made-up picture standing in for the hall's).
 * - Live: what the screens show now (a video, a slide, a picture, the wallpaper, black), as a still the main process
 *   takes about once a second while the studio shows Live, and never otherwise (main/lower-thirds/studio-live.ts):
 *   from a hall screen on this computer, else (alpha.23) from Live's copy, which draws no video input or other app's
 *   window, and says so then (main/lower-thirds/live-copy.ts).
 * - Dark and Light, plain, as before.
 *
 * The choice is remembered on this computer, as the template picker's favourites are (ui/persist.ts).
 */

export type Backdrop = 'wallpaper' | 'live' | 'dark' | 'light';
export const BACKDROPS: readonly Backdrop[] = ['wallpaper', 'live', 'dark', 'light'];
export const BACKDROP_NAMES: Record<Backdrop, string> = {
  wallpaper: 'Wallpaper',
  live: 'Live',
  dark: 'Dark',
  light: 'Light',
};
export const DEFAULT_BACKDROP: Backdrop = 'wallpaper';
/** Where it is remembered (ui/persist.ts). */
export const BACKDROP_KEY = 'lower-third-studio-backdrop';
export const NO_WALLPAPER = 'No wallpaper chosen';
export const NO_LIVE = 'No live picture to show';
/** Live from its copy (no hall screen here) while a video input or another app's window is live: the copy draws neither. */
export const LIVE_UNSEEN = 'No hall screen on this computer: Live here shows no video input or shown window.';

export const isBackdrop = (v: unknown): v is Backdrop =>
  typeof v === 'string' && (BACKDROPS as readonly string[]).includes(v);

/** What the preview draws behind the lower third. */
export type BackdropDraw =
  | { kind: 'wallpaper'; wallpaper: ChosenWallpaper; pictures: Record<string, PictureLook> }
  | { kind: 'live'; picture: StudioLivePicture; words?: string }
  | { kind: 'plain'; colour: string; words?: string };

const DARK = '#1f2937';
const LIGHT = '#e5e7eb';
const BLACK = '#000000';

/** The template tiles' own backdrop: plain, never the hall's (no live picture in a grid of them). */
export const TILE_BACKDROP: BackdropDraw = {
  kind: 'plain',
  colour: 'linear-gradient(160deg, #1e3a5f 0%, #6b4f2a 55%, #c2410c 100%)',
};

/**
 * What `backdrop` draws, from the hall's chosen wallpaper and its pictures' looks (the engine's state) and Live's
 * still: undefined until the first comes (black), null when this computer has nothing to take it from.
 */
export function backdropDraw(
  backdrop: Backdrop,
  hall: { wallpaper: ChosenWallpaper | null | undefined; pictures: Record<string, PictureLook> },
  live: StudioLivePicture | null | undefined,
): BackdropDraw {
  switch (backdrop) {
    case 'wallpaper':
      return hall.wallpaper && hall.wallpaper.pictures.length > 0
        ? { kind: 'wallpaper', wallpaper: hall.wallpaper, pictures: hall.pictures }
        : { kind: 'plain', colour: DARK, words: NO_WALLPAPER };
    case 'live':
      // From Live's copy (no hall screen here) with a video input or another app's window live: it draws neither.
      if (live)
        return (live.unseen?.length ?? 0) > 0
          ? { kind: 'live', picture: live, words: LIVE_UNSEEN }
          : { kind: 'live', picture: live };
      return live === null
        ? { kind: 'plain', colour: BLACK, words: NO_LIVE }
        : { kind: 'plain', colour: BLACK };
    case 'dark':
      return { kind: 'plain', colour: DARK };
    case 'light':
      return { kind: 'plain', colour: LIGHT };
  }
}

/** Whether the studio asks the main process for Live's stills. */
export const watchesLive = (backdrop: Backdrop): boolean => backdrop === 'live';

/** The backdrop the studio opens on: the one chosen last on this computer, else Wallpaper. */
export const rememberedBackdrop = (): Backdrop => readPersisted(BACKDROP_KEY, DEFAULT_BACKDROP, isBackdrop);

/** Remember the backdrop chosen, on this computer. */
export const rememberBackdrop = (backdrop: Backdrop): void => {
  writePersisted(BACKDROP_KEY, backdrop);
};
