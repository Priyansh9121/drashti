import { describe, expect, it } from 'vitest';
import { atImport, convertArgs, describeMedia, keepsPicture, parseFfmpegInfo, tooLarge } from './plan';

/*
 * "Plays anything" (alpha.20: the owner's Q60-34 item 2; his "Yes, all A" to Q60-39, P6 (b)). The kinds x46's probe
 * (x46-1120-112649-63694, Mac and Windows) found going up as they are and never drawn: an 8K H.264 (the lead's call: above
 * 4096 × 2304, a 2160p copy); and an interlaced picture, made a smooth progressive copy by itself. The kinds that probe
 * saw drawn on both systems stay as they are: a lossless H.264 (High 4:4:4 Predictive at 4:2:0), 1366 × 766, 16 × 16.
 * What FFmpeg 9.0.2 printed for generated files (an 8K and a 1080i-style clip made here at 10 a second); the other sizes
 * are those lines with only the size changed.
 */

const H264_8K = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/media/8k.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 96824 kb/s
  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 7680x4320 [SAR 1:1 DAR 16:9], 96745 kb/s, 10 fps, 10 tbr, 10240 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 69 kb/s (default)`;

const INTERLACED = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/media/1080i.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 1219 kb/s
  Stream #0:0[0x1](und): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(top first), 640x360 [SAR 1:1 DAR 16:9], 1147 kb/s, 10 fps, 10 tbr, 10240 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 69 kb/s (default)`;

const MPEG2_BOTTOM = `Input #0, mpegts, from '/media/mpeg2.ts':
  Duration: 00:00:00.40, start: 1.440000, bitrate: 387 kb/s
  Stream #0:0[0x100]: Video: mpeg2video (Main) ([2][0][0][0] / 0x0002), yuv420p(tv, bottom first), 64x64 [SAR 1:1 DAR 1:1], 25 fps, 25 tbr, 90k tbn, start 1.440000`;

const LOSSLESS = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/media/lossless.mp4':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 248 kb/s
  Stream #0:0[0x1](und): Video: h264 (High 4:4:4 Predictive) (avc1 / 0x31637661), yuv420p(progressive), 64x64 [SAR 1:1 DAR 1:1], 230 kb/s, 25 fps, 25 tbr, 12800 tbn (default)`;

/** The 8K clip's line with another size, as FFmpeg writes it. */
const sized = (size: string) => H264_8K.replace('7680x4320', size);

describe('what plays as it is and what is converted by itself (alpha.20, x47)', () => {
  it('reads an interlaced picture, which field first, from FFmpeg’s own words; never a progressive one', () => {
    expect(parseFfmpegInfo(INTERLACED).video).toEqual({
      codec: 'h264',
      pixFmt: 'yuv420p',
      width: 640,
      height: 360,
      still: false,
      interlaced: true,
    });
    expect(parseFfmpegInfo(MPEG2_BOTTOM).video).toMatchObject({ codec: 'mpeg2video', interlaced: true });
    // One more pair of brackets inside its pixels' (FFmpeg's swapped field order): still read, size and all.
    expect(
      parseFfmpegInfo(INTERLACED.replace('yuv420p(top first)', 'yuv420p(tv, top coded first (swapped))'))
        .video,
    ).toEqual({ codec: 'h264', pixFmt: 'yuv420p', width: 640, height: 360, still: false, interlaced: true });
    expect(parseFfmpegInfo(H264_8K).video).toEqual({
      codec: 'h264',
      pixFmt: 'yuv420p',
      width: 7680,
      height: 4320,
      still: false,
    });
  });

  it('an H.264 larger than 4096 × 2304 is converted by itself; 4K, an upright phone’s 4K and DCI 4K play as they are', () => {
    expect(atImport('video', parseFfmpegInfo(H264_8K))).toBe('convert');
    expect(atImport('video', parseFfmpegInfo(sized('5120x2880')))).toBe('convert');
    expect(atImport('video', parseFfmpegInfo(sized('4097x1000')))).toBe('convert');
    for (const size of ['3840x2160', '2160x3840', '4096x2160', '4096x2304', '1920x1080'])
      expect(atImport('video', parseFfmpegInfo(sized(size))), size).toBe('plays');
    expect(tooLarge({ codec: 'h264', width: 7680, height: 4320 })).toBe(true);
    expect(tooLarge({ codec: 'h264', width: 3840, height: 2160 })).toBe(false);
    // Only H.264: HEVC's kinds are asked of the computer (Session 60, x36).
    expect(tooLarge({ codec: 'hevc', width: 7680, height: 4320 })).toBe(false);
  });

  it('an interlaced picture is converted by itself, whatever its codec', () => {
    expect(atImport('video', parseFfmpegInfo(INTERLACED))).toBe('convert');
    expect(keepsPicture(parseFfmpegInfo(INTERLACED))).toBe(false);
  });

  it('the kinds x46’s probe saw drawn on both systems stay as they are', () => {
    expect(atImport('video', parseFfmpegInfo(LOSSLESS))).toBe('plays');
    for (const size of ['1366x766', '16x16'])
      expect(atImport('video', parseFfmpegInfo(sized(size))), size).toBe('plays');
    expect(keepsPicture(parseFfmpegInfo(sized('1920x1080')))).toBe(true);
  });

  it('says why, by its size or its interlacing, in what it is', () => {
    expect(describeMedia('video', parseFfmpegInfo(H264_8K), 'mp4')).toBe(
      'H.264 (7680 × 4320) video with AAC sound (MP4)',
    );
    expect(describeMedia('video', parseFfmpegInfo(INTERLACED), 'mp4')).toBe(
      'H.264 (interlaced) video with AAC sound (MP4)',
    );
    expect(describeMedia('video', parseFfmpegInfo(sized('3840x2160')), 'mp4')).toBe(
      'H.264 video with AAC sound (MP4)',
    );
  });

  it('makes the copy: an 8K one no taller than 2160, whoever asked; an interlaced one progressive first', () => {
    const big = convertArgs('mp4', '/in.mp4', '/out.mp4', parseFfmpegInfo(H264_8K));
    expect(big).toContain('libx264');
    expect(big).not.toContain('copy');
    expect(big[big.indexOf('-vf') + 1]).toBe("scale=-2:'trunc(min(ih,2160)/2)*2',format=yuv420p");
    // A smaller height asked (a link's 1080p) wins.
    const link = convertArgs('mp4', '/in.mp4', '/out.mp4', parseFfmpegInfo(H264_8K), { maxHeight: 1080 });
    expect(link[link.indexOf('-vf') + 1]).toBe("scale=-2:'trunc(min(ih,1080)/2)*2',format=yuv420p");
    const smooth = convertArgs('mp4', '/in.mp4', '/out.mp4', parseFfmpegInfo(INTERLACED));
    expect(smooth[smooth.indexOf('-vf') + 1]).toBe(
      'bwdif=mode=send_frame:deint=interlaced,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    );
    // A progressive 1080p one is untouched: its picture copied as it is when only its container is wrong.
    const plain = convertArgs('mp4', '/in.mkv', '/out.mp4', {
      ...parseFfmpegInfo(sized('1920x1080')),
      container: 'matroska,webm',
    });
    expect(plain).toContain('copy');
    expect(plain).not.toContain('-vf');
  });
});
