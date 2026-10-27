import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { FileKind } from '../../shared/phone-files';
import { probeMedia } from './probe';
import { listZip } from './zip';

/*
 * What a file is, by what is inside it and never by its name (Session 54, D4: a file a phone adds), and the
 * extension Drashti gives it, so the import takes it for what it is: a picture, a video or a sound (each the
 * kind the media probe reads in its bytes), a PDF, a PowerPoint file (.pptx, or a 97–2003 .ppt naming its
 * "PowerPoint Document"), or a Keynote file. Anything else is null: a renamed program, a Word file, a zip of
 * other things. Only the first bytes, a zip's directory or a compound file's directory are read, never the whole.
 */

export interface FileWhat {
  kind: FileKind;
  /** The extension the import knows it by (lower case, no dot). */
  ext: string;
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(Math.max(0, length));
  const { bytesRead } = await fh.read(buf, 0, buf.length, position);
  return buf.subarray(0, bytesRead);
}

const ascii = (buf: Buffer, from: number, to: number) => buf.toString('latin1', from, to);

// ---- PDF -----------------------------------------------------------------------------------

/** "%PDF-" in its first kilobyte, and "%%EOF" near its end, as every PDF has. */
async function isPdf(fh: FileHandle, size: number, head: Buffer): Promise<boolean> {
  const start = head.subarray(0, 1024).indexOf('%PDF-', 0, 'latin1');
  if (start < 0) return false;
  const tail = await readAt(fh, Math.max(0, size - 4096), Math.min(size, 4096));
  return tail.includes('%%EOF', 0, 'latin1');
}

// ---- PowerPoint 97–2003 (a compound file) ---------------------------------------------------

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** Sector numbers from here up mark the end of a chain, a free sector, or the FAT's own. */
const SPECIAL = 0xfffffffa;
const POWERPOINT_STREAM = Buffer.from('PowerPoint Document\0', 'utf16le');

/**
 * Whether a compound file holds a stream named "PowerPoint Document" (a Word or Excel file does not): its
 * directory's sectors are followed through the FAT, whose own sectors the header and the DIFAT's chain list.
 * Every chain is cut short at a bound, so a file made to go round in circles ends.
 */
async function isOlePowerPoint(fh: FileHandle, size: number): Promise<boolean> {
  const header = await readAt(fh, 0, 512);
  if (header.length < 512) return false;
  const shift = header.readUInt16LE(0x1e);
  if (shift !== 9 && shift !== 12) return false;
  const sector = 2 ** shift;
  const perSector = sector / 4;
  const sectorAt = (s: number) => (s + 1) * sector;
  const fat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = header.readUInt32LE(0x4c + i * 4);
    if (s < SPECIAL) fat.push(s);
  }
  let difat = header.readUInt32LE(0x44);
  for (let n = 0; n < header.readUInt32LE(0x48) && n < 4096 && difat < SPECIAL; n++) {
    const buf = await readAt(fh, sectorAt(difat), sector);
    if (buf.length < sector) return false;
    for (let i = 0; i < perSector - 1; i++) {
      const s = buf.readUInt32LE(i * 4);
      if (s < SPECIAL) fat.push(s);
    }
    difat = buf.readUInt32LE(sector - 4);
  }
  const fatSectors = new Map<number, Buffer>();
  const next = async (s: number): Promise<number> => {
    const index = Math.floor(s / perSector);
    const at = fat[index];
    if (at === undefined) return SPECIAL;
    let buf = fatSectors.get(index);
    if (!buf) {
      buf = await readAt(fh, sectorAt(at), sector);
      fatSectors.set(index, buf);
    }
    return buf.length < sector ? SPECIAL : buf.readUInt32LE((s % perSector) * 4);
  };
  let s = header.readUInt32LE(0x30);
  for (let n = 0; n < 512 && s < SPECIAL && sectorAt(s) < size; n++) {
    const entries = await readAt(fh, sectorAt(s), sector);
    // Each entry is 128 bytes: its name in UTF-16 (with its ending), then the name's length in bytes.
    for (let at = 0; at + 128 <= entries.length; at += 128) {
      const length = entries.readUInt16LE(at + 64);
      if (length === POWERPOINT_STREAM.length && entries.subarray(at, at + length).equals(POWERPOINT_STREAM))
        return true;
    }
    s = await next(s);
  }
  return false;
}

// ---- PowerPoint (.pptx) and Keynote: a zip, by the parts inside -----------------------------

async function deckInZip(path: string): Promise<FileWhat | null> {
  const names = new Set((await listZip(path).catch(() => [])).map((e) => e.name));
  if (names.has('ppt/presentation.xml')) return { kind: 'powerpoint', ext: 'pptx' };
  if (names.has('Index/Document.iwa') || names.has('index.apxl') || names.has('index.apxl.gz'))
    return { kind: 'keynote', ext: 'key' };
  return null;
}

// ---- pictures, videos and sounds ----------------------------------------------------------

/** MPEG audio's bit rates (kbit/s) by version and layer, and its sample rates by version. */
const MPEG_RATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MPEG_SAMPLES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** The length of the MPEG audio or ADTS frame starting at `at`, or null when none does. */
function frameLength(head: Buffer, at: number): number | null {
  if (at + 7 > head.length || head[at] !== 0xff || ((head[at + 1] ?? 0) & 0xe0) !== 0xe0) return null;
  const b1 = head[at + 1] ?? 0;
  const b2 = head[at + 2] ?? 0;
  // Layer bits 00: AAC in ADTS, its frame's length written in it.
  if ((b1 & 0x06) === 0) {
    const length =
      (((head[at + 3] ?? 0) & 0x03) << 11) | ((head[at + 4] ?? 0) << 3) | ((head[at + 5] ?? 0) >> 5);
    return length >= 7 ? length : null;
  }
  const version = (b1 >> 3) & 0x03;
  const layer = 4 - ((b1 >> 1) & 0x03);
  const rates = MPEG_RATES[`${version === 3 ? 1 : 2}-${version === 3 ? layer : Math.min(layer, 2)}`];
  const kbps = rates?.[(b2 >> 4) & 0x0f] ?? 0;
  const rate = MPEG_SAMPLES[version]?.[(b2 >> 2) & 0x03] ?? 0;
  if (version === 1 || kbps === 0 || rate === 0) return null;
  const padding = (b2 >> 1) & 0x01;
  if (layer === 1) return (Math.floor((12 * kbps * 1000) / rate) + padding) * 4;
  const perFrame = layer === 3 && version !== 3 ? 72 : 144;
  return Math.floor((perFrame * kbps * 1000) / rate) + padding;
}

/** MPEG audio (MP3) or AAC (ADTS) without a tag: two frames, one straight after the other. */
function mpegAudio(head: Buffer): boolean {
  const first = frameLength(head, 0);
  return first !== null && frameLength(head, first) !== null;
}

/** A BMP's header names a picture header of a size BMPs have. */
const bmp = (head: Buffer) =>
  head.length >= 18 &&
  ascii(head, 0, 2) === 'BM' &&
  [12, 40, 52, 56, 108, 124].includes(head.readUInt32LE(14));

/** The brands an ISO file names itself by (MP4, QuickTime, M4A, 3GP, HEIC, AVIF). */
function brands(head: Buffer): Set<string> {
  const out = new Set<string>();
  if (head.length < 16 || ascii(head, 4, 8) !== 'ftyp') return out;
  const end = Math.min(head.length, head.readUInt32BE(0));
  out.add(ascii(head, 8, 12));
  for (let at = 16; at + 4 <= end; at += 4) out.add(ascii(head, at, at + 4));
  return out;
}

/** The extension of each format the media probe names by a file's first bytes alone (probe.ts probeByMagic). */
const BY_FORMAT: Record<string, string> = {
  'JPEG picture': 'jpg',
  'PNG picture': 'png',
  'GIF picture': 'gif',
  'BMP picture': 'bmp',
  'TIFF picture': 'tiff',
  'WebP picture': 'webp',
  'AVIF picture': 'avif',
  'HEIC photo': 'heic',
  'AVI video': 'avi',
  'WAV sound file': 'wav',
  'ADPCM WAV sound file': 'wav',
  'AIFF sound file': 'aiff',
  'Windows Media (WMV or WMA) file': 'wmv',
  'Flash video': 'flv',
  'MPEG program stream video (DVD style)': 'mpg',
  'MPEG transport stream video': 'ts',
  'AVCHD (M2TS) video': 'm2ts',
  'FLAC sound file': 'flac',
  'Ogg Theora video': 'ogv',
  'Ogg sound file': 'ogg',
  'MP3 sound file': 'mp3',
  'AAC sound file': 'aac',
};

/**
 * The extension a picture, video or sound is known by: by the format the probe read in its bytes; an MP4,
 * QuickTime or Matroska file by its kind and the brand it names itself by. A header the probe takes on two bytes
 * alone (a BMP, an MP3 or AAC without a tag) must hold up as one.
 */
function mediaExtension(head: Buffer, kind: 'image' | 'video' | 'audio', format: string): string | null {
  const known = BY_FORMAT[format];
  if (known === 'bmp') return bmp(head) ? known : null;
  if ((known === 'mp3' || known === 'aac') && ascii(head, 0, 3) !== 'ID3')
    return mpegAudio(head) ? known : null;
  if (known) return known;
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3)
    return format.includes('(WebM)')
      ? kind === 'audio'
        ? 'weba'
        : 'webm'
      : kind === 'audio'
        ? 'mka'
        : 'mkv';
  const iso = brands(head);
  if (iso.size > 0 || ['moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(head, 4, 8))) {
    if (kind === 'audio') return 'm4a';
    if (kind === 'image') return null;
    if (iso.has('qt  ') || iso.size === 0) return 'mov';
    if ([...iso].some((b) => b.startsWith('3gp') || b.startsWith('3g2'))) return '3gp';
    return 'mp4';
  }
  return null;
}

/**
 * The file's first bytes, and what it is when they say a PDF or a compound file (`found`; undefined for anything
 * else), read with one handle; null when it cannot be read, or is empty.
 */
async function firstLook(path: string): Promise<{ head: Buffer; found: FileWhat | null | undefined } | null> {
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, 'r');
    const info = await fh.stat();
    if (!info.isFile() || info.size === 0) return null;
    const head = await readAt(fh, 0, Math.min(info.size, 64 * 1024));
    if (await isPdf(fh, info.size, head)) return { head, found: { kind: 'pdf', ext: 'pdf' } };
    if (head.subarray(0, 8).equals(OLE_SIGNATURE))
      return {
        head,
        found: (await isOlePowerPoint(fh, info.size)) ? { kind: 'powerpoint', ext: 'ppt' } : null,
      };
    return { head, found: undefined };
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/**
 * What the file is, and its extension; null when it is none of what Drashti takes from a phone (or cannot be
 * read). Never throws.
 */
export async function whatFileIs(path: string): Promise<FileWhat | null> {
  const look = await firstLook(path);
  if (!look) return null;
  if (look.found !== undefined) return look.found;
  const { head } = look;
  if (ascii(head, 0, 4) === 'PK\u0003\u0004') return deckInZip(path);
  const probe = await probeMedia(path);
  if (probe.kind === 'unknown') return null;
  const ext = mediaExtension(head, probe.kind, probe.format);
  return ext === null ? null : { kind: probe.kind, ext };
}
