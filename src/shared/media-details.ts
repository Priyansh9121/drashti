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
}

export interface DetailRow {
  label: string;
  value: string;
}

export interface DetailSection {
  heading: string;
  rows: DetailRow[];
}

/* Red (x47): the words are still to be written. */
export const detailsTitle = (_name: string): string => '';
export const bitRateWords = (_kbps: number): string => '';
export const sampleRateWords = (_hz: number): string => '';
export const frameRateWords = (_fps: number): string => '';
export const channelWords = (_channels: string): string => '';
export const shapeName = (_width: number, _height: number): string | null => null;
export const sizeWords = (_track: Pick<PictureTrack, 'width' | 'height' | 'sar' | 'dar'>): string => '';
export const colourWords = (_track: Pick<PictureTrack, 'chroma' | 'hdr' | 'alpha'>): string | null => null;
export const profileWords = (_profile: string | null, _level: string | null): string | null => null;
export const playsWords = (_inDrashti: InDrashti): string => '';
export const pointsWords = (_startMs: number | null, _endMs: number | null): string => '';
export const loudnessWords = (_l: NonNullable<DetailExtras['loudness']>): string => '';
export const detailSections = (
  _d: MediaDetails,
  _extras: DetailExtras = {},
  _locale?: string,
): DetailSection[] => [];
export const detailsText = (_d: MediaDetails, _sections: readonly DetailSection[]): string => '';
