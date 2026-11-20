import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';

/*
 * Whether a file is whole (Q60-31 (m2), the owner's own bug: his video came from a Dropbox folder dropped on Drashti).
 * A video still being copied into a folder Drashti follows, its copy stalling longer than the folder's wait for its
 * size to hold still, was taken half-written: its movie box, at its end as an editor exports it, not there yet, so its
 * row went black (x46's hunt, CI x46-1120-112649-63694). A file's own structure says how long it is: an MP4 or MOV's
 * boxes (ISO base media), a RIFF file's (WAV, AVI) RIFF size, a Matroska or WebM file's Segment size. One that says it
 * is longer than its bytes, or an MP4 with no movie box yet, is cut: the folders wait for it as for a file whose size
 * has not held still (playlists/smart-folders.ts, import/drop-folder.ts). Any other kind cannot be told, and is taken
 * by its size holding still alone, as before. Only the first bytes of each box are read.
 */

/** whole: its own structure says it is all there; cut: it says it is longer than its bytes; unknown: it cannot tell. */
export type Wholeness = 'whole' | 'cut' | 'unknown';

/** More top-level boxes than a real file has: not told (a strange file, read no further). */
const MAX_BOXES = 10_000;

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** An MP4 or MOV: every top-level box within the file, and a movie box among them. */
async function isoWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  let at = 0;
  let moov = false;
  for (let boxes = 0; at < size; boxes++) {
    if (boxes > MAX_BOXES) return 'unknown';
    // A few stray bytes after the last box (a camera's) are no box: what came before decides.
    if (size - at < 8) break;
    const head = await readAt(fh, at, 16);
    let length = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    let header = 8;
    if (length === 1) {
      if (head.length < 16) return 'cut';
      length = Number(head.readBigUInt64BE(8));
      header = 16;
    } else if (length === 0) length = size - at; // to the file's end, as its last box
    if (length < header) return 'cut';
    if (type === 'moov') moov = true;
    if (at + length > size) return 'cut';
    at += length;
  }
  return moov ? 'whole' : 'cut';
}

/** A RIFF file (WAV, AVI): its RIFF size within the file; 0 or all ones (a recorder stopped dead) cannot tell. */
function riffWhole(head: Buffer, size: number): Wholeness {
  const riff = head.readUInt32LE(4);
  if (riff === 0 || riff === 0xffffffff) return 'unknown';
  // The chunk's size leaves out its 8-byte header; an odd size is padded by one byte, which a writer may leave off.
  return 8 + riff <= size + 1 ? 'whole' : 'cut';
}

/** An EBML variable-size integer at `at`: its value, its length, and whether it says "unknown size". */
function vint(b: Buffer, at: number): { value: number; length: number; unknown: boolean } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (at + length > b.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = b[at + i] ?? 0;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

/** A Matroska or WebM file: its Segment's data within the file; an unknown size (a live recording's) cannot tell. */
function matroskaWhole(head: Buffer, size: number): Wholeness {
  // The EBML header element (4-byte ID), then the Segment (4-byte ID 18 53 80 67).
  const headerSize = vint(head, 4);
  if (!headerSize) return 'unknown';
  const segment = 4 + headerSize.length + headerSize.value;
  if (segment + 4 > head.length) return 'unknown';
  if (head.readUInt32BE(segment) !== 0x18538067) return 'unknown';
  const segmentSize = vint(head, segment + 4);
  if (!segmentSize || segmentSize.unknown) return 'unknown';
  return segment + 4 + segmentSize.length + segmentSize.value <= size ? 'whole' : 'cut';
}

/** Whether the file at `path` is whole, by its own structure. */
export async function wholeFile(path: string): Promise<Wholeness> {
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, 'r');
    const size = (await fh.stat()).size;
    const head = await readAt(fh, 0, 256);
    if (head.length < 12) return 'unknown';
    if (head.toString('latin1', 4, 8) === 'ftyp') return await isoWhole(fh, size);
    if (head.toString('latin1', 0, 4) === 'RIFF') return riffWhole(head, size);
    if (head.readUInt32BE(0) === 0x1a45dfa3) return matroskaWhole(head, size);
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    await fh?.close();
  }
}
