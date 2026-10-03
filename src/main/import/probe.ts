import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { ImportIssue } from '../../shared/import';

/*
 * What a media file really is, from its bytes (not its name), and whether
 * Drashti's windows (Chromium) can play it. No FFmpeg: containers and
 * codecs are recognised from their headers. What cannot play is converted
 * with the bundled FFmpeg (src/main/convert/), from the report or the
 * media list.
 */

export interface MediaProbe {
  /** true: plays; false: cannot play; null: not sure (it is tried when used). */
  playable: boolean | null;
  /** What it is, for people: "ProRes 422 video (QuickTime)". */
  format: string;
  /** What kind of thing it is, for the advice: a picture, a video or a sound. */
  kind: 'image' | 'video' | 'audio' | 'unknown';
}

const unknown = (): MediaProbe => ({
  playable: null,
  format: 'file of a kind Drashti does not recognise',
  kind: 'unknown',
});

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

// ---- ISO base media (MP4, MOV, M4A, 3GP, HEIC, AVIF) --------------------------

const VIDEO_CODECS: Record<string, [string, boolean | null]> = {
  avc1: ['H.264', true],
  avc3: ['H.264', true],
  vp09: ['VP9', true],
  av01: ['AV1', true],
  // HEVC plays where the computer can decode it (most Macs; Windows needs the HEVC extension).
  hvc1: ['HEVC (H.265)', null],
  hev1: ['HEVC (H.265)', null],
  dvh1: ['Dolby Vision HEVC', null],
  dvhe: ['Dolby Vision HEVC', null],
  apcn: ['ProRes 422', false],
  apch: ['ProRes 422 HQ', false],
  apcs: ['ProRes 422 LT', false],
  apco: ['ProRes 422 Proxy', false],
  ap4h: ['ProRes 4444', false],
  ap4x: ['ProRes 4444 XQ', false],
  aprn: ['ProRes RAW', false],
  aprh: ['ProRes RAW HQ', false],
  mp4v: ['MPEG-4 Part 2', false],
  jpeg: ['Motion JPEG', false],
  mjpa: ['Motion JPEG', false],
  mjpb: ['Motion JPEG', false],
  'dvc ': ['DV', false],
  dvcp: ['DV', false],
  dvpp: ['DVCPRO', false],
  dv5n: ['DVCPRO50', false],
  dv5p: ['DVCPRO50', false],
  dvh5: ['DVCPRO HD', false],
  dvh6: ['DVCPRO HD', false],
  dvhp: ['DVCPRO HD', false],
  dvhq: ['DVCPRO HD', false],
  mx5p: ['IMX', false],
  mx4p: ['IMX', false],
  mx3p: ['IMX', false],
  m2v1: ['MPEG-2', false],
  mp2v: ['MPEG-2', false],
  xdvc: ['XDCAM (MPEG-2)', false],
  AVdn: ['DNxHD', false],
  AVdh: ['DNxHR', false],
  CFHD: ['CineForm', false],
  Hap1: ['HAP', false],
  Hap5: ['HAP', false],
  HapY: ['HAP', false],
  HapM: ['HAP', false],
  'png ': ['PNG frames', false],
  'rle ': ['Animation (RLE)', false],
  cvid: ['Cinepak', false],
  SVQ1: ['Sorenson Video', false],
  SVQ3: ['Sorenson Video 3', false],
  h263: ['H.263', false],
  s263: ['H.263', false],
  v210: ['uncompressed video', false],
  '2vuy': ['uncompressed video', false],
};

const AUDIO_CODECS: Record<string, [string, boolean | null]> = {
  mp4a: ['AAC', true],
  Opus: ['Opus', true],
  fLaC: ['FLAC', true],
  '.mp3': ['MP3', true],
  alac: ['Apple Lossless', false],
  'ac-3': ['AC-3', false],
  'ec-3': ['E-AC-3', false],
  samr: ['AMR', false],
  ima4: ['IMA ADPCM', false],
  // Uncompressed sound in a QuickTime file: usually plays, not always.
  lpcm: ['uncompressed sound', null],
  sowt: ['uncompressed sound', null],
  twos: ['uncompressed sound', null],
  in24: ['uncompressed sound', null],
  in32: ['uncompressed sound', null],
  fl32: ['uncompressed sound', null],
};

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

const child = (buf: Buffer, box: Box | undefined, type: string) =>
  box ? boxesIn(buf, box.start, box.end).find((b) => b.type === type) : undefined;

/** The codec four-character codes of each track: video and sound. */
function trackCodecs(moov: Buffer): { video: string[]; audio: string[] } {
  const video: string[] = [];
  const audio: string[] = [];
  for (const trak of boxesIn(moov, 0, moov.length).filter((b) => b.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia');
    const hdlr = child(moov, mdia, 'hdlr');
    // hdlr: version and flags (4), pre-defined (4), handler type (4).
    const handler =
      hdlr && hdlr.start + 12 <= hdlr.end ? moov.toString('latin1', hdlr.start + 8, hdlr.start + 12) : '';
    const stsd = child(moov, child(moov, child(moov, mdia, 'minf'), 'stbl'), 'stsd');
    // stsd: version and flags (4), entry count (4), then sample entries (boxes named by codec).
    const codecs = stsd ? boxesIn(moov, stsd.start + 8, stsd.end).map((b) => b.type) : [];
    if (handler === 'vide') video.push(...codecs);
    else if (handler === 'soun') audio.push(...codecs);
  }
  return { video, audio };
}

async function probeIsoMedia(fh: FileHandle, size: number, head: Buffer): Promise<MediaProbe> {
  // Brands: the major brand, then compatible ones.
  const ftyp = boxesIn(head, 0, head.length).find((b) => b.type === 'ftyp');
  const brands = new Set<string>();
  if (ftyp) {
    brands.add(head.toString('latin1', ftyp.start, ftyp.start + 4));
    for (let at = ftyp.start + 8; at + 4 <= ftyp.end; at += 4)
      brands.add(head.toString('latin1', at, at + 4));
  }
  if (brands.has('avif') || brands.has('avis'))
    return { playable: true, format: 'AVIF picture', kind: 'image' };
  if (
    ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].some((b) =>
      brands.has(b),
    )
  ) {
    return { playable: false, format: 'HEIC photo', kind: 'image' };
  }
  const container = brands.has('qt  ') ? 'QuickTime' : brands.has('M4A ') ? 'M4A' : 'MP4';
  // Find the movie box at the top level: at the start (streamable files) or after the media data.
  let at = 0;
  let moov: Buffer | null = null;
  while (at + 8 <= size) {
    const header = await readAt(fh, at, 16);
    if (header.length < 8) break;
    let boxSize = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    let headerSize = 8;
    if (boxSize === 1 && header.length >= 16) {
      boxSize = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (boxSize === 0) boxSize = size - at;
    if (boxSize < headerSize) break;
    if (type === 'moov') {
      // A movie box of more than 64 MB is not worth reading to find two codec names.
      if (boxSize > 64 * 1024 * 1024) break;
      moov = await readAt(fh, at + headerSize, boxSize - headerSize);
      break;
    }
    at += boxSize;
  }
  if (!moov) return { playable: null, format: `${container} file`, kind: 'unknown' };
  const { video, audio } = trackCodecs(moov);
  const v = video.map((c): [string, boolean | null] => VIDEO_CODECS[c] ?? [`${c.trim()} video`, null]);
  const a = audio.map((c): [string, boolean | null] => AUDIO_CODECS[c] ?? [`${c.trim()} sound`, null]);
  if (v.length > 0) {
    const [name, playable]: [string, boolean | null] = v[0] ?? ['video', null];
    const badSound = a.find(([, p]) => p === false);
    return {
      // A picture that plays with sound that does not is not sure: the sound may be left out.
      playable: playable === false ? false : badSound && playable ? null : playable,
      format: `${name} video (${container})${badSound ? ` with ${badSound[0]} sound` : ''}`,
      kind: 'video',
    };
  }
  if (a.length > 0) {
    const [name, playable]: [string, boolean | null] = a[0] ?? ['sound', null];
    return {
      playable,
      format: `${name} sound file (${container})`,
      kind: 'audio',
    };
  }
  return { playable: null, format: `${container} file`, kind: 'unknown' };
}

// ---- Matroska and WebM ------------------------------------------------------------

const MATROSKA_CODECS: [string, string, boolean | null, 'video' | 'audio'][] = [
  ['V_VP8', 'VP8', true, 'video'],
  ['V_VP9', 'VP9', true, 'video'],
  ['V_AV1', 'AV1', true, 'video'],
  ['V_MPEG4/ISO/AVC', 'H.264', true, 'video'],
  ['V_MPEGH/ISO/HEVC', 'HEVC (H.265)', null, 'video'],
  ['V_MPEG4/ISO/', 'MPEG-4 Part 2', false, 'video'],
  ['V_MPEG2', 'MPEG-2', false, 'video'],
  ['V_MS/VFW', 'Windows video', false, 'video'],
  ['V_PRORES', 'ProRes', false, 'video'],
  ['V_MJPEG', 'Motion JPEG', false, 'video'],
  ['V_THEORA', 'Theora', null, 'video'],
  ['A_OPUS', 'Opus', true, 'audio'],
  ['A_VORBIS', 'Vorbis', true, 'audio'],
  ['A_AAC', 'AAC', true, 'audio'],
  ['A_FLAC', 'FLAC', true, 'audio'],
  ['A_MPEG/L3', 'MP3', true, 'audio'],
  ['A_EAC3', 'E-AC-3', false, 'audio'],
  ['A_AC3', 'AC-3', false, 'audio'],
  ['A_DTS', 'DTS', false, 'audio'],
  ['A_TRUEHD', 'TrueHD', false, 'audio'],
  ['A_PCM', 'uncompressed sound', null, 'audio'],
];

function probeMatroska(head: Buffer): MediaProbe {
  const webm = head.includes('webm', 0, 'latin1');
  const container = webm ? 'WebM' : 'Matroska';
  const found = MATROSKA_CODECS.filter(([id]) => head.includes(id, 0, 'latin1'));
  // The longest id that matches (V_MPEG4/ISO/AVC before V_MPEG4/ISO/).
  const pick = (kind: 'video' | 'audio') =>
    found.filter((c) => c[3] === kind).sort((x, y) => y[0].length - x[0].length)[0];
  const video = pick('video');
  const audio = pick('audio');
  if (video) {
    const badSound = audio?.[2] === false ? audio : undefined;
    return {
      playable: video[2] === false ? false : badSound && video[2] ? null : video[2],
      format: `${video[1]} video (${container})${badSound ? ` with ${badSound[1]} sound` : ''}`,
      kind: 'video',
    };
  }
  if (audio) return { playable: audio[2], format: `${audio[1]} sound file (${container})`, kind: 'audio' };
  return { playable: null, format: `${container} file`, kind: 'unknown' };
}

// ---- everything else, by its first bytes ---------------------------------------------

const ASF = Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]);

function probeWav(head: Buffer): MediaProbe {
  const chunks = boxesLittle(head);
  const fmt = chunks.find((c) => c.type === 'fmt ');
  const tag = fmt && fmt.start + 2 <= head.length ? head.readUInt16LE(fmt.start) : -1;
  // PCM, float, A-law, mu-law, MP3, and the extensible form (almost always PCM) play; ADPCM does not.
  if ([1, 3, 6, 7, 0x55, 0xfffe].includes(tag))
    return { playable: true, format: 'WAV sound file', kind: 'audio' };
  if ([2, 0x11].includes(tag)) return { playable: false, format: 'ADPCM WAV sound file', kind: 'audio' };
  return { playable: null, format: 'WAV sound file', kind: 'audio' };
}

/** RIFF chunks after the 12-byte RIFF header (little-endian sizes). */
function boxesLittle(buf: Buffer): Box[] {
  const out: Box[] = [];
  let at = 12;
  while (at + 8 <= buf.length) {
    const type = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    out.push({ type, start: at + 8, end: Math.min(buf.length, at + 8 + size) });
    at += 8 + size + (size % 2);
  }
  return out;
}

function probeByMagic(head: Buffer): MediaProbe | null {
  const ascii = (from: number, to: number) => head.toString('latin1', from, to);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return { playable: true, format: 'JPEG picture', kind: 'image' };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { playable: true, format: 'PNG picture', kind: 'image' };
  if (ascii(0, 4) === 'GIF8') return { playable: true, format: 'GIF picture', kind: 'image' };
  if (ascii(0, 2) === 'BM') return { playable: true, format: 'BMP picture', kind: 'image' };
  if (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*')
    return { playable: false, format: 'TIFF picture', kind: 'image' };
  if (ascii(0, 4) === 'RIFF') {
    const form = ascii(8, 12);
    if (form === 'WEBP') return { playable: true, format: 'WebP picture', kind: 'image' };
    if (form === 'AVI ') return { playable: false, format: 'AVI video', kind: 'video' };
    if (form === 'WAVE') return probeWav(head);
  }
  if (ascii(0, 4) === 'FORM' && (ascii(8, 12) === 'AIFF' || ascii(8, 12) === 'AIFC'))
    return { playable: false, format: 'AIFF sound file', kind: 'audio' };
  if (head.subarray(0, 8).equals(ASF))
    return { playable: false, format: 'Windows Media (WMV or WMA) file', kind: 'video' };
  if (ascii(0, 3) === 'FLV') return { playable: false, format: 'Flash video', kind: 'video' };
  if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0xba)
    return { playable: false, format: 'MPEG program stream video (DVD style)', kind: 'video' };
  // MPEG transport stream: a sync byte every 188 bytes (or 192, with timestamps, in .m2ts).
  if (head[0] === 0x47 && head[188] === 0x47)
    return { playable: false, format: 'MPEG transport stream video', kind: 'video' };
  if (head[4] === 0x47 && head[196] === 0x47)
    return { playable: false, format: 'AVCHD (M2TS) video', kind: 'video' };
  if (ascii(0, 4) === 'fLaC') return { playable: true, format: 'FLAC sound file', kind: 'audio' };
  if (ascii(0, 4) === 'OggS') {
    if (head.includes('theora', 0, 'latin1'))
      return { playable: null, format: 'Ogg Theora video', kind: 'video' };
    return { playable: true, format: 'Ogg sound file', kind: 'audio' };
  }
  if (ascii(0, 3) === 'ID3') return { playable: true, format: 'MP3 sound file', kind: 'audio' };
  if (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) {
    // Layer bits 00 are AAC in ADTS; otherwise MPEG audio (MP3).
    const aac = ((head[1] ?? 0) & 0x06) === 0;
    return { playable: true, format: aac ? 'AAC sound file' : 'MP3 sound file', kind: 'audio' };
  }
  return null;
}

/** What a media file is, and whether Drashti can play it. Never throws. */
export async function probeMedia(path: string): Promise<MediaProbe> {
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, 'r');
    const { size } = await fh.stat();
    const head = await readAt(fh, 0, Math.min(size, 256 * 1024));
    if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp')
      return await probeIsoMedia(fh, size, head);
    // QuickTime files without a file-type box start straight with other boxes.
    if (head.length >= 8 && ['moov', 'mdat', 'wide', 'free', 'skip'].includes(head.toString('latin1', 4, 8)))
      return await probeIsoMedia(fh, size, head);
    if (head.readUInt32BE(0) === 0x1a45dfa3) return probeMatroska(head);
    return probeByMagic(head) ?? unknown();
  } catch {
    return unknown();
  } finally {
    await fh?.close();
  }
}

/** What to do about a file that cannot play: for the import report. */
export function unplayableAdvice(probe: MediaProbe): string {
  switch (probe.kind) {
    case 'image':
      return 'Convert makes a JPEG (or a PNG, when it has transparency) that Drashti plays, and uses it wherever this picture was.';
    case 'audio':
      return 'Convert makes an AAC sound file that Drashti plays, and uses it wherever this sound was.';
    default:
      return 'Convert makes an H.264 MP4 (or a WebM, when it has transparency) that Drashti plays, and uses it wherever this video was.';
  }
}

/** The report's line for a file that cannot play, with what to do. */
export function unplayableIssue(name: string, probe: MediaProbe, mediaId: string): ImportIssue {
  return {
    severity: 'warning',
    code: 'unplayable-media',
    message: `Drashti cannot play ${name} as it is: ${probe.format}. Convert it here (in the report, or in the media list).`,
    fix: { kind: 'convert-media', mediaId, advice: unplayableAdvice(probe) },
  };
}
