import { formatBytes, formatDuration } from './format';
import { playedWords } from './play-history';

/*
 * Media information… (alpha.20: the owner's Q60-34 item 1, and his "Yes, all A" to Q60-39): what a video's or a sound's
 * file holds, as the bundled FFmpeg reads it in the main process (main/media/media-details.ts), and the words its window
 * shows (library/MediaInfoDialog.tsx) and its Copy gives. It only reads: the file, the library and the show never change.
 */

/** A moving picture in the file. */
export interface PictureTrack {
  /** Its codec by FFmpeg's name ("h264"), and for people ("H.264"). */
  codec: string;
  codecName: string;
  /** Its profile as FFmpeg names it ("High", "Main 10", "Profile 1", "HQ"); null when it names none. */
  profile: string | null;
  /** Its level, read from the file's own codec record for H.264 and HEVC ("3.1"); null where it was not read. */
  level: string | null;
  /** FFmpeg's name for its pixels ("yuv420p10le"); '' when FFmpeg names none. */
  pixFmt: string;
  /** Bits for each colour (8, 10, 12, 16); null when its pixels do not say. */
  bitDepth: number | null;
  /** How its colour is kept: "4:2:0", "4:2:2", "4:4:4", "4:1:1", "RGB" or "Greyscale"; null when not known. */
  chroma: string | null;
  /** HDR, by how its light is coded: PQ (smpte2084) or HLG (arib-std-b67); null for an ordinary picture. */
  hdr: 'pq' | 'hlg' | null;
  /** It carries transparency. */
  alpha: boolean;
  width: number;
  height: number;
  /** The shape of its pixels ("64:45") and of the picture ("16:9"), as FFmpeg says them; null when it says none. */
  sar: string | null;
  dar: string | null;
  /** Frames a second; null when FFmpeg says none. */
  fps: number | null;
  /** Progressive, or interlaced with which field first; null when FFmpeg does not say. */
  scan: 'progressive' | 'top first' | 'bottom first' | null;
  bitRateKbps: number | null;
  /** Its language for people ("English") and its own name; null when the file gives none. */
  language: string | null;
  title: string | null;
}

/** A sound track in the file. */
export interface SoundTrack {
  codec: string;
  codecName: string;
  /** "LC", "HE-AAC"; null when FFmpeg names none. */
  profile: string | null;
  sampleRateHz: number | null;
  /** Its channels as FFmpeg names them ("mono", "stereo", "5.1(side)", "3 channels"); null when not said. */
  channels: string | null;
  /** Bits a sample, for uncompressed and lossless sound (16, 24); null for any other. */
  bitDepth: number | null;
  bitRateKbps: number | null;
  language: string | null;
  title: string | null;
}

/** Captions carried inside the file (Drashti shows a caption file kept beside the video, not these). */
export interface CaptionTrack {
  codec: string;
  codecName: string;
  language: string | null;
  title: string | null;
}

/** A sound file's cover picture (an MP3's or an M4A's own picture). */
export interface CoverPicture {
  codecName: string;
  width: number;
  height: number;
}

/** What FFmpeg read in the file. */
export interface FileRead {
  /** Its container for people ("MP4", "QuickTime", "Matroska", "MP3"); null when FFmpeg names none. */
  container: string | null;
  durationMs: number | null;
  bitRateKbps: number | null;
  /** The file's own title, when it has one. */
  title: string | null;
  pictures: PictureTrack[];
  sounds: SoundTrack[];
  captions: CaptionTrack[];
  cover: CoverPicture | null;
  /** How many chapters it marks. */
  chapters: number;
}

/** How Drashti plays it now, from its library. */
export type InDrashti =
  | { state: 'plays' }
  /** HEVC, or a file judged by its header alone: it plays as it is where this computer can draw it. */
  | { state: 'maybe' }
  /** Converted: everything uses its copy. */
  | { state: 'converted'; copy: string }
  /** A copy Drashti made of another file, which plays. */
  | { state: 'copy'; of: string }
  | { state: 'converting' }
  /** Drashti cannot play it as it is: what it is, in words. */
  | { state: 'cannot'; format: string }
  | { state: 'missing' };

export interface MediaDetails {
  mediaId: string;
  name: string;
  kind: 'video' | 'audio';
  /** Its file's size; null while missing. */
  bytes: number | null;
  /** Its length as the library knows it (ms), for when FFmpeg did not read it. */
  libraryDurationMs: number | null;
  /** When it came in (ISO-8601) and from where (the original's path); null when not known. */
  importedAt: string | null;
  importedFrom: string | null;
  inDrashti: InDrashti;
  /** How many times it has gone up and when it last did (alpha.20); left out by an older Main. */
  plays?: { count: number; lastAt: string | null };
  /** What FFmpeg read just now; null when it could not (`problem` says why). */
  read: FileRead | null;
  /** Why the file was not read, in words; null when it was. */
  problem: string | null;
}

export type MediaDetailsResult = { ok: true; details: MediaDetails } | { ok: false; message: string };

/** What the window adds from the library's other answers: its start and end points and markers, its Even loudness. */
export interface DetailExtras {
  points?: { startMs: number | null; endMs: number | null; markers: number } | null;
  loudness?: { even: boolean; measured: boolean; lufs: number | null; gainDb: number } | null;
  /** RED STUB (a22-review-fadecopies S5): not said yet. */
  pageCopies?: number[] | null;
}

export interface DetailRow {
  label: string;
  value: string;
}

export interface DetailSection {
  heading: string;
  rows: DetailRow[];
}

/** The window's title, and the first line of what Copy gives. */
export const detailsTitle = (name: string): string => `Media information: ${name}`;

/** A number with at most `places` decimals, none that are 0 at its end ("44.1", "48", "29.97"). */
function short(n: number, places: number): string {
  return String(Number(n.toFixed(places)));
}

/** A bit rate: "192 kb/s", or from 1,000 kb/s "17.8 Mb/s". */
export function bitRateWords(kbps: number): string {
  return kbps < 1000 ? `${String(Math.round(kbps))} kb/s` : `${short(kbps / 1000, 1)} Mb/s`;
}

/** A sample rate: "48 kHz", "44.1 kHz", "22.05 kHz". */
export const sampleRateWords = (hz: number): string => `${short(hz / 1000, 3)} kHz`;

/** A frame rate: "25 a second", "29.97 a second". */
export const frameRateWords = (fps: number): string => `${short(fps, 3)} a second`;

/** Channels as FFmpeg names them, for people: "Mono", "Stereo", "5.1 surround", "3 channels". */
export function channelWords(channels: string): string {
  const layout = channels.replace(/\(.*\)$/u, '').trim();
  if (layout === 'mono') return 'Mono';
  if (layout === 'stereo') return 'Stereo';
  if (/^\d\.\d$/u.test(layout) && Number(layout[0]) >= 5) return `${layout} surround`;
  if (layout === 'quad') return 'Quad (4 channels)';
  return layout.charAt(0).toUpperCase() + layout.slice(1);
}

/** The shapes a picture is said by ("16:9"), with their width over height. */
const SHAPES: readonly [string, number][] = [
  ['16:9', 16 / 9],
  ['4:3', 4 / 3],
  ['1:1', 1],
  ['16:10', 16 / 10],
  ['21:9', 21 / 9],
  ['3:2', 3 / 2],
  ['5:4', 5 / 4],
  ['1.85:1', 1.85],
  ['2.39:1', 2.39],
  ['9:16', 9 / 16],
  ['3:4', 3 / 4],
  ['4:5', 4 / 5],
  ['2:3', 2 / 3],
];

/** A shape's common name ("16:9") when it is within 1% of one; null otherwise. */
export function shapeName(width: number, height: number): string | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  const found = SHAPES.find(([, r]) => Math.abs(ratio / r - 1) <= 0.01);
  return found ? found[0] : null;
}

/** "a:b" as two numbers; null when it is not one. */
function ratioOf(text: string | null): [number, number] | null {
  const m = text ? /^(\d+):(\d+)$/u.exec(text) : null;
  const a = Number(m?.[1]);
  const b = Number(m?.[2]);
  return m && a > 0 && b > 0 ? [a, b] : null;
}

/** A picture's size and shape: "1920 × 1080 (16:9)", or "720 × 576, shown as 16:9" when its pixels are not square. */
export function sizeWords(track: Pick<PictureTrack, 'width' | 'height' | 'sar' | 'dar'>): string {
  const size = `${String(track.width)} × ${String(track.height)}`;
  const sar = ratioOf(track.sar);
  const dar = ratioOf(track.dar);
  if (sar && sar[0] !== sar[1]) {
    const shown = dar ? (shapeName(dar[0], dar[1]) ?? `${String(dar[0])}:${String(dar[1])}`) : null;
    return shown ? `${size}, shown as ${shown}` : size;
  }
  const shape = dar ? shapeName(dar[0], dar[1]) : shapeName(track.width, track.height);
  return shape ? `${size} (${shape})` : size;
}

/** A picture's colour: "4:2:0", "4:2:0, HDR (PQ)", "4:4:4, with transparency". */
export function colourWords(track: Pick<PictureTrack, 'chroma' | 'hdr' | 'alpha'>): string | null {
  const parts = [
    ...(track.chroma ? [track.chroma] : []),
    ...(track.hdr === 'pq' ? ['HDR (PQ)'] : track.hdr === 'hlg' ? ['HDR (HLG)'] : []),
    ...(track.alpha ? ['with transparency'] : []),
  ];
  return parts.length > 0 ? parts.join(', ') : null;
}

/** A profile and level: "High, level 3.1", "Main 10", "Level 4" (with no profile named). */
export function profileWords(profile: string | null, level: string | null): string | null {
  if (profile && level) return `${profile}, level ${level}`;
  if (profile) return profile;
  return level ? `Level ${level}` : null;
}

const SCAN: Record<NonNullable<PictureTrack['scan']>, string> = {
  progressive: 'Progressive',
  'top first': 'Interlaced, top field first',
  'bottom first': 'Interlaced, bottom field first',
};

/** How Drashti plays it, in words. */
export function playsWords(inDrashti: InDrashti): string {
  switch (inDrashti.state) {
    case 'plays':
      return 'As it is';
    case 'maybe':
      return 'As it is, where this computer can draw it';
    case 'converted':
      return `Converted: everything uses “${inDrashti.copy}”`;
    case 'copy':
      return `As it is: a copy Drashti made of “${inDrashti.of}”`;
    case 'converting':
      return 'Being converted to a copy that plays';
    case 'cannot':
      return `Not as it is (${inDrashti.format}): convert it in Media`;
    case 'missing':
      return 'Its file is missing';
  }
}

/** Its start and end points: "The whole file", "From 0:05", "Up to 1:02:00", "0:05 to 1:02:00". */
export function pointsWords(startMs: number | null, endMs: number | null): string {
  if (startMs === null && endMs === null) return 'The whole file';
  if (endMs === null) return `From ${formatDuration(startMs ?? 0)}`;
  if (startMs === null) return `Up to ${formatDuration(endMs)}`;
  return `${formatDuration(startMs)} to ${formatDuration(endMs)}`;
}

/** Its Even loudness: "Measured at -23.1 LUFS, played 5.1 dB louder", "Off: played as it is in its file". */
export function loudnessWords(l: NonNullable<DetailExtras['loudness']>): string {
  if (!l.even) return 'Off: played as it is in its file';
  if (!l.measured) return 'Not measured yet';
  if (l.lufs === null) return 'No sound to measure';
  const at = `Measured at ${short(l.lufs, 1)} LUFS`;
  if (Math.abs(l.gainDb) < 0.05) return `${at}, played as it is`;
  return `${at}, played ${short(Math.abs(l.gainDb), 1)} dB ${l.gainDb > 0 ? 'louder' : 'quieter'}`;
}

/** Rows, leaving out the ones with nothing to say. */
function rows(pairs: [string, string | null | undefined][]): DetailRow[] {
  return pairs.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

/** A heading for one of several tracks: "Sound 1 of 2"; "Sound" when it is the only one. */
const numbered = (word: string, i: number, n: number): string =>
  n > 1 ? `${word} ${String(i + 1)} of ${String(n)}` : word;

/** The date it came in, as this computer writes dates ("20 Nov 2026"). */
function dateWords(iso: string, locale?: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(at);
}

/**
 * The window's parts, in order: the file, each picture, each sound track (the first is the one Drashti plays), the
 * captions and the cover in it, and how Drashti plays it. Only what is known is said.
 */
export function detailSections(d: MediaDetails, extras: DetailExtras = {}, locale?: string): DetailSection[] {
  const read = d.read;
  const durationMs = read?.durationMs ?? d.libraryDurationMs;
  const sections: DetailSection[] = [
    {
      heading: 'The file',
      rows: rows([
        ['What it is', d.kind === 'video' ? 'Video' : 'Sound'],
        ['Container', read?.container],
        ['Length', durationMs !== null && durationMs >= 0 ? formatDuration(durationMs) : null],
        ['Size', d.bytes !== null ? formatBytes(d.bytes) : null],
        ['Bit rate', read?.bitRateKbps ? bitRateWords(read.bitRateKbps) : null],
        ['Title', read?.title],
        ['Chapters', read && read.chapters > 0 ? String(read.chapters) : null],
        ['Imported', d.importedAt ? dateWords(d.importedAt, locale) : null],
        ['From', d.importedFrom],
      ]),
    },
  ];
  const pictures = read?.pictures ?? [];
  pictures.forEach((p, i) => {
    sections.push({
      heading: numbered('Picture', i, pictures.length),
      rows: rows([
        ['Codec', p.codecName],
        ['Profile', profileWords(p.profile, p.level)],
        ['Bit depth', p.bitDepth !== null ? `${String(p.bitDepth)}-bit` : null],
        ['Colour', colourWords(p)],
        ['Size', p.width > 0 && p.height > 0 ? sizeWords(p) : null],
        ['Frame rate', p.fps ? frameRateWords(p.fps) : null],
        ['Scan', p.scan ? SCAN[p.scan] : null],
        ['Bit rate', p.bitRateKbps ? bitRateWords(p.bitRateKbps) : null],
        ['Language', p.language],
        ['Title', p.title],
      ]),
    });
  });
  const sounds = read?.sounds ?? [];
  sounds.forEach((s, i) => {
    sections.push({
      heading: numbered('Sound', i, sounds.length),
      rows: rows([
        ['Codec', s.codecName],
        ['Profile', s.profile],
        ['Sample rate', s.sampleRateHz ? sampleRateWords(s.sampleRateHz) : null],
        ['Channels', s.channels ? channelWords(s.channels) : null],
        ['Bit depth', s.bitDepth !== null ? `${String(s.bitDepth)}-bit` : null],
        ['Bit rate', s.bitRateKbps ? bitRateWords(s.bitRateKbps) : null],
        ['Language', s.language],
        ['Title', s.title],
        // Drashti plays a file's first sound track (choosing another is Edit Video…'s, in alpha.21).
        ['Played', sounds.length > 1 ? (i === 0 ? 'Yes' : 'No: Drashti plays the first') : null],
      ]),
    });
  });
  const captions = read?.captions ?? [];
  if (captions.length > 0)
    sections.push({
      heading: 'Captions in the file',
      rows: captions.map((c, i) => ({
        label: `Captions ${String(i + 1)}`,
        value: [c.language, c.title, c.codecName].filter((x): x is string => !!x).join(' · '),
      })),
    });
  if (read?.cover)
    sections.push({
      heading: 'Cover picture',
      rows: [
        {
          label: 'Picture',
          value: `${read.cover.codecName}, ${String(read.cover.width)} × ${String(read.cover.height)}`,
        },
      ],
    });
  const points = extras.points;
  sections.push({
    heading: 'In Drashti',
    rows: rows([
      ['Plays', playsWords(d.inDrashti)],
      ['Start and end', points ? pointsWords(points.startMs, points.endMs) : null],
      [
        'Markers',
        points && points.markers > 0
          ? `${String(points.markers)} marker${points.markers === 1 ? '' : 's'}`
          : null,
      ],
      ['Even loudness', extras.loudness ? loudnessWords(extras.loudness) : null],
      ['Played', d.plays ? playedWords(d.plays.count, d.plays.lastAt, locale) : null],
    ]),
  });
  return sections;
}

/** What Copy gives: the title, why the file was not read (if it was not), then each part and its lines. */
export function detailsText(d: MediaDetails, sections: readonly DetailSection[]): string {
  const lines = [detailsTitle(d.name)];
  if (d.problem) lines.push(d.problem);
  for (const section of sections) {
    lines.push('', section.heading);
    for (const row of section.rows) lines.push(`  ${row.label}: ${row.value}`);
  }
  return `${lines.join('\n')}\n`;
}
