/*
 * The names the drop window starts with (Session 60, x36; playlists/DropNewDialog.tsx): a dropped file's name from its
 * path, on a Mac or on Windows, and that name without its ending, for the new playlist.
 */

/** The last part of a path, on a Mac or Windows ("/Users/a/Placeholder clip.mp4" is "Placeholder clip.mp4"). */
export const fileName = (path: string): string => path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;

/** A name without its ending ("Placeholder clip.mp4" is "Placeholder clip"); a name with none, as it is. */
export function withoutEnding(name: string): string {
  // The last dot and what follows it, unless the name starts there (".hidden") or nothing follows it.
  return name.replace(/(?<=.)\.[^.]+$/u, '');
}
