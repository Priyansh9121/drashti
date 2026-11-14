import { z } from 'zod';
import type { Quote } from './idle';
import { NAME_MAX } from './media-removal';
import { idSchema } from './model-schema';
import { cleanNameSchema } from './rename-name';
import { cutText } from './text';

/*
 * Wallpapers (Session 55, Part 6): pictures in the Playlists panel itself, under the playlists, just above the bar of
 * clears, added by dragging them in from the Finder or Explorer or with Import… (pictures only, of any type Drashti
 * takes; anything else is refused with the reason), as many as wanted. One is chosen, and stays chosen after a
 * restart. The chosen one shows on the audience screens whenever nothing is up there (at the start, on a screen just
 * plugged in, after Clear all, and when a video ends), and under the Wallpaper button (F12, Part 13) over what is up;
 * with none chosen, black. A wallpaper can be several pictures in turn, each up for its seconds, fading into the next,
 * in step on every screen (worked out from the engine's clock, as a video is). The idle rotation's pictures and its
 * quotes (each drawn as a picture) became one such wallpaper when it went (Part 12).
 *
 * When a video ends (Part 6, A), its playlist row says what happens: the chosen wallpaper (the default; with none
 * chosen its last picture stays, as before), the next row, the video again (Loop), or its last picture (Freeze). In a
 * video's last 10 seconds (E) its row and the time under LIVE turn amber, and the stage screens show the time left.
 */

/** Each picture of a wallpaper that goes round is up this long (seconds), its fade included. */
export const WALLPAPER_SECONDS_MIN = 3;
export const WALLPAPER_SECONDS_MAX = 600;
export const WALLPAPER_SECONDS_DEFAULT = 10;
/** The fade from one picture into the next (ms), at most half a picture's time. */
export const WALLPAPER_FADE_MAX_MS = 5000;
export const WALLPAPER_FADE_DEFAULT_MS = 1500;
/** Pictures in one wallpaper. */
export const WALLPAPER_PICTURES_MAX = 200;

/** One of a wallpaper's pictures, as the library has it. */
export interface WallpaperPicture {
  mediaId: string;
  /** Its name in the library. */
  name: string;
  /** Gone from the library, or its file missing: left out on the screens. */
  missing: boolean;
}

/** A wallpaper: one picture, or several in turn. */
export interface Wallpaper {
  id: string;
  name: string;
  pictures: WallpaperPicture[];
  secondsEach: number;
  fadeMs: number;
}

/** The wallpapers, for the operator window. */
export interface WallpapersView {
  wallpapers: Wallpaper[];
  /** The chosen one, or null: none (black). */
  chosenId: string | null;
  /**
   * The idle rotation's quotes still to be drawn as pictures into its wallpaper (`into`), by the operator window,
   * which has the fonts (wallpapers/quote-pictures.ts); null when there are none.
   */
  quotesToDraw: { into: string; quotes: Quote[] } | null;
}

export type WallpaperResult = { ok: true; ids: string[] } | { ok: false; message: string };

/** Files offered as wallpapers, sorted: the pictures, and the rest with why each is not one. */
export interface WallpaperFiles {
  pictures: string[];
  refused: { name: string; why: string }[];
}

/**
 * The chosen wallpaper as the engine carries it to every screen, node and phone (engine state 18): its pictures in
 * order (those still in the library), and how they go round. Only the main process sets it.
 */
export interface ChosenWallpaper {
  id: string;
  name: string;
  pictures: string[];
  secondsEach: number;
  fadeMs: number;
  /** When it was chosen or changed, by the engine's clock: its pictures go round from then, alike everywhere. */
  since: number;
}

/**
 * Where a wallpaper is at `now` (the engine's time): the picture up, and the one after it with how far it has faded
 * in (0 to 1; 0 outside the fade). Null with no picture to show.
 */
export function wallpaperFrame(
  wallpaper: Pick<ChosenWallpaper, 'pictures' | 'secondsEach' | 'fadeMs' | 'since'>,
  now: number,
): { index: number; next: number; fade: number } | null {
  const count = wallpaper.pictures.length;
  if (count === 0) return null;
  if (count === 1) return { index: 0, next: 0, fade: 0 };
  const each = Math.max(1, wallpaper.secondsEach) * 1000;
  const elapsed = Math.max(0, now - wallpaper.since);
  const step = Math.floor(elapsed / each);
  const index = step % count;
  const into = elapsed - step * each;
  const fadeMs = Math.min(Math.max(0, wallpaper.fadeMs), each / 2);
  const fade = fadeMs > 0 && into > each - fadeMs ? (into - (each - fadeMs)) / fadeMs : 0;
  return { index, next: (index + 1) % count, fade: Math.min(1, Math.max(0, fade)) };
}

/** When the wallpaper next changes picture after `now` (the engine's time), or null when it never does. */
export function nextWallpaperChange(
  wallpaper: Pick<ChosenWallpaper, 'pictures' | 'secondsEach' | 'fadeMs' | 'since'>,
  now: number,
): number | null {
  if (wallpaper.pictures.length < 2) return null;
  const each = Math.max(1, wallpaper.secondsEach) * 1000;
  const fadeMs = Math.min(Math.max(0, wallpaper.fadeMs), each / 2);
  const elapsed = Math.max(0, now - wallpaper.since);
  const step = Math.floor(elapsed / each);
  const fadeStarts = wallpaper.since + step * each + (each - fadeMs);
  return fadeStarts > now ? fadeStarts : wallpaper.since + (step + 1) * each;
}

/** A wallpaper's name from its picture's file name: without the folder and its last extension. */
export function wallpaperNameOf(fileName: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? fileName;
  // Its last extension off (a name that is only an extension, ".hidden", stays as it is).
  const name = base.replace(/(?<=.)\.[^.]*$/u, '').trim();
  return cutText(name === '' ? base : name, NAME_MAX);
}

/**
 * What the operator window says of files refused as wallpapers (`refused`, each with why), in one notice: one file, or
 * several (each with why), then that wallpapers are pictures only.
 */
export function refusedWords(refused: readonly { name: string; why: string }[]): string | null {
  const [first] = refused;
  if (!first) return null;
  if (refused.length === 1)
    return `“${first.name}” ${first.why}, so it was not added. Wallpapers are pictures only.`;
  const each = refused.map((r) => `“${r.name}” ${r.why}`);
  const listed =
    each.length === 2
      ? `${each[0] ?? ''} and ${each[1] ?? ''}`
      : `${each.slice(0, -1).join(', ')}, and ${each.at(-1) ?? ''}`;
  return `${String(refused.length)} files were not added: ${listed}. Wallpapers are pictures only.`;
}

// ---- When a video ends (Part 6, A) ------------------------------------------------------------------------------

/** What happens when a playlist row's video ends: the chosen wallpaper (the default), the next row, again, or held. */
export type WhenEnds = 'wallpaper' | 'next' | 'loop' | 'freeze';
export const WHEN_ENDS = ['wallpaper', 'next', 'loop', 'freeze'] as const satisfies readonly WhenEnds[];
export const WHEN_ENDS_NAMES: Record<WhenEnds, string> = {
  wallpaper: 'Wallpaper',
  next: 'Next item',
  loop: 'Loop',
  freeze: 'Freeze',
};
/** As a row keeps it: left out, the default. */
export const DEFAULT_WHEN_ENDS: WhenEnds = 'wallpaper';
export const whenEndsSchema = z.enum(WHEN_ENDS);

/** A video's last seconds (Part 6, E): its row and the time under LIVE turn amber, and the stage shows the time left. */
export const LAST_SECONDS_MS = 10_000;

/** Whether a video with `leftMs` to go is in its last seconds (not ended, not unknown). */
export function inLastSeconds(leftMs: number | null | undefined): boolean {
  return leftMs !== null && leftMs !== undefined && leftMs > 0 && leftMs <= LAST_SECONDS_MS;
}

// ---- what the operator window may ask ---------------------------------------------------------------------------

export const wallpaperIdSchema = idSchema;
/** Cleaned as Rename… cleans a file's name (Session 58, X3), on the computer and a phone alike. */
export const wallpaperNameSchema = cleanNameSchema(NAME_MAX);
export const wallpaperPicturesSchema = z.array(idSchema).min(1).max(WALLPAPER_PICTURES_MAX);
export const wallpaperTimingSchema = z
  .object({
    secondsEach: z.number().int().min(WALLPAPER_SECONDS_MIN).max(WALLPAPER_SECONDS_MAX),
    fadeMs: z.number().int().min(0).max(WALLPAPER_FADE_MAX_MS),
  })
  .strict();
/** Paths offered as wallpapers (a drop, or the Import… dialog's). */
export const wallpaperPathsSchema = z.array(z.string().min(1).max(4096)).min(1).max(1000);
/** A quote drawn as a picture (PNG bytes), for the idle rotation's wallpaper. */
export const quotePictureSchema = z
  .instanceof(Uint8Array)
  .refine((b) => b.byteLength > 0 && b.byteLength <= 20e6);
