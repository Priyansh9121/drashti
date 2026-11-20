import type { FileHandle } from 'node:fs/promises';
import type { Wholeness } from './whole-file';

/*
 * The kinds whose own bytes tell they are whole only on a longer read (Q60-46 (2), the owner's answer A of 20 Nov 2026,
 * through the lead): import/whole-file.ts asks these by the file's first bytes (and, for a Targa or an icon, which say
 * no name of their own, by its extension). Each reads only what decides: a table, a section's length, the last frame
 * or block. Whole: its bytes say it is all there; cut: they say there is more to come; unknown: they cannot tell.
 */

/** More parts than a real file has: not told. */
const MAX_PARTS = 100_000;
/** A file read whole to find its end (a run-length Targa): larger ones are not told. */
const MAX_READ = 64 * 1024 * 1024;

export async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(Math.max(0, length));
  const { bytesRead } = await fh.read(buf, 0, buf.length, Math.max(0, position));
  return buf.subarray(0, bytesRead);
}

/**
 * Where a file's own data ends, before the tags a program may add after it (an ID3v1 tag's 128 bytes, an APEv2 tag):
 * a FLAC's or a WavPack's last frame or block ends there.
 */
async function endBeforeTags(fh: FileHandle, size: number): Promise<number> {
  let end = size;
  for (let tags = 0; tags < 3; tags++) {
    if (end >= 128 && (await readAt(fh, end - 128, 3)).toString('latin1') === 'TAG') {
      end -= 128;
      continue;
    }
    if (end >= 32) {
      const footer = await readAt(fh, end - 32, 32);
      if (footer.length === 32 && footer.toString('latin1', 0, 8) === 'APETAGEX') {
        const withHeader = (footer.readUInt32LE(20) & 0x80000000) !== 0;
        end -= footer.readUInt32LE(12) + (withHeader ? 32 : 0);
        continue;
      }
    }
    break;
  }
  return Math.max(0, end);
}

// ---- FLAC ----------------------------------------------------------------------------------------------------------

const CRC8 = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  return c;
});
const CRC16 = Array.from({ length: 256 }, (_, n) => {
  let c = n << 8;
  for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
  return c;
});
const crc8 = (b: Buffer, from: number, to: number): number => {
  let c = 0;
  for (let i = from; i < to; i++) c = CRC8[(c ^ (b[i] ?? 0)) & 0xff] ?? 0;
  return c;
};
const crc16 = (b: Buffer, from: number, to: number): number => {
  let c = 0;
  for (let i = from; i < to; i++) c = ((c << 8) ^ (CRC16[((c >> 8) ^ (b[i] ?? 0)) & 0xff] ?? 0)) & 0xffff;
  return c;
};

/** A FLAC frame's header at `at`, if one is there (its own CRC-8 checks): where its samples start, and how many. */
function flacFrame(
  b: Buffer,
  at: number,
  fixedBlock: number,
): { first: number; samples: number; headerLength: number } | null {
  const variable = ((b[at + 1] ?? 0) & 0x01) === 1;
  const sizeCode = (b[at + 2] ?? 0) >> 4;
  const rateCode = (b[at + 2] ?? 0) & 0x0f;
  if (sizeCode === 0 || rateCode === 15 || (b[at + 3] ?? 0) >> 4 >= 11 || ((b[at + 3] ?? 0) & 0x01) !== 0)
    return null;
  // Its number (frame or sample), coded as UTF-8 codes a character.
  let i = at + 4;
  const lead = b[i] ?? 0xff;
  let extra = 0;
  let number = lead;
  if (lead === 0xff) return null;
  if (lead >= 0xc0) {
    extra = lead === 0xfe ? 6 : lead >= 0xfc ? 5 : lead >= 0xf8 ? 4 : lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : 1;
    number = extra === 6 ? 0 : lead & (0x3f >> extra);
  } else if (lead >= 0x80) return null;
  for (let k = 1; k <= extra; k++) {
    const c = b[i + k] ?? 0;
    if ((c & 0xc0) !== 0x80) return null;
    number = number * 64 + (c & 0x3f);
  }
  i += 1 + extra;
  let samples: number;
  if (sizeCode === 1) samples = 192;
  else if (sizeCode <= 5) samples = 576 * 2 ** (sizeCode - 2);
  else if (sizeCode === 6) samples = (b[i++] ?? 0) + 1;
  else if (sizeCode === 7) {
    samples = (((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)) + 1;
    i += 2;
  } else samples = 256 * 2 ** (sizeCode - 8);
  if (rateCode === 12) i += 1;
  else if (rateCode === 13 || rateCode === 14) i += 2;
  if (i >= b.length || crc8(b, at, i) !== b[i]) return null;
  return { first: variable ? number : number * fixedBlock, samples, headerLength: i + 1 - at };
}

/**
 * A FLAC: its metadata blocks within the file, then its last frame, by its number, ending the samples its STREAMINFO
 * counts, whole by its own CRC-16. A stream that does not count its samples cannot tell.
 */
export async function flacWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  let at = 4;
  let total = 0;
  let fixedBlock = 0;
  let maxFrame = 0;
  for (let parts = 0, last = false; !last; parts++) {
    if (parts > MAX_PARTS) return 'unknown';
    const h = await readAt(fh, at, 4);
    if (h.length < 4) return 'cut';
    last = ((h[0] ?? 0) & 0x80) !== 0;
    const length = ((h[1] ?? 0) << 16) | ((h[2] ?? 0) << 8) | (h[3] ?? 0);
    if (((h[0] ?? 0) & 0x7f) === 0) {
      const info = await readAt(fh, at + 4, 34);
      if (info.length < 18) return 'cut';
      fixedBlock = info.readUInt16BE(2);
      maxFrame = ((info[7] ?? 0) << 16) | ((info[8] ?? 0) << 8) | (info[9] ?? 0);
      total = ((info[13] ?? 0) & 0x0f) * 2 ** 32 + info.readUInt32BE(14);
    }
    at += 4 + length;
    if (at > size) return 'cut';
  }
  if (total === 0) return 'unknown';
  const end = await endBeforeTags(fh, size);
  const reach = maxFrame > 0 ? maxFrame * 2 + 1024 : 1024 * 1024;
  const from = Math.max(at, end - reach);
  const tail = await readAt(fh, from, end - from);
  // From the end, the frame that ends the stream's samples and checks whole to the file's end (its CRC-16); four
  // letters of a frame's start inside another's data do not check. None: more is to come.
  for (let i = tail.length - 6; i >= 0; i--) {
    if (tail[i] !== 0xff || ((tail[i + 1] ?? 0) & 0xfe) !== 0xf8) continue;
    const frame = flacFrame(tail, i, fixedBlock);
    if (!frame || frame.first + frame.samples < total || tail.length - i < frame.headerLength + 2) continue;
    if (crc16(tail, i, tail.length - 2) === tail.readUInt16BE(tail.length - 2)) return 'whole';
  }
  return 'cut';
}

// ---- TIFF ----------------------------------------------------------------------------------------------------------

/** A TIFF field type's bytes for one value (BYTE, ASCII, SHORT, LONG, RATIONAL, ... DOUBLE, IFD). */
const TIFF_TYPE_BYTES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];

/** A TIFF: every directory, and every strip or tile and every value kept apart, within the file. */
export async function tiffWhole(fh: FileHandle, size: number, little: boolean): Promise<Wholeness> {
  const u16 = (b: Buffer, o: number) => (little ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b: Buffer, o: number) => (little ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const head = await readAt(fh, 0, 8);
  let ifd = u32(head, 4);
  let needed = 8;
  /** A field's values (SHORT or LONG), in its entry or where it points. */
  const values = async (entry: Buffer, o: number, type: number, count: number): Promise<number[] | null> => {
    const width = type === 3 ? 2 : type === 4 ? 4 : 0;
    if (width === 0 || count > 1_000_000) return null;
    const bytes = width * count;
    const where = bytes > 4 ? u32(entry, o + 8) : -1;
    const b = where >= 0 ? await readAt(fh, where, bytes) : entry.subarray(o + 8, o + 12);
    if (b.length < bytes) return null;
    return Array.from({ length: count }, (_, k) => (width === 2 ? u16(b, k * 2) : u32(b, k * 4)));
  };
  for (let pages = 0; ifd !== 0; pages++) {
    if (pages > 10_000) return 'unknown';
    if (ifd + 2 > size) return 'cut';
    const count = u16(await readAt(fh, ifd, 2), 0);
    const entries = await readAt(fh, ifd + 2, count * 12 + 4);
    if (entries.length < count * 12 + 4) return 'cut';
    needed = Math.max(needed, ifd + 2 + count * 12 + 4);
    let offsets: number[] | null = null;
    let lengths: number[] | null = null;
    for (let e = 0; e < count; e++) {
      const o = e * 12;
      const tag = u16(entries, o);
      const type = u16(entries, o + 2);
      const n = u32(entries, o + 4);
      const bytes = (TIFF_TYPE_BYTES[type] ?? 0) * n;
      if (bytes > 4) needed = Math.max(needed, u32(entries, o + 8) + bytes);
      if (tag === 273 || tag === 324) offsets = await values(entries, o, type, n);
      if (tag === 279 || tag === 325) lengths = await values(entries, o, type, n);
    }
    if (needed > size) return 'cut';
    if (offsets && lengths)
      for (let k = 0; k < offsets.length; k++)
        needed = Math.max(needed, (offsets[k] ?? 0) + (lengths[k] ?? 0));
    ifd = u32(entries, count * 12);
  }
  return needed <= size ? 'whole' : 'cut';
}

// ---- PSD -----------------------------------------------------------------------------------------------------------

/** A Photoshop file (PSD, or PSB past 2 GB): its sections' lengths, then its picture data, plain or run-length. */
export async function psdWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const h = await readAt(fh, 0, 26);
  if (h.length < 26) return 'cut';
  const version = h.readUInt16BE(4);
  if (version !== 1 && version !== 2) return 'unknown';
  const channels = h.readUInt16BE(12);
  const height = h.readUInt32BE(14);
  const width = h.readUInt32BE(18);
  const depth = h.readUInt16BE(22);
  let at = 26;
  // The colour mode data and the image resources: 4-byte lengths; the layers and masks: 4 (PSD) or 8 (PSB).
  for (const wide of [false, false, version === 2]) {
    const l = await readAt(fh, at, wide ? 8 : 4);
    if (l.length < (wide ? 8 : 4)) return 'cut';
    at += (wide ? 8 : 4) + (wide ? Number(l.readBigUInt64BE(0)) : l.readUInt32BE(0));
    if (at > size) return 'cut';
  }
  const c = await readAt(fh, at, 2);
  if (c.length < 2) return 'cut';
  at += 2;
  const rows = channels * height;
  if (c.readUInt16BE(0) === 0) at += rows * Math.ceil((width * depth) / 8);
  else if (c.readUInt16BE(0) === 1) {
    if (rows > 4_000_000) return 'unknown';
    const width2 = version === 1 ? 2 : 4;
    const table = await readAt(fh, at, rows * width2);
    if (table.length < rows * width2) return 'cut';
    at += rows * width2;
    for (let r = 0; r < rows; r++) at += width2 === 2 ? table.readUInt16BE(r * 2) : table.readUInt32BE(r * 4);
  } else return 'unknown'; // ZIP-compressed picture data gives no lengths
  return at <= size ? 'whole' : 'cut';
}

// ---- Targa and icons (no name of their own: by their extension) -----------------------------------------------------

/** A Targa: its header, then its picture data, plain or run-length (walked), within the file. */
export async function tgaWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const h = await readAt(fh, 0, 18);
  if (h.length < 18) return 'cut';
  const type = h[2] ?? 0;
  const mapType = h[1] ?? 0;
  const width = h.readUInt16LE(12);
  const height = h.readUInt16LE(14);
  const bits = h[16] ?? 0;
  if (![1, 2, 3, 9, 10, 11].includes(type) || mapType > 1 || width === 0 || height === 0) return 'unknown';
  if (![8, 15, 16, 24, 32].includes(bits)) return 'unknown';
  const pixel = Math.ceil(bits / 8);
  let at = 18 + (h[0] ?? 0) + (mapType === 1 ? h.readUInt16LE(5) * Math.ceil((h[7] ?? 0) / 8) : 0);
  const pixels = width * height;
  if (type <= 3) at += pixels * pixel;
  else {
    if (size - at > MAX_READ) return 'unknown';
    const b = await readAt(fh, at, size - at);
    let i = 0;
    for (let done = 0; done < pixels;) {
      const p = b[i];
      if (p === undefined) return 'cut';
      const n = (p & 0x7f) + 1;
      i += 1 + ((p & 0x80) !== 0 ? pixel : n * pixel);
      done += n;
      if (i > b.length) return 'cut';
    }
    at += i;
  }
  return at <= size ? 'whole' : 'cut';
}

/** An icon (ICO) or cursor (CUR): each picture its directory lists within the file. */
export async function icoWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const h = await readAt(fh, 0, 6);
  const count = h.readUInt16LE(4);
  if (count === 0) return 'unknown';
  const dir = await readAt(fh, 6, count * 16);
  if (dir.length < count * 16) return 'cut';
  let needed = 6 + count * 16;
  for (let k = 0; k < count; k++)
    needed = Math.max(needed, dir.readUInt32LE(k * 16 + 12) + dir.readUInt32LE(k * 16 + 8));
  return needed <= size ? 'whole' : 'cut';
}

// ---- FLV, MXF, RealMedia -----------------------------------------------------------------------------------------

/** An FLV: its last tag's size, in its last four bytes, leads back to that tag's header, which agrees. */
export async function flvWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const p = await readAt(fh, size - 4, 4);
  if (p.length < 4) return 'cut';
  const last = p.readUInt32BE(0);
  if (last < 11 || last + 4 > size - 9) return 'cut';
  const t = await readAt(fh, size - 4 - last, 11);
  const type = (t[0] ?? 0) & 0x1f;
  const data = ((t[1] ?? 0) << 16) | ((t[2] ?? 0) << 8) | (t[3] ?? 0);
  return (type === 8 || type === 9 || type === 18) && data + 11 === last ? 'whole' : 'cut';
}

const MXF_RIP = Buffer.from('060e2b34020501010d01020101110100', 'hex');

/**
 * An MXF: its random index pack ending the file (its length in its last four bytes) says it is whole; a footer that
 * its header partition says lies past the end, cut; else cannot tell.
 */
export async function mxfWhole(fh: FileHandle, size: number, head: Buffer): Promise<Wholeness> {
  const last = await readAt(fh, size - 4, 4);
  const rip = last.length === 4 ? last.readUInt32BE(0) : 0;
  if (rip >= 20 && rip <= size && (await readAt(fh, size - rip, 16)).equals(MXF_RIP)) return 'whole';
  // The header partition pack: its value after a BER length; its footer partition's place 24 bytes in.
  const ber = head[16] ?? 0;
  const value = 17 + ((ber & 0x80) !== 0 ? ber & 0x7f : 0);
  if (value + 32 > head.length) return 'unknown';
  const footer = Number(head.readBigUInt64BE(value + 24));
  return footer > 0 && footer + 16 > size ? 'cut' : 'unknown';
}

/** A RealMedia file: its chunks (each saying its own length) within the file, its data among them (a few bytes over). */
export async function rmWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  let at = 0;
  let data = false;
  for (let parts = 0; at + 8 <= size; parts++) {
    if (parts > MAX_PARTS) return 'unknown';
    const h = await readAt(fh, at, 8);
    const length = h.readUInt32BE(4);
    if (length < 8) return 'unknown';
    if (h.toString('latin1', 0, 4) === 'DATA') data = true;
    // A writer may count its data chunk's own header twice (FFmpeg's, 10 bytes over): past that, more is to come.
    if (at + length > size + 18) return 'cut';
    at += length;
  }
  return data ? 'whole' : 'cut';
}

// ---- CAF, AU, APE, WavPack, DV -----------------------------------------------------------------------------------------

/** A Core Audio file: its chunks (64-bit lengths) within the file, its data among them; a data length unknown, cannot tell. */
export async function cafWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  let at = 8;
  let data = false;
  for (let parts = 0; at + 12 <= size; parts++) {
    if (parts > MAX_PARTS) return 'unknown';
    const h = await readAt(fh, at, 12);
    const length = h.readBigInt64BE(4);
    if (length < 0n) return 'unknown';
    if (h.toString('latin1', 0, 4) === 'data') data = true;
    if (at + 12 + Number(length) > size) return 'cut';
    at += 12 + Number(length);
  }
  return data ? 'whole' : 'cut';
}

/** A Sun AU: its data's place and length in its header (a length unknown, cannot tell). */
export function auWhole(head: Buffer, size: number): Wholeness {
  const length = head.readUInt32BE(8);
  if (length === 0xffffffff) return 'unknown';
  return head.readUInt32BE(4) + length <= size ? 'whole' : 'cut';
}

/** Monkey's Audio (APE, version 3.98 on): the lengths its descriptor gives, added up; older ones cannot tell. */
export function apeWhole(head: Buffer, size: number): Wholeness {
  if (head.readUInt16LE(4) < 3980 || head.length < 36) return 'unknown';
  let needed = 0;
  for (const at of [8, 12, 16, 20, 24, 32]) needed += head.readUInt32LE(at);
  needed += head.readUInt32LE(28) * 2 ** 32;
  return needed <= size ? 'whole' : 'cut';
}

/** WavPack: its last block (ending the file, before any tag) ends the samples its blocks count. */
export async function wavpackWhole(fh: FileHandle, size: number, head: Buffer): Promise<Wholeness> {
  const total = head.readUInt32LE(12) + (head[11] ?? 0) * 2 ** 32;
  if (head.readUInt32LE(12) === 0xffffffff) return 'unknown';
  const end = await endBeforeTags(fh, size);
  const from = Math.max(0, end - 1024 * 1024);
  const tail = await readAt(fh, from, end - from);
  const mark = Buffer.from('wvpk', 'latin1');
  for (let i = tail.lastIndexOf(mark); i >= 0; i = i > 0 ? tail.lastIndexOf(mark, i - 1) : -1) {
    if (i + 32 > tail.length) continue;
    if (i + 8 + tail.readUInt32LE(i + 4) !== tail.length) continue;
    const index = tail.readUInt32LE(i + 16) + (tail[i + 10] ?? 0) * 2 ** 32;
    return index + tail.readUInt32LE(i + 20) >= total ? 'whole' : 'cut';
  }
  return 'cut';
}

/**
 * DV (a tape camera's .dv): frames of a fixed size, 120,000 bytes (525 lines) or 144,000 (625), their multiples for
 * DV50 and DVCPRO HD: one ending part-way through a frame is cut; whole frames cannot tell.
 */
export function dvWhole(head: Buffer, size: number): Wholeness {
  const frame = ((head[3] ?? 0) & 0x80) !== 0 ? 144_000 : 120_000;
  return size % frame === 0 ? 'unknown' : 'cut';
}

// ---- Office 97-2003 (a compound file: .ppt, .doc) ------------------------------------------------------------------------

const FREE_SECTOR = 0xffffffff;

/** An Office compound file: the last sector its allocation table uses, whole within the file. */
export async function compoundWhole(fh: FileHandle, size: number): Promise<Wholeness> {
  const h = await readAt(fh, 0, 512);
  if (h.length < 512) return 'cut';
  const shift = h.readUInt16LE(30);
  if (shift !== 9 && shift !== 12) return 'unknown';
  const sector = 2 ** shift;
  const base = sector === 512 ? 512 : 4096;
  const fatCount = h.readUInt32LE(44);
  if (fatCount > 100_000) return 'unknown';
  const fats: number[] = [];
  for (let k = 0; k < 109 && fats.length < fatCount; k++) fats.push(h.readUInt32LE(76 + k * 4));
  const per = sector / 4;
  let difat = h.readUInt32LE(68);
  for (let k = 0; k < h.readUInt32LE(72) && difat < 0xfffffffa && fats.length < fatCount; k++) {
    const s = await readAt(fh, base + difat * sector, sector);
    if (s.length < sector) return 'cut';
    for (let e = 0; e < per - 1 && fats.length < fatCount; e++) fats.push(s.readUInt32LE(e * 4));
    difat = s.readUInt32LE((per - 1) * 4);
  }
  if (fats.length < fatCount) return 'unknown';
  let highest = -1;
  for (const [k, fat] of fats.entries()) {
    const s = await readAt(fh, base + fat * sector, sector);
    if (s.length < sector) return 'cut';
    for (let e = per - 1; e >= 0; e--)
      if (s.readUInt32LE(e * 4) !== FREE_SECTOR) {
        highest = Math.max(highest, k * per + e);
        break;
      }
  }
  if (highest < 0) return 'unknown';
  return base + (highest + 1) * sector <= size ? 'whole' : 'cut';
}
