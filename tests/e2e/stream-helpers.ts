import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

/*
 * For the stream's tests: the bundled FFmpeg listening for RTMP on this
 * computer stands in for YouTube (nothing ever goes to the internet), and a
 * small FLV reader checks what it received.
 */

/** A made-up stream key: never a real one. */
export const TEST_KEY = 'test-made-up-key-5f3a-0000-drashti';

export function testFfmpeg(): string | null {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const path = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);
  return existsSync(path) ? path : null;
}

/** A port nothing is listening on. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** FFmpeg waiting for one stream on rtmp://127.0.0.1:<port>/live2/<key>, saving it as FLV. */
export function rtmpListener(ffmpeg: string, port: number, file: string): ChildProcess {
  return spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-listen',
      '1',
      '-i',
      `rtmp://127.0.0.1:${port}/live2/${TEST_KEY}`,
      '-c',
      'copy',
      '-f',
      'flv',
      '-y',
      file,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
}

export interface FlvSummary {
  /** H.264 frames (not counting the codec's set-up), and their times (ms). */
  videoFrames: number;
  keyframeTimes: number[];
  /** AAC frames, and the sample rate and channels from its set-up. */
  audioFrames: number;
  aacSampleRate: number | null;
  aacChannels: number | null;
  durationMs: number;
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** What an FLV file holds: video (H.264) and audio (AAC) frames, keyframes, and AAC's set-up. */
export function readFlv(file: string): FlvSummary {
  const b = readFileSync(file);
  const out: FlvSummary = {
    videoFrames: 0,
    keyframeTimes: [],
    audioFrames: 0,
    aacSampleRate: null,
    aacChannels: null,
    durationMs: 0,
  };
  if (b.subarray(0, 3).toString() !== 'FLV') throw new Error('not an FLV file');
  let at = b.readUInt32BE(5) + 4;
  while (at + 11 <= b.length) {
    const type = b[at] ?? 0;
    const size = b.readUIntBE(at + 1, 3);
    const time = b.readUIntBE(at + 4, 3) | ((b[at + 7] ?? 0) << 24);
    const data = at + 11;
    if (data + size > b.length) break;
    if (type === 9 && size >= 2) {
      const first = b[data] ?? 0;
      const codec = first & 0x0f;
      const avcType = b[data + 1];
      if (codec === 7 && avcType === 1) {
        out.videoFrames++;
        if (first >> 4 === 1) out.keyframeTimes.push(time);
      }
    } else if (type === 8 && size >= 2) {
      const format = (b[data] ?? 0) >> 4;
      const aacType = b[data + 1];
      if (format === 10 && aacType === 0 && size >= 4) {
        // AudioSpecificConfig: 5 bits object type, 4 bits rate index, 4 bits channels.
        const config = b.readUInt16BE(data + 2);
        out.aacSampleRate = AAC_RATES[(config >> 7) & 0x0f] ?? null;
        out.aacChannels = (config >> 3) & 0x0f;
      } else if (format === 10) out.audioFrames++;
    }
    out.durationMs = Math.max(out.durationMs, time);
    at = data + size + 4;
  }
  return out;
}
