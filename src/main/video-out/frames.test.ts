import { describe, expect, it, vi } from 'vitest';
import type { FromProgram } from '../stream/worker/protocol';
import { FrameReceiver, frameBytes, middleColour, type RawFrame, REPORT_MS, type Sender } from './frames';
import type { VideoOutWorkerStatus } from './protocol';

/*
 * The video-out process's side of the stream page's frames (x30): generated frames of solid colours only.
 */

/** A solid frame in each format, from its colour's Y, U and V (BT.709, limited range) or R, G and B. */
function solid(
  format: RawFrame['format'],
  width: number,
  height: number,
  rgb: number[],
  yuv: number[],
): RawFrame {
  const data = new Uint8Array(frameBytes(format, width, height));
  const [y = 0, u = 0, v = 0] = yuv;
  const [r = 0, g = 0, b = 0] = rgb;
  const luma = width * height;
  const chroma = Math.ceil(width / 2) * Math.ceil(height / 2);
  if (format === 'I420') {
    data.fill(y, 0, luma);
    data.fill(u, luma, luma + chroma);
    data.fill(v, luma + chroma);
  } else if (format === 'NV12') {
    data.fill(y, 0, luma);
    for (let i = luma; i < data.length; i += 2) {
      data[i] = u;
      data[i + 1] = v;
    }
  } else {
    for (let i = 0; i < data.length; i += 4) {
      data.set(format === 'RGBA' ? [r, g, b, 255] : [b, g, r, 255], i);
    }
  }
  return { format, width, height, data };
}

// Pure red and pure blue, as BT.709 limited-range video has them.
const RED = { rgb: [255, 0, 0], yuv: [63, 102, 240] };
const BLUE = { rgb: [0, 0, 255], yuv: [32, 240, 118] };

describe('frames as the stream’s page gives them (x30)', () => {
  it('knows how many bytes each format holds, odd sizes rounded up for the colour planes', () => {
    expect(frameBytes('I420', 4, 2)).toBe(8 + 2 + 2);
    expect(frameBytes('NV12', 4, 2)).toBe(8 + 4);
    expect(frameBytes('I420', 5, 3)).toBe(15 + 2 * 3 * 2);
    expect(frameBytes('BGRA', 5, 3)).toBe(60);
    expect(frameBytes('RGBA', 1920, 1080)).toBe(1920 * 1080 * 4);
  });

  it('reads the middle’s colour in every format', () => {
    for (const format of ['I420', 'NV12', 'BGRA', 'RGBA'] as const) {
      for (const [name, colour] of [
        ['red', RED],
        ['blue', BLUE],
      ] as const) {
        const got = middleColour(solid(format, 33, 17, colour.rgb, colour.yuv));
        got.forEach((c, i) => {
          expect(
            Math.abs(c - (colour.rgb[i] ?? 0)),
            `${format} ${name}: ${JSON.stringify(got)}`,
          ).toBeLessThanOrEqual(3);
        });
      }
    }
  });
});

class TakingSender implements Sender {
  readonly taken: RawFrame[] = [];
  busy = false;
  failure: string | null = null;
  frame(frame: RawFrame): boolean {
    if (this.busy) return false;
    this.taken.push(frame);
    return true;
  }
  error(): string | null {
    return this.failure;
  }
  stop(): void {
    // Nothing held.
  }
}

function receiver() {
  const sender = new TakingSender();
  const reports: VideoOutWorkerStatus[] = [];
  const logs: string[] = [];
  let now = 0;
  const r = new FrameReceiver(
    sender,
    (s) => {
      reports.push(s);
    },
    () => now,
    (_level, message) => {
      logs.push(message);
    },
  );
  const video = (bytes: number): FromProgram => ({ kind: 'video', data: new ArrayBuffer(bytes) });
  return {
    r,
    sender,
    reports,
    logs,
    video,
    at: (t: number) => {
      now = t;
    },
  };
}

describe('the video-out process hands frames on one at a time (x30)', () => {
  it('waits for a frame’s format, then hands each frame on with it', () => {
    const x = receiver();
    x.r.fromProgram(x.video(12));
    expect(x.sender.taken).toHaveLength(0);
    x.r.fromProgram({ kind: 'format', width: 4, height: 2, format: 'I420' });
    x.r.fromProgram(x.video(12));
    x.r.fromProgram({ kind: 'audio', data: new ArrayBuffer(8), frames: 1 });
    expect(x.sender.taken.map((f) => [f.format, f.width, f.height, f.data.byteLength])).toEqual([
      ['I420', 4, 2, 12],
    ]);
    expect(x.r.status()).toEqual({ frames: 1, dropped: 0, size: { width: 4, height: 2 }, error: null });
  });

  it('lets go of a frame that comes while the one before is still going out, and counts it', () => {
    const x = receiver();
    x.r.fromProgram({ kind: 'format', width: 2, height: 2, format: 'RGBA' });
    x.r.fromProgram(x.video(16));
    x.sender.busy = true;
    x.r.fromProgram(x.video(16));
    x.r.fromProgram(x.video(16));
    x.sender.busy = false;
    x.r.fromProgram(x.video(16));
    expect(x.r.status()).toMatchObject({ frames: 2, dropped: 2 });
  });

  it('lets go of a frame that does not match its format, saying so once', () => {
    const x = receiver();
    x.r.fromProgram({ kind: 'format', width: 4, height: 2, format: 'NV12' });
    x.r.fromProgram(x.video(11));
    x.r.fromProgram(x.video(13));
    expect(x.sender.taken).toHaveLength(0);
    expect(x.logs.filter((l) => l.includes('did not match'))).toHaveLength(1);
    x.r.fromProgram(x.video(12));
    expect(x.sender.taken).toHaveLength(1);
  });

  it('says how it is going at the first frame, then every REPORT_MS at most, with the sender’s trouble', () => {
    const x = receiver();
    x.r.fromProgram({ kind: 'format', width: 2, height: 2, format: 'BGRA' });
    x.at(0);
    x.r.fromProgram(x.video(16));
    expect(x.reports).toEqual([{ frames: 1, dropped: 0, size: { width: 2, height: 2 }, error: null }]);
    x.at(REPORT_MS - 1);
    x.r.fromProgram(x.video(16));
    expect(x.reports).toHaveLength(1);
    x.sender.failure = 'Its program ended.';
    x.at(REPORT_MS);
    x.r.fromProgram(x.video(16));
    expect(x.reports.at(-1)).toEqual({
      frames: 3,
      dropped: 0,
      size: { width: 2, height: 2 },
      error: 'Its program ended.',
    });
  });
});

describe('the frame copy is never kept beyond its turn (x30)', () => {
  it('hands the sender a view of the frame’s own bytes', () => {
    const x = receiver();
    const spy = vi.spyOn(x.sender, 'frame');
    x.r.fromProgram({ kind: 'format', width: 2, height: 1, format: 'RGBA' });
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    x.r.fromProgram({ kind: 'video', data });
    expect(Array.from(spy.mock.calls[0]?.[0].data ?? [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
