import type { StreamHealth, StreamPreset } from '../../../shared/stream';

/*
 * The main process and the stream worker (a utility process) talk in these
 * messages. Frames and sound never pass through the main process: they come
 * straight from the stream's page on a port handed to the worker.
 *
 * The stream key reaches the worker only in `live`, and never leaves it:
 * every message back, and every log line, has it taken out first.
 */

export type ToStreamWorker =
  /** Get ready to encode: which FFmpeg, the preset, and the encoder if one is known to work. */
  | { type: 'start'; ffmpeg: string; platform: NodeJS.Platform; preset: StreamPreset; encoder: string | null }
  /** Send to this address with this key (again and again until `endLive`). */
  | { type: 'live'; url: string; key: string }
  | { type: 'endLive' }
  /** Record into this file (a new one each time). Keep this much of the disk free. */
  | { type: 'record'; file: string; keepFreeBytes: number }
  | { type: 'stopRecording'; message?: string }
  /** Stop everything and exit. */
  | { type: 'stop' };

export interface WorkerLive {
  state: 'off' | 'connecting' | 'live' | 'reconnecting';
  /** When it first went on air this time (ms since the epoch). */
  since: number | null;
  health: StreamHealth;
  bitrateKbps: number | null;
  speed: number | null;
  /** Bytes waiting to go out: grows when the connection is too slow. */
  backlogBytes: number;
  reconnects: number;
  retryAt: number | null;
  message: string | null;
}

export interface WorkerRecording {
  state: 'off' | 'recording';
  file: string | null;
  since: number | null;
  bytes: number;
  /** Bytes a second it grows by, lately. */
  rate: number | null;
  freeBytes: number | null;
  message: string | null;
}

export interface WorkerStatus {
  encoder: { name: string; label: string; hardware: boolean } | null;
  encoding: boolean;
  fps: number | null;
  /** Frames that did not make it: the encoder or the connection could not keep up. */
  droppedFrames: number;
  live: WorkerLive;
  recording: WorkerRecording;
  /** Something went wrong with the encoder itself (none of the outputs can work). */
  error: string | null;
}

export type FromStreamWorker =
  | { type: 'status'; status: WorkerStatus }
  /** Already without the key. */
  | { type: 'log'; level: 'info' | 'warn'; message: string };

/** What the stream's page sends on the encoder's port. */
export type FromProgram =
  | { kind: 'format'; width: number; height: number; format: 'I420' | 'NV12' | 'BGRA' | 'RGBA' }
  | { kind: 'video'; data: ArrayBuffer }
  /** Interleaved 32-bit float, 48 kHz stereo. */
  | { kind: 'audio'; data: ArrayBuffer; frames: number };
