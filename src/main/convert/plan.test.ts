import { describe, expect, it } from 'vitest';
import { chooseTarget, convertArgs, hasAlpha, parseFfmpegInfo } from './plan';

/* What FFmpeg 9.0.2 printed for generated files (src/main/convert/convert.test.ts makes the same kinds). */
const PRORES = `  Duration: 00:00:02.00, start: 0.000000, bitrate: 5333 kb/s
  Stream #0:0[0x1]: Video: prores (Standard) (apcn / 0x6E637061), yuv422p10le(tv, progressive), 320x180, 4557 kb/s, SAR 1:1 DAR 16:9, 25 fps, 25 tbr, 12800 tbn (default)
  Stream #0:1[0x2]: Audio: pcm_s16le (sowt / 0x74776F73), 48000 Hz, mono, s16, 768 kb/s (default)`;
const ALPHA = `  Duration: 00:00:02.00, start: 0.000000, bitrate: 266 kb/s
  Stream #0:0[0x1]: Video: prores (4444) (ap4h / 0x68347061), yuva444p12le(tv, progressive), 320x180, 263 kb/s, SAR 1:1 DAR 16:9, 25 fps, 25 tbr, 12800 tbn (default)`;
const AVI = `  Duration: 00:00:02.04, start: 0.000000, bitrate: 565 kb/s
  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 320x180 [SAR 1:1 DAR 16:9], 458 kb/s, 25 fps, 25 tbr, 25 tbn
  Stream #0:1: Audio: mp3 (mp3float) (U[0][0][0] / 0x0055), 44100 Hz, mono, fltp, 64 kb/s`;
const AIFF = `  Duration: 00:00:02.00, start: 0.000000, bitrate: 705 kb/s
  Stream #0:0: Audio: pcm_s16be, 44100 Hz, mono, s16, 705 kb/s`;
const HEIC = `  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0[0x1]: Video: hevc (Main Still Picture) (hvc1 / 0x31637668), yuvj420p(pc, smpte170m/unknown/unknown), 64x48, 1 fps, 1 tbr, 1 tbn (default)`;
const HEIC_TILES = `  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream group #0:0[0x19]: Tile Grid: hevc (Main Still Picture) (hvc1 / 0x31637668), yuvj420p(pc, smpte170m/unknown/unknown), 3000x2000 (default)`;
const TIFF_ALPHA = `  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: tiff, rgba, 64x48 [SAR 1:1 DAR 4:3], 25 fps, 25 tbr, 25 tbn`;

describe('what FFmpeg says a file holds', () => {
  it('reads the duration, the picture and the sound', () => {
    expect(parseFfmpegInfo(PRORES)).toEqual({
      durationMs: 2000,
      video: { codec: 'prores', pixFmt: 'yuv422p10le', width: 320, height: 180, still: false },
      audio: { codec: 'pcm_s16le' },
    });
    expect(parseFfmpegInfo(AVI).video).toMatchObject({ codec: 'mpeg4', pixFmt: 'yuv420p', width: 320 });
    expect(parseFfmpegInfo(AIFF)).toEqual({ durationMs: 2000, video: null, audio: { codec: 'pcm_s16be' } });
    expect(parseFfmpegInfo(HEIC).video).toMatchObject({ codec: 'hevc', width: 64, height: 48, still: true });
    // An iPhone's HEIC is a grid of tiles: one picture the size of the grid.
    expect(parseFfmpegInfo(HEIC_TILES).video).toMatchObject({
      codec: 'hevc',
      pixFmt: 'yuvj420p',
      width: 3000,
      height: 2000,
    });
  });

  it('knows transparency from the pixel format', () => {
    expect(hasAlpha(parseFfmpegInfo(ALPHA))).toBe(true);
    expect(hasAlpha(parseFfmpegInfo(TIFF_ALPHA))).toBe(true);
    expect(hasAlpha(parseFfmpegInfo(PRORES))).toBe(false);
  });
});

describe('what a file becomes', () => {
  it('video to H.264 MP4, with transparency to VP9 WebM, pictures to JPEG or PNG, sound to M4A', () => {
    expect(chooseTarget('video', parseFfmpegInfo(PRORES))).toBe('mp4');
    expect(chooseTarget('video', parseFfmpegInfo(AVI))).toBe('mp4');
    expect(chooseTarget('video', parseFfmpegInfo(ALPHA))).toBe('webm-alpha');
    expect(chooseTarget('image', parseFfmpegInfo(HEIC))).toBe('jpeg');
    expect(chooseTarget('image', parseFfmpegInfo(HEIC_TILES))).toBe('jpeg');
    expect(chooseTarget('image', parseFfmpegInfo(TIFF_ALPHA))).toBe('png');
    expect(chooseTarget('audio', parseFfmpegInfo(AIFF))).toBe('m4a');
    // A "video" with only sound in it (a WMA) becomes a sound file; nothing readable, nothing.
    expect(chooseTarget('video', parseFfmpegInfo(AIFF))).toBe('m4a');
    expect(chooseTarget('video', parseFfmpegInfo('Invalid data found when processing input'))).toBeNull();
  });

  it('asks FFmpeg for what plays everywhere', () => {
    const mp4 = convertArgs('mp4', 'in.mov', 'out.mp4', parseFfmpegInfo(PRORES)).join(' ');
    expect(mp4).toContain('-c:v libx264');
    expect(mp4).toContain('format=yuv420p');
    expect(mp4).toContain('-c:a aac');
    expect(mp4).toContain('+faststart');
    const webm = convertArgs('webm-alpha', 'in.mov', 'out.webm', parseFfmpegInfo(ALPHA)).join(' ');
    expect(webm).toContain('-c:v libvpx-vp9');
    expect(webm).toContain('-pix_fmt yuva420p');
    expect(webm).not.toContain('-c:a');
    expect(convertArgs('m4a', 'in.aiff', 'out.m4a', parseFfmpegInfo(AIFF)).join(' ')).toContain('-vn');
  });
});
