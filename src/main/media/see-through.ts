/*
 * Whether a picture can draw no see-through pixel (X11), read from its file's first bytes, never decoded. Without a
 * graphics chip a deck's own move draws each moving slide on a layer of its own; a slide whose own full-slide picture
 * cannot be seen through is backed there, so the compositor draws nothing under it (render/slide-backing.ts). Only
 * what the format itself rules out counts: a JPEG has no transparency at all; a still PNG has none when its colour
 * type has no alpha (grey, colour or a palette) and no transparency chunk comes before its picture data. Anything else
 * is not known: a PNG with an alpha channel (even one whose every pixel is opaque), an animated PNG, GIF, WebP, HEIC,
 * a file that cannot be read.
 */

/** `length` bytes of the file from `at`, fewer at its end, or null past it (or when it cannot be read). */
export type ReadBytes = (at: number, length: number) => Uint8Array | null;

/** Whether the file `read` gives can draw no see-through pixel (see above). */
export function cannotSeeThrough(_read: ReadBytes): boolean {
  return false;
}

/** The same for a file on disk: a few small reads at its start, off the main thread's way. */
export async function pictureCannotSeeThrough(_path: string): Promise<boolean> {
  return Promise.resolve(false);
}
