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
  /**
   * Get ready to encode: which FFmpeg, the preset, the encoder if one is known to work, and the
   * certificate authorities a secure address is checked against (../tls.ts).
   */
  | {
      type: 'start';
      ffmpeg: string;
      platform: NodeJS.Platform;
      preset: StreamPreset;
      encoder: string | null;
      caFile: string | null;
    }
  /**
   * Send to this address with this key, and to each of `more` with its own (Session 28: several platforms
   * at once, from one encode), again and again until `endLive`.
   */
  | { type: 'live'; url: string; key: string; more?: { id: string; url: string; key: string }[] }
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

/** One place the stream goes, as the worker has it: the profile's own (id '') first, then the others. */
export interface WorkerDestination extends WorkerLive {
  id: string;
  /** How the operator knows it: YouTube, Facebook, or the stream server. */
  name: string;
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
  /** All the places together (just the one's, with one). */
  live: WorkerLive;
  /** Each place, in order (Session 28). */
  destinations: WorkerDestination[];
  recording: WorkerRecording;
  /** Something went wrong with the encoder itself (none of the outputs can work). */
  error: string | null;
  /**
   * How long the sound given to the encoder has stayed below -50 dBFS, a second at a time (No sound,
   * Session 31: ./sound-meter.ts); 0 while it is heard, and when neither on air nor recording.
   */
  quietMs: number;
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
