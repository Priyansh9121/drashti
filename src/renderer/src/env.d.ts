/// <reference types="vite/client" />
import type { DrashtiBridge } from '../../shared/bridge';

declare global {
  interface Window {
    /** Exposed by the preload script; the renderer's only way to reach the main process. */
    readonly drashti: DrashtiBridge;
    /** Output windows: the last painted engine revisions and when (for latency checks). */
    drashtiPaintLog?: { rev: number; sentAt: number; paintedAt: number; wallAt: number }[];
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
