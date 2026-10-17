import { describe, expect, it } from 'vitest';
import { ffmpegHere } from './ffmpeg-here';

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
