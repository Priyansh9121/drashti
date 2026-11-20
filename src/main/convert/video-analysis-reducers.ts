import type { WaveformData } from '../../shared/video-analysis';

/** Streaming reducers; the source's PCM and FFmpeg log are never kept whole. */
export class WaveformReducer {
  constructor(private readonly durationMs: number) {}
  push(_chunk: Buffer): void {}
  finish(): WaveformData {
    return { durationMs: this.durationMs, peaks: [] };
  }
}
export class SceneReducer {
  constructor(_durationMs: number) {}
  push(_chunk: Buffer): void {}
  finish(): number[] {
    return [];
  }
}
