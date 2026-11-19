import { open } from 'node:fs/promises';

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

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG's colour types with no alpha channel: grey, colour, a palette. */
const NO_ALPHA = new Set([0, 2, 3]);
/** The chunks read before a PNG's picture data at most: past them, not known. */
const MAX_CHUNKS = 64;

const startsWith = (bytes: Uint8Array, head: readonly number[]) =>
  bytes.length >= head.length && head.every((b, i) => bytes[i] === b);

/** The walk through the file: it asks for bytes ([where, how many]) and is given them, then says. */
function* walk(): Generator<[number, number], boolean, Uint8Array | null> {
  const head = yield [0, PNG.length];
  if (!head) return false;
  if (startsWith(head, JPEG)) return true;
  if (!startsWith(head, PNG)) return false;
  let at = PNG.length;
  let colour = -1;
  for (let n = 0; n < MAX_CHUNKS; n++) {
    // Each chunk: its data's length (4 bytes, big-endian), its type (4), its data, a CRC (4).
    const chunk = yield [at, 8];
    if (!chunk || chunk.length < 8) return false;
    const byte = (i: number) => chunk[i] ?? 0;
    const length = ((byte(0) << 24) | (byte(1) << 16) | (byte(2) << 8) | byte(3)) >>> 0;
    const type = String.fromCharCode(byte(4), byte(5), byte(6), byte(7));
    if (n === 0) {
      // The header comes first: width, height, bit depth, then the colour type.
      if (type !== 'IHDR' || length < 13) return false;
      const header = yield [at + 8, 13];
      if (!header || header.length < 13) return false;
      colour = header[9] ?? -1;
    } else if (type === 'tRNS' || type === 'acTL') {
      // A transparent colour, or frames of its own (an animated PNG may clear one to transparent black).
      return false;
    } else if (type === 'IDAT') {
      return NO_ALPHA.has(colour);
    }
    at += 12 + length;
  }
  return false;
}

/** Whether the file `read` gives can draw no see-through pixel (see above). */
export function cannotSeeThrough(read: ReadBytes): boolean {
  const steps = walk();
  let step = steps.next();
  while (!step.done) step = steps.next(read(...step.value));
  return step.value;
}

/** The same for a file on disk: a few small reads at its start, each awaited (never on the main thread's way). */
export async function pictureCannotSeeThrough(path: string): Promise<boolean> {
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    file = await open(path, 'r');
    const steps = walk();
    let step = steps.next();
    while (!step.done) {
      const [at, length] = step.value;
      const buf = Buffer.alloc(length);
      const { bytesRead } = await file.read(buf, 0, length, at);
      step = steps.next(bytesRead > 0 ? buf.subarray(0, bytesRead) : null);
    }
    return step.value;
  } catch {
    return false;
  } finally {
    await file?.close().catch(() => undefined);
  }
}
