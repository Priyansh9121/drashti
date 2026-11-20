import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

/*
 * A video's profile and level from its own codec record (alpha.20, Media information…; Q60-34): FFmpeg names an
 * H.264's or an HEVC's profile but never its level, which the file keeps in a few bytes at its start or its end: the
 * avcC or hvcC box of an MP4's or a QuickTime file's movie box, or a Matroska track's CodecPrivate. Only headers are
 * read (never the pictures), with a movie box of more than 64 MB left alone, as import/probe.ts does. Never throws.
 */

export interface CodecLevel {
  codec: 'h264' | 'hevc';
  /** The profile's number in the record: H.264's profile_idc (100 is High), HEVC's general_profile_idc (2 is Main 10). */
  profileIdc: number;
  /** The level as people write it: "3.1", "5.1"; H.264's "1b". */
  level: string;
}

/** H.264's levels by their level_idc. */
const H264_LEVELS: Record<number, string> = {
  9: '1b',
  10: '1',
  11: '1.1',
  12: '1.2',
  13: '1.3',
  20: '2',
  21: '2.1',
  22: '2.2',
  30: '3',
  31: '3.1',
  32: '3.2',
  40: '4',
  41: '4.1',
  42: '4.2',
  50: '5',
  51: '5.1',
  52: '5.2',
  60: '6',
  61: '6.1',
  62: '6.2',
};

/** H.264's profile_idc values (Baseline 66 to High 4:4:4 Predictive 244, the scalable and multiview ones too). */
const H264_PROFILES = new Set([66, 77, 88, 100, 110, 122, 244, 44, 83, 86, 118, 128, 134, 135, 138, 139]);

/** An H.264 level_idc as people write it ("4.2"); null for a number that is no level. */
export const h264Level = (levelIdc: number): string | null => H264_LEVELS[levelIdc] ?? null;

/** An HEVC general_level_idc (30 times the level: 93 is 3.1) as people write it; null for a number that is no level. */
export function hevcLevel(levelIdc: number): string | null {
  if (!Number.isInteger(levelIdc) || levelIdc < 30 || levelIdc > 255 || levelIdc % 3 !== 0) return null;
  return String(Number((levelIdc / 30).toFixed(1)));
}

/** An AVCDecoderConfigurationRecord (version 1, profile, compatibility, level, …). */
export function fromAvcC(record: Uint8Array): CodecLevel | null {
  if (record.length < 7 || record[0] !== 1) return null;
  const profileIdc = record[1] ?? 0;
  const level = h264Level(record[3] ?? 0);
  return H264_PROFILES.has(profileIdc) && level ? { codec: 'h264', profileIdc, level } : null;
}

/** An HEVCDecoderConfigurationRecord: version 1, then space, tier and profile in one byte, … its level at byte 12. */
export function fromHvcC(record: Uint8Array): CodecLevel | null {
  if (record.length < 23 || record[0] !== 1) return null;
  const profileIdc = (record[1] ?? 0) & 0x1f;
  const level = hevcLevel(record[12] ?? 0);
  return profileIdc > 0 && level ? { codec: 'hevc', profileIdc, level } : null;
}

interface Box {
  type: string;
  /** Where its contents start and end. */
  start: number;
  end: number;
}

/** The boxes in buf[from, to). */
function boxesIn(buf: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

const child = (buf: Buffer, box: Box | undefined, type: string): Box | undefined =>
  box ? boxesIn(buf, box.start, box.end).find((b) => b.type === type) : undefined;

/** The sample entries of each picture's codec, and the record each carries. */
const RECORDS: Record<string, 'avcC' | 'hvcC'> = {
  avc1: 'avcC',
  avc3: 'avcC',
  hvc1: 'hvcC',
  hev1: 'hvcC',
  dvh1: 'hvcC',
  dvhe: 'hvcC',
};

/** A visual sample entry's own fields before its boxes: 6 reserved, its data reference, then 70 bytes of its own. */
const VISUAL_ENTRY = 78;

/** The first picture's record in a movie box. */
function inMovie(moov: Buffer): CodecLevel | null {
  for (const trak of boxesIn(moov, 0, moov.length).filter((b) => b.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia');
    const hdlr = child(moov, mdia, 'hdlr');
    const handler =
      hdlr && hdlr.start + 12 <= hdlr.end ? moov.toString('latin1', hdlr.start + 8, hdlr.start + 12) : '';
    if (handler !== 'vide') continue;
    const stsd = child(moov, child(moov, child(moov, mdia, 'minf'), 'stbl'), 'stsd');
    // stsd: version and flags (4), how many entries (4), then the entries, each a box named by its codec.
    const entry = stsd ? boxesIn(moov, stsd.start + 8, stsd.end)[0] : undefined;
    const wanted = entry ? RECORDS[entry.type] : undefined;
    if (!entry || !wanted || entry.start + VISUAL_ENTRY > entry.end) return null;
    const record = boxesIn(moov, entry.start + VISUAL_ENTRY, entry.end).find((b) => b.type === wanted);
    if (!record) return null;
    const bytes = moov.subarray(record.start, record.end);
    return wanted === 'avcC' ? fromAvcC(bytes) : fromHvcC(bytes);
  }
  return null;
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** An MP4's or a QuickTime file's movie box, wherever it is among the top-level boxes; null when there is none. */
async function movieBox(fh: FileHandle, size: number): Promise<Buffer | null> {
  let at = 0;
  while (at + 8 <= size) {
    const header = await readAt(fh, at, 16);
    if (header.length < 8) return null;
    let boxSize = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    let headerSize = 8;
    if (boxSize === 1 && header.length >= 16) {
      boxSize = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (boxSize === 0) boxSize = size - at;
    if (boxSize < headerSize) return null;
    if (type === 'moov') {
      if (boxSize > 64 * 1024 * 1024) return null;
      return readAt(fh, at + headerSize, boxSize - headerSize);
    }
    at += boxSize;
  }
  return null;
}

/** A Matroska size (an EBML number: its first byte's leading zeros say its length): its value and length. */
function ebmlSize(buf: Buffer, at: number): { value: number; length: number } | null {
  const first = buf[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length++;
  if (length > 8 || at + length > buf.length) return null;
  let value = first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + (buf[at + i] ?? 0);
  return { value, length };
}

/** How much of a Matroska file's start is read for its tracks (they come first, before the clusters). */
const MATROSKA_HEAD = 2 * 1024 * 1024;

/**
 * A Matroska (or WebM) file's first H.264 or HEVC track's record: its CodecPrivate (element 0x63A2) whose bytes are a
 * record of the codec its CodecID names, found among the file's first bytes.
 */
function inMatroska(head: Buffer): CodecLevel | null {
  const avc = head.includes('V_MPEG4/ISO/AVC', 0, 'latin1');
  const hevc = head.includes('V_MPEGH/ISO/HEVC', 0, 'latin1');
  if (!avc && !hevc) return null;
  for (
    let at = head.indexOf(Buffer.from([0x63, 0xa2]));
    at >= 0;
    at = head.indexOf(Buffer.from([0x63, 0xa2]), at + 1)
  ) {
    const size = ebmlSize(head, at + 2);
    if (!size) continue;
    const from = at + 2 + size.length;
    if (size.value < 7 || from + size.value > head.length) continue;
    const bytes = head.subarray(from, from + size.value);
    const found = (avc ? fromAvcC(bytes) : null) ?? (hevc ? fromHvcC(bytes) : null);
    if (found) return found;
  }
  return null;
}

/** A video file's first picture's profile and level, from its own codec record; null when it has none Drashti reads. */
export async function readCodecLevel(path: string): Promise<CodecLevel | null> {
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, 'r');
    const { size } = await fh.stat();
    const head = await readAt(fh, 0, Math.min(size, MATROSKA_HEAD));
    if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return inMatroska(head);
    const kind = head.length >= 8 ? head.toString('latin1', 4, 8) : '';
    if (!['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(kind)) return null;
    const moov = await movieBox(fh, size);
    return moov ? inMovie(moov) : null;
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** Red (x47, slice 2): still to be written. */
export type MovieVideo = CodecLevel & { width: number; height: number };
export const movieVideo = (_moov: Buffer): MovieVideo | null => null;
