export const FIRST_FRAME_MS: number;
export const WATCH_MS: number;
export const MIN_PLAYED: number;

/** One video's playback on the hall, as tests/intel-playback/intel-playback.spec.ts reads it. */
export interface PlaybackReading {
  /** The generated test video's placeholder file name. */
  name: string;
  /** What it is (codec, size, rate, sound, where its movie box is). */
  kind: string;
  /** From the playlist row's click to the hall drawing its picture; null when that never came. */
  firstFrameMs: number | null;
  /** How long it was watched once its first frame was in. */
  watchedMs: number;
  /** How far the hall's video element played on in that time, in seconds. */
  advancedS: number;
  /** The hall's video element's decoded and dropped frames (getVideoPlaybackQuality), at the end. */
  decodedFrames: number;
  droppedFrames: number;
  /** The hall's video element's MediaError code, if it raised one. */
  errorCode: number | null;
  /** Drashti took it off the hall (its first-frame watch, or the hall's error). */
  off: boolean;
  /** Looks in which the hall drew black while it was up. */
  black: number;
  /** Drashti's log line saying it could not play on a screen, if any. */
  logged: string | null;
  /** The check's own proof: a video the hall cannot play, which the check must fail. */
  expectFail?: boolean;
}

export function judgePlayback(reading: PlaybackReading): string[];
export function summaryLines(readings: PlaybackReading[]): string[];
