import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegHere, testFfmpeg } from './ffmpeg-here';

/* The FFmpeg tests' rule (Sessions 31–36, TST-12): skipped where FFmpeg is not fetched, failing on CI's Mac and Windows. */

const MISSING = '/no/such/placeholder/ffmpeg';

describe('ffmpegHere', () => {
  it('skips where FFmpeg is not fetched: a computer of one’s own, or CI’s Ubuntu checks', () => {
    expect(ffmpegHere(MISSING, {}, 'darwin')).toBe(false);
    expect(ffmpegHere(MISSING, { CI: 'true' }, 'linux')).toBe(false);
  });

  it('fails on CI’s Mac and Windows runners, which fetch it first', () => {
    expect(() => ffmpegHere(MISSING, { CI: 'true' }, 'darwin')).toThrow(
      /FFmpeg is missing on a CI Mac runner/u,
    );
    expect(() => ffmpegHere(MISSING, { CI: 'true' }, 'win32')).toThrow(
      /FFmpeg is missing on a CI Windows runner/u,
    );
  });

  it('runs them where it is there', () => {
    expect(ffmpegHere(process.execPath, { CI: 'true' }, 'darwin')).toBe(true);
  });
});

/* Which FFmpeg a test runs (Session 58, CI-1): Drashti's own, or on Linux, for a test proven there, CI's own. */

describe('testFfmpeg', () => {
  const checkout = join('/', 'placeholder', 'checkout');

  it('gives a test proven on Linux CI’s own Linux FFmpeg there (scripts/fetch-ci-ffmpeg.mjs)', () => {
    expect(testFfmpeg({ linux: true }, checkout, 'linux', 'x64')).toBe(
      join(checkout, 'vendor', 'ffmpeg-ci', 'linux-x64', 'ffmpeg'),
    );
  });

  it('gives every other test, and every test on a Mac or Windows, the FFmpeg Drashti bundles', () => {
    expect(testFfmpeg({}, checkout, 'linux', 'x64')).toBe(
      join(checkout, 'vendor', 'ffmpeg', 'linux-x64', 'ffmpeg'),
    );
    expect(testFfmpeg({ linux: true }, checkout, 'darwin', 'arm64')).toBe(
      join(checkout, 'vendor', 'ffmpeg', 'darwin-arm64', 'ffmpeg'),
    );
    expect(testFfmpeg({ linux: true }, checkout, 'win32', 'x64')).toBe(
      join(checkout, 'vendor', 'ffmpeg', 'win32-x64', 'ffmpeg.exe'),
    );
  });
});
