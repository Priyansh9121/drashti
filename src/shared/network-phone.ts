import { z } from 'zod';
import { idSchema } from './model-schema';
import { pictureLookSchema } from './picture-look';
import { quickPinsSchema } from './quick-bar';
import { WHEN_ENDS } from './wallpapers';
import { wallpaperNameSchema } from './wallpapers';

/*
 * The phone (Session 55, Part 9): what Parts 4–8 gave the operator window that a phone can do too, each a request of
 * its own (docs/api.md), checked in the main process as every phone request is (access, the device, Simple Mode's
 * tables in main/simple-mode-phones.ts) and done by the very functions the window's own requests call:
 * - the wallpapers (Part 6): read, one chosen, renamed, deleted and put back (Undo);
 * - the quick bar (Part 8): its pins read, and pinned, unpinned and moved (the whole bar, as the window sends it);
 * - a picture's look (Part 5's Picture editor): read, and kept;
 * - Rename… of a picture, video, sound or presentation, as the one right-click menu's;
 * - a video row's When it ends (Part 6).
 * And Simple Mode as a phone is told of it with the hall (GET /api/v1/hall `simple`), so it shows only what Simple Mode
 * allows and opens Simple Mode's playlist.
 */

/** A wallpaper as a phone lists it: its pictures by id (drawn as small previews), and whether it goes round. */
export interface RemoteWallpaper {
  id: string;
  name: string;
  pictures: { mediaId: string; name: string; missing: boolean }[];
}

/** The wallpapers as a phone reads them, and which is chosen (null: none, black). */
export interface RemoteWallpapers {
  wallpapers: RemoteWallpaper[];
  chosenId: string | null;
}

/**
 * Simple Mode on Drashti's computer, as the hall tells a phone (null in Pro Mode): its one playlist (null before it
 * has one), and the words a phone shows once for what it dims or hides (shared/mode.ts simplePhoneRefusalText: true for
 * this computer's access, naming that playlist).
 */
export interface RemoteSimple {
  playlistId: string | null;
  words: string;
}

/** A name a phone gives (a file's, a presentation's, a wallpaper's), as the window's Rename… takes it. */
const phoneName = z.string().trim().min(1).max(200);

/** What each of the phone's own requests may carry, and nothing else (the route puts the id from its path in). */
export const PHONE_ARGS = {
  wallpaperChoose: z.object({ wallpaperId: idSchema.nullable() }).strict(),
  wallpaperRename: z.object({ wallpaperId: idSchema, name: wallpaperNameSchema }).strict(),
  wallpaperRef: z.object({ wallpaperId: idSchema }).strict(),
  quickBarSet: z.object({ pins: quickPinsSchema }).strict(),
  mediaRef: z.object({ mediaId: idSchema }).strict(),
  mediaLook: z.object({ mediaId: idSchema, look: pictureLookSchema.nullable() }).strict(),
  mediaRename: z.object({ mediaId: idSchema, name: phoneName }).strict(),
  presentationRename: z.object({ presentationId: idSchema, name: phoneName }).strict(),
  whenEnds: z.object({ itemId: idSchema, whenEnds: z.enum(WHEN_ENDS) }).strict(),
} as const;
