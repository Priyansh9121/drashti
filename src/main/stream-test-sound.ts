import { posix, win32 } from 'node:path';
import type { StreamTestSound } from '../shared/stream';

/*
 * The stream-clock seam, for the tests only (alpha.23, cap-realc; never a packaged Drashti: switches.ts honours no
 * DRASHTI_TEST_* there). With DRASHTI_TEST_STREAM_SOUND_FILE and Chromium's fake devices (DRASHTI_TEST_FAKE_DEVICES=1),
 * the stream's page plays that generated WAV file inside its own audio graph, on that graph's clock, in place of its
 * sound input: the stream's delay, mix, meter and speech tap hear it as they hear a mixer's feed, and it cannot drift
 * against the graph as Chromium's fake microphone did on CI's Mac (a file read by a timer that fell behind real time,
 * so the graph played gaps and dropped what came late: cap-realc.md). Only with the fake devices, so a clip never
 * stands in front of a real microphone.
 */

/** The clip's file, or null: only with Chromium's fake devices, and only an absolute path to a .wav file. */
export function streamTestSoundFile(o: {
  fakeDevices: boolean;
  file: string | undefined;
  platform: NodeJS.Platform;
}): string | null {
  const file = o.file;
  if (!o.fakeDevices || !file) return null;
  // Windows: a drive's or a share's whole path (a path from the root of "the current drive" is not one).
  const absolute =
    o.platform === 'win32'
      ? /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/])/iu.test(file) && win32.isAbsolute(file)
      : posix.isAbsolute(file);
  return absolute && /\.wav$/iu.test(file) ? file : null;
}

/** At most ten minutes of sound. */
const MOST_SECONDS = 600;

/** A 16-bit PCM, one-channel WAV file's sound, or null for anything else. */
export function readTestWav(bytes: Buffer): StreamTestSound | null {
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    return null;
  let at = 12;
  let rate = 0;
  let data: Buffer | null = null;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
    if (id === 'fmt ') {
      if (
        body.length < 16 ||
        body.readUInt16LE(0) !== 1 ||
        body.readUInt16LE(2) !== 1 ||
        body.readUInt16LE(14) !== 16
      )
        return null;
      rate = body.readUInt32LE(4);
    } else if (id === 'data') data = body;
    at += 8 + size + (size % 2);
  }
  if (!rate || rate < 8_000 || rate > 96_000 || !data || data.length < 2) return null;
  const count = Math.floor(data.length / 2);
  if (count > rate * MOST_SECONDS) return null;
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = data.readInt16LE(i * 2);
  return { rate, samples };
}
