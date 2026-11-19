import type { VideoOutWay } from '../../shared/video-out';

/*
 * The main process and the video-out process (a utility process, ./worker.ts) talk in these messages. Frames never
 * pass through the main process: they come from the stream's page on a port handed to the video-out process, in
 * the stream's own messages (FromProgram in ../stream/worker/protocol.ts: 'format', then 'video' for each frame).
 */

/** Where the frames go in the video-out process. */
export type VideoOutSender =
  /** Tests only (DRASHTI_TEST_VIDEO_OUT_STAND_IN, never packaged): what arrives is written to this file. */
  | { way: 'stand-in'; file: string }
  /** Drashti's own small program for this computer's way, fed each frame on its input. */
  | { way: Exclude<VideoOutWay, 'stand-in'>; program: string };

export type ToVideoOutWorker =
  /** Get ready to send, under this name. */
  | { type: 'start'; sender: VideoOutSender; name: string }
  /** Stop sending and exit. */
  | { type: 'stop' };

export interface VideoOutWorkerStatus {
  /** Frames handed on so far. */
  frames: number;
  /** Frames let go because the one before was still going out. */
  dropped: number;
  size: { width: number; height: number } | null;
  /** The sender cannot work (its program missing or ended): said in plain words. */
  error: string | null;
}

export type FromVideoOutWorker =
  { type: 'status'; status: VideoOutWorkerStatus } | { type: 'log'; level: 'info' | 'warn'; message: string };
