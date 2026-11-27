import { describe, expect, it } from 'vitest';
import { readTestWav, streamTestSoundFile } from './stream-test-sound';
import { switchesFor } from './switches';

/*
 * The stream-clock seam (alpha.23, cap-realc; lead 2): tests only, the stream's page plays a generated clip inside its
 * own audio graph, on that graph's clock, in place of its sound input, so the clip cannot drift against the graph as
 * Chromium's fake microphone did on CI's Mac (cap-realc.md). Never in a packaged Drashti, never without Chromium's fake
 * devices (so never in front of a real microphone).
 */

const WAV = '/placeholder/test-results/clips.wav';
const env = (more: Record<string, string> = {}) => ({
  DRASHTI_TEST_FAKE_DEVICES: '1',
  DRASHTI_TEST_STREAM_SOUND_FILE: WAV,
  ...more,
});
/** What index.ts gives the seam: the two switches as switches.ts reads them. */
const seam = (packaged: boolean, given: Record<string, string>, platform: NodeJS.Platform = 'darwin') => {
  const sw = switchesFor(packaged, given);
  return streamTestSoundFile({
    fakeDevices: sw('DRASHTI_TEST_FAKE_DEVICES') === '1',
    file: sw('DRASHTI_TEST_STREAM_SOUND_FILE'),
    platform,
  });
};

/** A 16-bit PCM WAV file's bytes. */
function wav(samples: number[], rate = 16_000, channels = 1, bits = 16): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe('the stream-clock seam (tests only)', () => {
  it('unpackaged, with Chromium’s fake devices: the stream’s page plays this file on its own clock', () => {
    expect(seam(false, env())).toBe(WAV);
    expect(seam(false, env({ DRASHTI_TEST_STREAM_SOUND_FILE: 'C:\\placeholder\\clips.wav' }), 'win32')).toBe(
      'C:\\placeholder\\clips.wav',
    );
  });

  it('packaged: nothing, whatever the environment says (the self-tests included)', () => {
    expect(seam(true, env())).toBeNull();
    expect(seam(true, env({ DRASHTI_SELFTEST: 'performance' }))).toBeNull();
    expect(seam(true, env({ DRASHTI_SELFTEST: 'ffmpeg' }), 'win32')).toBeNull();
  });

  it('never without Chromium’s fake devices, and never a path that is not an absolute .wav', () => {
    expect(seam(false, { DRASHTI_TEST_STREAM_SOUND_FILE: WAV })).toBeNull();
    for (const file of ['', 'clips.wav', '/placeholder/clips.mp3', '/placeholder/clips.wav.txt'])
      expect(seam(false, env({ DRASHTI_TEST_STREAM_SOUND_FILE: file })), file).toBeNull();
    expect(seam(false, env(), 'win32')).toBeNull();
  });

  it('reads a 16-bit PCM, one-channel WAV file; anything else is no clip', () => {
    expect(readTestWav(wav([0, 1000, -1000, 32767]))).toEqual({
      rate: 16_000,
      samples: Int16Array.from([0, 1000, -1000, 32767]),
    });
    expect(readTestWav(wav([0, 0], 48_000))?.rate).toBe(48_000);
    expect(readTestWav(wav([0, 0], 16_000, 2))).toBeNull();
    expect(readTestWav(Buffer.from('not a wav file at all, placeholder bytes'))).toBeNull();
    // At most ten minutes of sound.
    expect(readTestWav(wav(Array.from({ length: 16_000 * 600 + 1 }, () => 0)))).toBeNull();
  });
});
