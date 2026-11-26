export const FIRST_FRAME_MS: number;
export const WATCH_MS: number;
export const MIN_PLAYED: number;
export const MIN_SHOWN: number;
export const MIN_MOVES: number;
/** The check's own proof, in the spec's order: videos it must fail, each saying `mustSay`. */
export const CONTROLS: { name: string; mustSay: string }[];
/** The test videos the hall must play, in the spec's order. */
export const VIDEOS: string[];

/** One video's playback on the hall, as tests/intel-playback/intel-playback.spec.ts reads it. */
export interface PlaybackReading {
  /** The generated test video's placeholder file name. */
  name: string;
  /** What it is (codec, size, rate, sound, where its movie box is). */
  kind: string;
  /** Its frames a second. */
  fps: number;
  /** From the playlist row's click to the hall drawing its picture; null when that never came. */
  firstFrameMs: number | null;
  /** How long it was watched once its first frame was in. */
  watchedMs: number;
  /** How far the hall's video element's own clock moved on in that time, in seconds. */
  advancedS: number;
  /** Frames the hall's video element showed in the watch (getVideoPlaybackQuality: decoded less dropped, end - start). */
  presentedInWatch: number;
  /** Frames it dropped in the watch. */
  droppedInWatch: number;
  /** The different places the hall's pixels showed the picture's moving bar in, in the watch. */
  moves: number;
  /** The hall's video element's MediaError code, if it raised one. */
  errorCode: number | null;
  /** Drashti took it off (its first-frame watch, or a screen's error). */
  off: boolean;
  /** Looks (screenshots) in which the hall's picture was black while it was up. */
  black: number;
  /** Frames in which the hall's page drew black by its own markup while it was up (each frame recorded). */
  blackFrames: number;
  /** Drashti's log line saying it could not play on a screen, if any. */
  logged: string | null;
  /** The hall's looks frame by frame (the first of them), to explain a red. */
  looks: string[];
  /** The computer, and its graphics as Chromium reports them. */
  runner?: string;
  gpu?: { videoDecode: string; gpuCompositing: string; devices: string[] };
}

export function judgePlayback(reading: PlaybackReading): string[];
export function summaryLines(readings: PlaybackReading[], options?: { outcome?: string | null }): string[];
