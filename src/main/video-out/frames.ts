import type { FromProgram } from '../stream/worker/protocol';
import type { VideoOutWorkerStatus } from './protocol';

/*
 * In the video-out process: the stream's page's frames as they come (the stream's own messages: a 'format', then a
 * 'video' for each frame, raw), handed to the sender one at a time. Nothing waits in memory: a frame that comes while
 * the one before is still going out is let go (counted), so a slow receiver never holds the stream's page.
 */

export type RawFormat = 'I420' | 'NV12' | 'BGRA' | 'RGBA';

export interface RawFrame {
  format: RawFormat;
  width: number;
  height: number;
  /** Tightly packed, as VideoFrame.copyTo gives it: I420's three planes, NV12's two, or four bytes a pixel. */
  data: Uint8Array;
}

/** Where frames go: the tests' stand-in, or Drashti's small program for this computer's way. */
export interface Sender {
  /** Take this frame: false when the one before is still going out (this one is let go). */
  frame(frame: RawFrame): boolean;
  /** The sender cannot work, in plain words (its program missing or ended), or null. */
  error(): string | null;
  stop(): void;
}

/** Bytes a frame of this format and size holds, tightly packed. */
export function frameBytes(format: RawFormat, width: number, height: number): number {
  const half = (n: number) => Math.ceil(n / 2);
  switch (format) {
    case 'I420':
    case 'NV12':
      return width * height + 2 * half(width) * half(height);
    case 'BGRA':
    case 'RGBA':
      return width * height * 4;
  }
}

/** How often the process says how it is going (and once at the first frame). */
export const REPORT_MS = 1000;

/** A still picture goes out again this often, so software that starts receiving later gets it. */
export const REPEAT_MS = 500;

export class FrameReceiver {
  private format: { format: RawFormat; width: number; height: number } | null = null;
  private frames = 0;
  private dropped = 0;
  private lastReport = Number.NEGATIVE_INFINITY;
  private wrongSize = false;
  /** The newest picture (taken or let go), and when it last went out or came. */
  private last: RawFrame | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly sender: Sender,
    private readonly report: (status: VideoOutWorkerStatus) => void,
    private readonly now: () => number,
    private readonly log: (level: 'info' | 'warn', message: string) => void = () => undefined,
  ) {}

  fromProgram(message: FromProgram): void {
    if (message.kind === 'format') {
      this.format = { format: message.format, width: message.width, height: message.height };
      this.log(
        'info',
        `Frames come as ${message.format} at ${String(message.width)}x${String(message.height)}`,
      );
      return;
    }
    if (message.kind !== 'video') return;
    const format = this.format;
    if (!format) return;
    const data = new Uint8Array(message.data);
    if (data.byteLength !== frameBytes(format.format, format.width, format.height)) {
      // Not the frame its format said: let go, said once.
      if (!this.wrongSize)
        this.log('warn', `A frame of ${String(data.byteLength)} bytes did not match its format`);
      this.wrongSize = true;
      return;
    }
    const frame = { ...format, data };
    if (this.sender.frame(frame)) this.frames++;
    else this.dropped++;
    const t = this.now();
    this.last = frame;
    this.lastAt = t;
    if (this.frames === 1 || t - this.lastReport >= REPORT_MS) {
      this.lastReport = t;
      this.report(this.status());
    }
  }

  /**
   * The newest picture again once nothing has gone out for REPEAT_MS (a still picture, or one let go while the one
   * before was going out): software that starts receiving later gets it. Not counted as a new frame.
   */
  repeat(): void {
    const last = this.last;
    if (!last) return;
    const t = this.now();
    if (t - this.lastAt < REPEAT_MS) return;
    if (this.sender.frame(last)) this.lastAt = t;
  }

  status(): VideoOutWorkerStatus {
    return {
      frames: this.frames,
      dropped: this.dropped,
      size: this.format ? { width: this.format.width, height: this.format.height } : null,
      error: this.sender.error(),
    };
  }
}

/** One pixel's colour from video's Y, U and V (BT.709, limited range, as Chromium's captures are). */
function rgbOf(y: number, u: number, v: number): [number, number, number] {
  const c = 1.164 * (y - 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return [
    clamp(c + 1.793 * (v - 128)),
    clamp(c - 0.213 * (u - 128) - 0.533 * (v - 128)),
    clamp(c + 2.112 * (u - 128)),
  ];
}

/** The mean colour of a small square in the middle of the frame, as [r, g, b]. */
export function middleColour(frame: RawFrame): [number, number, number] {
  const { format, width: w, height: h, data } = frame;
  const side = Math.max(1, Math.min(8, w, h));
  const x0 = Math.max(0, (w >> 1) - (side >> 1));
  const y0 = Math.max(0, (h >> 1) - (side >> 1));
  const sum = [0, 0, 0];
  const cw = Math.ceil(w / 2);
  const ch = Math.ceil(h / 2);
  for (let y = y0; y < y0 + side; y++) {
    for (let x = x0; x < x0 + side; x++) {
      let rgb: [number, number, number];
      if (format === 'I420' || format === 'NV12') {
        const Y = data[y * w + x] ?? 0;
        const c = (y >> 1) * cw + (x >> 1);
        const U = format === 'I420' ? (data[w * h + c] ?? 128) : (data[w * h + 2 * c] ?? 128);
        const V = format === 'I420' ? (data[w * h + cw * ch + c] ?? 128) : (data[w * h + 2 * c + 1] ?? 128);
        rgb = rgbOf(Y, U, V);
      } else {
        const i = (y * w + x) * 4;
        const a = data[i] ?? 0;
        const b = data[i + 1] ?? 0;
        const c = data[i + 2] ?? 0;
        rgb = format === 'RGBA' ? [a, b, c] : [c, b, a];
      }
      sum[0] = (sum[0] ?? 0) + rgb[0];
      sum[1] = (sum[1] ?? 0) + rgb[1];
      sum[2] = (sum[2] ?? 0) + rgb[2];
    }
  }
  const n = side * side;
  return [Math.round((sum[0] ?? 0) / n), Math.round((sum[1] ?? 0) / n), Math.round((sum[2] ?? 0) / n)];
}
