/// <reference types="vite/client" />
import type { DrashtiBridge } from '../../shared/bridge';

declare global {
  /** One painted revision in an output's paint log (the engine's clock unless said). */
  interface PaintEntry {
    rev: number;
    /** When the main process sent it. */
    sentAt: number;
    /** When it was drawn into the page, before its frame. */
    committedAt: number;
    /** Its frame. */
    paintedAt: number;
    /** Its frame, on this computer's own clock. */
    wallAt: number;
    /** The frame after it (Sessions 31–36, PERF-2), once that came. */
    nextAt?: number;
  }

  interface Window {
    /** Exposed by the preload script; the renderer's only way to reach the main process. */
    readonly drashti: DrashtiBridge;
    /** Output windows: the last painted engine revisions and when (for latency checks). */
    drashtiPaintLog?: PaintEntry[];
    /** Output windows: frames that came late since the page loaded (the soak test reads it; Session 15). */
    drashtiLateFrames?: number;
  }

  /**
   * Chromium's frames of a video or sound track, one by one (Insertable Streams for
   * MediaStreamTrack; on the window in Chromium, not yet in TypeScript's DOM types).
   */
  class MediaStreamTrackProcessor<T extends VideoFrame | AudioData = VideoFrame> {
    constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });
    readonly readable: ReadableStream<T>;
  }
}
