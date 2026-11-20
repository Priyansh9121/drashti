import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';

/*
 * Whether a file is whole (Q60-31 (m2), the owner's own bug: his video came from a Dropbox folder dropped on Drashti).
 * A video still being copied into a folder Drashti follows, its copy stalling longer than the folder's wait for its
 * size to hold still, was taken half-written: its movie box, at its end as an editor exports it, not there yet, so its
 * row went black (x46's hunt, CI x46-1120-112649-63694). A file's own bytes say where it ends, for every kind the
 * import takes that has such a mark (the lead's "as few cannot tell as the formats allow"):
 *
 * - MP4, MOV, M4A, 3GP, HEIC, AVIF (ISO base media; a QuickTime movie with no ftyp too): every top-level box within
 *   the file, and its movie box (moov) among them, or, for a picture by its brands, its meta box;
 * - WAV, AVI, WebP (RIFF) and AIFF (FORM): their size; Matroska and WebM: their Segment's size;
 * - JPEG: its end marker after its picture data; PNG: its IEND chunk; GIF: its trailer, walking its blocks; BMP: its
 *   size; JPEG 2000: its boxes, and its codestream's end marker;
 * - PDF: startxref and %%EOF at its end; zip-based decks and documents (.pptx, .key, .docx): the end-of-central-directory
 *   record;
 * - MP3 with a Xing, Info or VBRI header: its byte count; Ogg (Vorbis, Opus, Theora): its last page marked as the end;
 *   WMA and WMV (ASF): the file size its header gives;
 * - an MPEG transport stream (AVCHD .mts, .m2ts, .ts): cut when it ends part-way through a packet.
 *
 * One that says it is longer than its bytes (or a movie with no movie box yet, an Ogg file whose last page is not its
 * end) is cut: the folders wait for it as for a file whose size has not held still (playlists/smart-folders.ts,
 * import/drop-folder.ts). What has no such mark cannot be told, and is taken by its size holding still alone, as
 * before: an MPEG program stream (.mpg, .vob), a transport stream of whole packets, an MP3 with no Xing header, a raw
 * AAC, AC-3 or DTS sound, FLAC, and the rarer kinds (TIFF, PSD, Targa, ICO, FLV, MXF, DV, CAF, AU, AMR, APE, WavPack,
 * RealMedia, a .ppt). Only what decides is read: box and chunk headers, a file's last bytes; a whole JPEG or GIF of up
 * to 64 MB.
 */

/** whole: its own bytes say it is all there; cut: they say it is longer than its bytes; unknown: they cannot tell. */
export type Wholeness = 'whole' | 'cut' | 'unknown';

/**
 * How long a file may stay cut, its size and time unchanged, before the folders say its copy may have stopped or it is
 * damaged (it is still never taken by itself).
 */
export const UNFINISHED_MS = 2 * 60_000;

/** A file found cut: its size and time then, and since when it has been cut as it is. */
export interface CutSeen {
  size: number;
  mtimeMs: number;
  since: number;
}

/**
 * Whether a file is whole now, remembering those found cut (by their key in `cut`): one found cut is not read again
 * until its size or time changes, as a copy that stopped, or a damaged file, would be read at every look. `stalledMs`:
 * how long it has been cut as it is.
 */
export async function wholeNow(
  cut: Map<string, CutSeen>,
  key: string,
  path: string,
  found: { size: number; mtimeMs: number },
  now: number,
): Promise<{ wholeness: Wholeness; stalledMs: number }> {
  const seen = cut.get(key);
  if (seen?.size === found.size && seen.mtimeMs === found.mtimeMs)
    return { wholeness: 'cut', stalledMs: now - seen.since };
  const wholeness = await wholeFile(path);
  if (wholeness === 'cut') cut.set(key, { size: found.size, mtimeMs: found.mtimeMs, since: now });
  else cut.delete(key);
  return { wholeness, stalledMs: 0 };
}

/** More top-level boxes or chunks than a real file has: not told (a strange file, read no further). */
const MAX_PARTS = 100_000;
/** A JPEG or GIF read whole to find its end: larger ones are not told. */
const MAX_READ = 64 * 1024 * 1024;
/** How much of a file's end is read for its end mark (a PDF's trailer, a zip's directory record, an Ogg page). */
const TAIL = 66 * 1024;

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(Math.max(0, length));
  const { bytesRead } = await fh.read(buf, 0, buf.length, Math.max(0, position));
  return buf.subarray(0, bytesRead);
}

const EOI = Buffer.from([0xff, 0xd9]);

/** QuickTime's top-level box types a movie may start with, ftyp or not (an old .mov has none). */
const QUICKTIME_FIRST = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

/**
 * An ISO base media file (MP4, MOV, M4A, HEIC, AVIF, JPEG 2000): every top-level box within the file, and one it
 * needs among them (a movie's moov, a picture's meta, a JPEG 2000's codestream). A last box running to the file's end
 * (its size 0) says nothing of where that is: `toTheEnd` judges it.
 */
async function boxesWhole(
  fh: FileHandle,
  size: number,
  needs: ReadonlySet<string>,
  toTheEnd: (found: boolean) => Promise<Wholeness>,
): Promise<Wholeness> {
  let at = 0;
  let found = false;
  for (let parts = 0; at < size; parts++) {
    if (parts > MAX_PARTS) return 'unknown';
    // A few stray bytes after the last box (a camera's) are no box: what came before decides.
    if (size - at < 8) break;
    const head = await readAt(fh, at, 16);
    let length = head.readUInt32BE(0);
    if (needs.has(head.toString('latin1', 4, 8))) found = true;
    if (length === 0) return await toTheEnd(found);
    let header = 8;
    if (length === 1) {
      if (head.length < 16) return 'cut';
      length = Number(head.readBigUInt64BE(8));
      header = 16;
    }
    if (length < header) return 'cut';
    if (at + length > size) return 'cut';
    at += length;
  }
  return found ? 'whole' : 'cut';
}

const MOVIE = new Set(['moov']);
/** A HEIF or AVIF picture (a still's meta box) or picture sequence (a movie box), by its ftyp's brands. */
const PICTURE_BRANDS = new Set([
  'mif1',
  'msf1',
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'avif',
  'avis',
]);
const PICTURE = new Set(['moov', 'meta']);
const CODESTREAM = new Set(['jp2c']);

/** An ISO file's brands, from the ftyp box at its start (none for a QuickTime movie without one). */
function brands(head: Buffer): string[] {
  if (head.toString('latin1', 4, 8) !== 'ftyp') return [];
  const end = Math.min(head.readUInt32BE(0), head.length);
  const found = [head.toString('latin1', 8, 12)];
  for (let at = 16; at + 4 <= end; at += 4) found.push(head.toString('latin1', at, at + 4));
  return found;
}

/** A JPEG 2000 codestream's last two bytes: its end marker. */
async function endsWithEoi(fh: FileHandle, size: number): Promise<Wholeness> {
  return (await readAt(fh, size - 2, 2)).equals(EOI) ? 'whole' : 'cut';
}

/** A FORM (AIFF) chunk's size within the file; 0 or all ones (a recorder stopped dead) cannot tell. */
function sizedWhole(declared: number, size: number): Wholeness {
  if (declared === 0 || declared === 0xffffffff) return 'unknown';
  // The chunk's size leaves out its 8-byte header; an odd size is padded by one byte, which a writer may leave off.
  return 8 + declared <= size + 1 ? 'whole' : 'cut';
}

/**
 * A RIFF file (WAV, AVI, WebP): its RIFF chunks within the file, one after another (an AVI past 1 GB has more than
 * one); 0 or all ones (a recorder stopped dead) cannot tell.
 */
async function riffWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  let at = 0;
  for (let parts = 0; at + 8 <= size; parts++) {
    if (parts > MAX_PARTS) return 'unknown';
    const head = await readAt(fh, at, 8);
    // After its last RIFF chunk: what follows (a tag a program added) is not its own.
    if (head.toString('latin1', 0, 4) !== 'RIFF') break;
    const declared = head.readUInt32LE(4);
    if (declared === 0 || declared === 0xffffffff) return 'unknown';
    if (at + 8 + declared > size) return 'cut';
    at += 8 + declared + (declared % 2);
  }
  return 'whole';
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

/** A JPEG: whole once its end-of-image marker follows its first scan's picture data (bytes after it allowed). */
async function jpegWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  if (size > MAX_READ) return 'unknown';
  const b = await readAt(fh, 0, size);
  let at = 2;
  for (let parts = 0; at + 4 <= b.length; parts++) {
    if (parts > MAX_PARTS || b[at] !== 0xff) return 'unknown';
    const marker = b[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill bytes
      continue;
    }
    if (marker === 0xd9) return 'whole';
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = b.readUInt16BE(at + 2);
    if (marker === 0xda) return b.indexOf(EOI, at + 2 + length) >= 0 ? 'whole' : 'cut';
    at += 2 + length;
  }
  return 'cut';
}

/** A PNG: its chunks within the file, up to its IEND. */
async function pngWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  let at = 8;
  for (let parts = 0; at + 12 <= size; parts++) {
    if (parts > MAX_PARTS) return 'unknown';
    const head = await readAt(fh, at, 8);
    const length = head.readUInt32BE(0);
    const end = at + 12 + length;
    if (end > size) return 'cut';
    if (head.toString('latin1', 4, 8) === 'IEND') return 'whole';
    at = end;
  }
  return 'cut';
}

/** A GIF: its blocks walked to its trailer (0x3B). */
async function gifWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  if (size > MAX_READ) return 'unknown';
  const b = await readAt(fh, 0, size);
  if (b.length < 13) return 'cut';
  const table = (flags: number) => ((flags & 0x80) !== 0 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
  let at = 13 + table(b[10] ?? 0);
  const subBlocks = (): boolean => {
    for (;;) {
      const n = b[at];
      if (n === undefined) return false;
      at += 1 + n;
      if (n === 0) return true;
      if (at > b.length) return false;
    }
  };
  for (let parts = 0; parts < MAX_PARTS; parts++) {
    const kind = b[at];
    if (kind === undefined) return 'cut';
    if (kind === 0x3b) return 'whole';
    if (kind === 0x21) {
      at += 2; // its label
      if (!subBlocks()) return 'cut';
    } else if (kind === 0x2c) {
      const flags = b[at + 9];
      if (flags === undefined) return 'cut';
      at += 10 + table(flags) + 1; // the descriptor, its colour table, its LZW minimum code size
      if (!subBlocks()) return 'cut';
    } else return 'unknown';
  }
  return 'unknown';
}

/** A BMP: the size its header gives (0, an old writer's, cannot tell). */
function bmpWhole(declared: number, size: number): Wholeness {
  if (declared === 0) return 'unknown';
  return declared <= size ? 'whole' : 'cut';
}

/** A PDF: startxref, then %%EOF, in its last bytes. */
async function pdfWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const tail = (await readAt(fh, size - 2048, 2048)).toString('latin1');
  const eof = tail.lastIndexOf('%%EOF');
  return eof >= 0 && tail.lastIndexOf('startxref', eof) >= 0 ? 'whole' : 'cut';
}

/** A zip (.pptx, .key, .docx): its end-of-central-directory record, ending the file with its comment. */
async function zipWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const from = Math.max(0, size - TAIL);
  const tail = await readAt(fh, from, size - from);
  const record = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  for (let at = tail.lastIndexOf(record); at >= 0; at = at > 0 ? tail.lastIndexOf(record, at - 1) : -1) {
    if (at + 22 <= tail.length && at + 22 + tail.readUInt16LE(at + 20) === tail.length) return 'whole';
  }
  return 'cut';
}

/** An MP3: after its ID3v2 tag, a first frame holding a Xing, Info or VBRI header with its byte count; else not told. */
async function mp3Whole(fh: FileHandle, size: number): Promise<Wholeness> {
  const head = await readAt(fh, 0, 10);
  let start = 0;
  if (head.toString('latin1', 0, 3) === 'ID3' && head.length === 10) {
    const syncsafe = (i: number) => (head[i] ?? 0) & 0x7f;
    const tag = (syncsafe(6) << 21) | (syncsafe(7) << 14) | (syncsafe(8) << 7) | syncsafe(9);
    start = 10 + tag + (((head[5] ?? 0) & 0x10) !== 0 ? 10 : 0);
  }
  // Its tag runs past its bytes: cut part-way through it.
  if (start + 4 > size) return 'cut';
  const f = await readAt(fh, start, 200);
  if (f.length < 4 || f[0] !== 0xff || ((f[1] ?? 0) & 0xe0) !== 0xe0) return 'unknown';
  const mpeg1 = (((f[1] ?? 0) >> 3) & 0x03) === 3;
  const mono = (((f[3] ?? 0) >> 6) & 0x03) === 3;
  const xing = 4 + (mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17);
  let bytes: number | null = null;
  const tag = f.toString('latin1', xing, xing + 4);
  if ((tag === 'Xing' || tag === 'Info') && f.length >= xing + 16) {
    const flags = f.readUInt32BE(xing + 4);
    if ((flags & 0x02) !== 0) bytes = f.readUInt32BE(xing + 8 + ((flags & 0x01) !== 0 ? 4 : 0));
  } else if (f.toString('latin1', 36, 40) === 'VBRI' && f.length >= 50) bytes = f.readUInt32BE(46);
  if (bytes === null || bytes === 0) return 'unknown';
  return start + bytes <= size ? 'whole' : 'cut';
}

/**
 * An Ogg file (Vorbis, Opus, Theora): its last page ending where the file does, and marked as the end of its stream.
 * Pages are looked for from the end, so the four letters of a page's start inside another page's data do not mislead.
 */
async function oggWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const from = Math.max(0, size - TAIL);
  const tail = await readAt(fh, from, size - from);
  const capture = Buffer.from('OggS', 'latin1');
  for (let at = tail.lastIndexOf(capture); at >= 0; at = at > 0 ? tail.lastIndexOf(capture, at - 1) : -1) {
    if (tail[at + 4] !== 0 || at + 27 > tail.length) continue;
    const segments = tail[at + 26] ?? 0;
    let end = at + 27 + segments;
    if (end > tail.length) continue;
    for (let i = 0; i < segments; i++) end += tail[at + 27 + i] ?? 0;
    if (end === tail.length) return ((tail[at + 5] ?? 0) & 0x04) !== 0 ? 'whole' : 'cut';
  }
  return 'cut';
}

const ASF_HEADER = Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex');
const ASF_FILE_PROPERTIES = Buffer.from('a1dcab8c47a9cf118ee400c00c205365', 'hex');

/** A WMA or WMV (ASF): the file size its File Properties object gives (0, a broadcast's, cannot tell). */
async function asfWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const head = await readAt(fh, 0, 30);
  const headerSize = Number(head.readBigUInt64LE(16));
  const objects = await readAt(fh, 30, Math.min(headerSize, 256 * 1024) - 30);
  let at = 0;
  for (let parts = 0; at + 24 <= objects.length && parts < MAX_PARTS; parts++) {
    const length = Number(objects.readBigUInt64LE(at + 16));
    if (length < 24) return 'unknown';
    if (objects.subarray(at, at + 16).equals(ASF_FILE_PROPERTIES)) {
      if (at + 48 > objects.length) return 'cut';
      const declared = Number(objects.readBigUInt64LE(at + 40));
      if (declared === 0) return 'unknown';
      return declared <= size ? 'whole' : 'cut';
    }
    at += length;
  }
  return headerSize > size ? 'cut' : 'unknown';
}

/** Whether the file at `path` is whole, by its own bytes. */
export async function wholeFile(path: string): Promise<Wholeness> {
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, 'r');
    const size = (await fh.stat()).size;
    const head = await readAt(fh, 0, 256);
    if (head.length < 12) return 'unknown';
    const ascii = (from: number, to: number) => head.toString('latin1', from, to);
    if (QUICKTIME_FIRST.has(ascii(4, 8)))
      return await boxesWhole(
        fh,
        size,
        brands(head).some((b) => PICTURE_BRANDS.has(b)) ? PICTURE : MOVIE,
        (found) => Promise.resolve(found ? 'whole' : 'cut'),
      );
    if (ascii(0, 4) === 'RIFF') return await riffWhole(fh, size);
    if (ascii(0, 4) === 'FORM') return sizedWhole(head.readUInt32BE(4), size);
    if (head.readUInt32BE(0) === 0x1a45dfa3) return matroskaWhole(head, size);
    if (head[0] === 0xff && head[1] === 0xd8) return await jpegWhole(fh, size);
    if (head.readUInt32BE(0) === 0x89504e47) return await pngWhole(fh, size);
    if (ascii(0, 4) === 'GIF8') return await gifWhole(fh, size);
    if (ascii(0, 2) === 'BM') return bmpWhole(head.readUInt32LE(2), size);
    if (ascii(0, 5) === '%PDF-') return await pdfWhole(fh, size);
    if (ascii(0, 4) === 'PK\x03\x04') return await zipWhole(fh, size);
    if (ascii(0, 4) === 'OggS') return await oggWhole(fh, size);
    if (head.subarray(0, 16).equals(ASF_HEADER)) return await asfWhole(fh, size);
    // JPEG 2000: its boxes (a signature box first) with its codestream among them; or a bare codestream. Either
    // codestream ends with its end marker.
    if (ascii(4, 8) === 'jP  ') {
      const jp2 = fh;
      return await boxesWhole(jp2, size, CODESTREAM, (found) =>
        found ? endsWithEoi(jp2, size) : Promise.resolve('cut'),
      );
    }
    if (head.readUInt32BE(0) === 0xff4fff51) return await endsWithEoi(fh, size);
    // An MPEG transport stream (a camcorder's AVCHD .mts, a .m2ts, a TV recording's .ts): no size nor end mark, but
    // whole packets of 188 bytes (192 in an M2TS, each with its time first). One ending part-way through a packet is
    // cut; one of whole packets cannot tell.
    if (head[0] === 0x47 && head[188] === 0x47) return size % 188 === 0 ? 'unknown' : 'cut';
    if (head[4] === 0x47 && head[196] === 0x47) return size % 192 === 0 ? 'unknown' : 'cut';
    if (ascii(0, 3) === 'ID3' || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0))
      return await mp3Whole(fh, size);
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    await fh?.close();
  }
}
