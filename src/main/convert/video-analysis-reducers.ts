import { WAVEFORM_BUCKETS, type WaveformData } from '../../shared/video-analysis';

/** One min/max bucket per source interval, streaming mono signed little-endian PCM. */
export class WaveformReducer {
  private readonly lows: Float32Array;
  private readonly highs: Float32Array;
  private readonly samples: number;
  private offset = 0;
  private lowByte: number | null = null;
  constructor(
    private readonly durationMs: number,
    sampleRate = 1000,
  ) {
    this.samples = Math.max(1, Math.ceil((durationMs * sampleRate) / 1000));
    const count = Math.min(WAVEFORM_BUCKETS, this.samples);
    this.lows = new Float32Array(count).fill(Number.POSITIVE_INFINITY);
    this.highs = new Float32Array(count).fill(Number.NEGATIVE_INFINITY);
  }
  push(chunk: Buffer): void {
    for (const byte of chunk) {
      if (this.lowByte === null) {
        this.lowByte = byte;
        continue;
      }
      const raw = this.lowByte | (byte << 8);
      this.lowByte = null;
      const sample = (raw >= 32768 ? raw - 65536 : raw) / 32768;
      if (this.offset < this.samples) {
        const at = Math.min(
          this.lows.length - 1,
          Math.floor((this.offset * this.lows.length) / this.samples),
        );
        this.lows[at] = Math.min(this.lows[at] ?? sample, sample);
        this.highs[at] = Math.max(this.highs[at] ?? sample, sample);
      }
      this.offset++;
    }
  }
  finish(): WaveformData {
    if (this.offset === 0 || this.lowByte !== null) throw new Error('No complete audio samples were read.');
    return {
      durationMs: this.durationMs,
      peaks: Array.from(this.lows, (low, i) => (Number.isFinite(low) ? [low, this.highs[i] ?? low] : [0, 0])),
    };
  }
}

/** Only FFmpeg metadata's frame lines carry times; retain no more than 50 valid suggestions. */
export class SceneReducer {
  private tail = '';
  private readonly cuts: number[] = [];
  constructor(private readonly durationMs: number) {}
  private line(text: string): void {
    if (this.cuts.length >= 50) return;
    const value = /^frame:\d+\s+pts:\S+\s+pts_time:(\d+(?:\.\d+)?)(?:\s|$)/u.exec(text);
    if (!value) return;
    const ms = Math.round(Number(value[1]) * 1000);
    if (ms > 0 && ms < this.durationMs && !this.cuts.includes(ms)) this.cuts.push(ms);
  }
  push(chunk: Buffer): void {
    const text = this.tail + chunk.toString();
    const lines = text.split(/\r?\n/u);
    this.tail = (lines.pop() ?? '').slice(-1024);
    for (const line of lines) this.line(line);
  }
  finish(): number[] {
    this.line(this.tail);
    return [...this.cuts].sort((a, b) => a - b);
  }
}
