import type { PictureLook } from '../../../../shared/picture-look';
import type { StudioLivePicture } from '../../../../shared/studio-live';
import type { ChosenWallpaper } from '../../../../shared/wallpapers';

/*
 * What is behind the Lower Thirds studio's preview (Session 55, Part 16): Dark, Light or Picture.
 */

export type Backdrop = 'dark' | 'light' | 'picture';
export const BACKDROPS: readonly Backdrop[] = ['dark', 'light', 'picture'];
export const BACKDROP_NAMES: Record<string, string> = { dark: 'Dark', light: 'Light', picture: 'Picture' };
export const DEFAULT_BACKDROP: Backdrop = 'picture';
export const BACKDROP_KEY = 'lower-third-studio-backdrop';
export const NO_WALLPAPER = 'No wallpaper chosen';
export const NO_LIVE = 'No live picture to show';

export const isBackdrop = (v: unknown): v is Backdrop =>
  typeof v === 'string' && (BACKDROPS as readonly string[]).includes(v);

/** What the preview draws behind the lower third. */
export type BackdropDraw =
  | { kind: 'wallpaper'; wallpaper: ChosenWallpaper; pictures: Record<string, PictureLook> }
  | { kind: 'live'; picture: StudioLivePicture }
  | { kind: 'plain'; colour: string; words?: string };

const COLOURS: Record<Backdrop, string> = {
  dark: '#1f2937',
  light: '#e5e7eb',
  picture: 'linear-gradient(160deg, #1e3a5f 0%, #6b4f2a 55%, #c2410c 100%)',
};

/** The template tiles' own backdrop. */
export const TILE_BACKDROP: BackdropDraw = { kind: 'plain', colour: COLOURS.picture };

export function backdropDraw(
  backdrop: string,
  _hall: { wallpaper: ChosenWallpaper | null | undefined; pictures: Record<string, PictureLook> },
  _live: StudioLivePicture | null | undefined,
): BackdropDraw {
  return { kind: 'plain', colour: isBackdrop(backdrop) ? COLOURS[backdrop] : COLOURS.picture };
}

/** Whether the studio asks the main process for the live picture. */
export const watchesLive = (_backdrop: string): boolean => false;

/** The backdrop the studio opens on. */
export const rememberedBackdrop = (): Backdrop => DEFAULT_BACKDROP;

/** Remember the backdrop chosen. */
export const rememberBackdrop = (_backdrop: string): void => undefined;
