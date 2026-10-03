/*
 * Converting media Drashti cannot play, with the bundled FFmpeg: one file at
 * a time, in the background at low priority. The original is never changed
 * or deleted; the converted file goes into Drashti's media folder and
 * everything that used the original uses it. Undo puts the original back.
 */

export type ConversionState = 'waiting' | 'converting' | 'done' | 'failed' | 'cancelled';

export interface ConversionJob {
  id: string;
  /** The original. */
  mediaId: string;
  name: string;
  state: ConversionState;
  /** 0 to 1 while converting, when it can be told. */
  progress: number | null;
  /** Why it waits (the stream, the disk), in words. */
  note: string | null;
  /** What went wrong, in words. */
  message: string | null;
  /** When done: the converted copy, its name, and the conversion (for Undo). */
  convertedId: string | null;
  convertedName: string | null;
  conversionId: string | null;
}

export type ConvertResult = { ok: true; jobs: ConversionJob[] } | { ok: false; message: string };

/** HEVC plays where the computer can decode it: the window asks Chromium (a common profile). */
export const HEVC_TYPE = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

/** Is this media item's format HEVC (offered for conversion only where it cannot play)? */
export const isHevc = (format: string | null): boolean => format?.includes('HEVC') ?? false;
