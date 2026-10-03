/*
 * FFmpeg's progress (-progress pipe:2 -stats_period 1): blocks of key=value
 * lines, each ending with progress=continue (or progress=end). Its other
 * messages share the same pipe and are passed on as lines.
 */

export interface Progress {
  frame: number | null;
  fps: number | null;
  /** What it is writing, in kbit/s. */
  bitrateKbps: number | null;
  /** How fast it is going compared with real time (1 is keeping up). */
  speed: number | null;
  /** Frames FFmpeg dropped or repeated to keep the frame rate. */
  dropFrames: number;
  dupFrames: number;
  totalSize: number | null;
  outTimeMs: number | null;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function toProgress(fields: Record<string, string>): Progress {
  const bitrate = fields['bitrate'];
  const speed = fields['speed'];
  return {
    frame: num(fields['frame']),
    fps: num(fields['fps']),
    bitrateKbps: bitrate && bitrate !== 'N/A' ? num(bitrate.replace(/kbits\/s$/u, '')) : null,
    speed: speed && speed !== 'N/A' ? num(speed.replace(/x$/u, '')) : null,
    dropFrames: num(fields['drop_frames']) ?? 0,
    dupFrames: num(fields['dup_frames']) ?? 0,
    totalSize: num(fields['total_size']),
    outTimeMs: (() => {
      const us = num(fields['out_time_us'] ?? fields['out_time_ms']);
      return us === null ? null : us / 1000;
    })(),
  };
}

const FIELD = /^([a-z_0-9]+)=(.*)$/u;

/** Feed it FFmpeg's stderr; it calls back with each progress block, and with every other line. */
export class ProgressReader {
  private buffer = '';
  private fields: Record<string, string> = {};

  constructor(
    private readonly onProgress: (progress: Progress, ended: boolean) => void,
    private readonly onLine: (line: string) => void,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let at = this.buffer.search(/\r?\n|\r/u);
    while (at >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(
        at + (this.buffer[at] === '\r' && this.buffer[at + 1] === '\n' ? 2 : 1),
      );
      this.line(line);
      at = this.buffer.search(/\r?\n|\r/u);
    }
    // A very long line with no end (never expected): keep the buffer small.
    if (this.buffer.length > 64_000) this.buffer = this.buffer.slice(-8_000);
  }

  private line(line: string): void {
    if (line === '') return;
    const m = FIELD.exec(line);
    if (!m) {
      this.onLine(line);
      return;
    }
    const [, key = '', value = ''] = m;
    if (key === 'progress') {
      this.onProgress(toProgress(this.fields), value === 'end');
      this.fields = {};
    } else this.fields[key] = value.trim();
  }
}
