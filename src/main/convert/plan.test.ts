import { describe, expect, it } from 'vitest';
import { isHevc } from '../../shared/convert';
import {
  atImport,
  chooseTarget,
  convertArgs,
  describeMedia,
  hasAlpha,
  parseFfmpegInfo,
  PLAYER,
} from './plan';

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
    // These texts start at the duration: no Input line, so no container (Session 50 reads it).
    expect(parseFfmpegInfo(PRORES)).toEqual({
      container: null,
      durationMs: 2000,
      video: { codec: 'prores', pixFmt: 'yuv422p10le', width: 320, height: 180, still: false },
      audio: { codec: 'pcm_s16le' },
    });
    expect(parseFfmpegInfo(AVI).video).toMatchObject({ codec: 'mpeg4', pixFmt: 'yuv420p', width: 320 });
    expect(parseFfmpegInfo(AIFF)).toEqual({
      container: null,
      durationMs: 2000,
      video: null,
      audio: { codec: 'pcm_s16be' },
    });
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

/** Only files may be opened, and the option comes before the input it is for (Session 31, MED-6). */
function onlyFiles(args: string[]): boolean {
  const at = args.indexOf('-protocol_whitelist');
  return at >= 0 && args[at + 1] === 'file' && at < args.indexOf('-i');
}

describe('what a file becomes', () => {
  it('opens nothing but files: -protocol_whitelist file before the input, for every kind (Session 31)', () => {
    const info = parseFfmpegInfo(
      '  Duration: 00:00:02.00\n    Stream #0:0: Video: prores (HQ), yuv422p10le, 320x180, 25 fps\n',
    );
    for (const target of ['mp4', 'webm-alpha', 'jpeg', 'png', 'm4a'] as const)
      expect(onlyFiles(convertArgs(target, '/in.mov', '/out', info)), target).toBe(true);
    expect(onlyFiles(convertArgs('mp4', '/in.mov', '/out', info, { maxHeight: 1080 }))).toBe(true);
  });

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

  it('makes a video no taller than asked (Session 25b), keeping its shape, with even sizes', () => {
    const args = convertArgs('mp4', 'in.mp4', 'out.mp4', parseFfmpegInfo(PRORES), { maxHeight: 1080 });
    expect(args[args.indexOf('-vf') + 1]).toBe("scale=-2:'trunc(min(ih,1080)/2)*2',format=yuv420p");
    expect(args).toContain('libx264');
    // With no limit, the size stays as it was.
    const as = convertArgs('mp4', 'in.mov', 'out.mp4', parseFfmpegInfo(PRORES));
    expect(as[as.indexOf('-vf') + 1]).toBe('scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p');
  });
});

/*
 * What FFmpeg 9.0.2 printed for tiny generated files (1 s, 64 × 48; Session 50), each as `ffmpeg -i` says it:
 * the container on the Input line, then the streams.
 */
const read = (container: string, file: string, ...streams: string[]) =>
  [
    `Input #0, ${container}, from '/Placeholder/${file}':`,
    '  Duration: 00:00:01.01, start: 0.000000, bitrate: 137 kb/s',
    ...streams.map((s) => `  ${s}`),
  ].join('\n');
const MKV = 'matroska,webm';
const ISO = 'mov,mp4,m4a,3gp,3g2,mj2';
const H264 =
  'Stream #0:0: Video: h264 (Constrained Baseline), yuv420p(tv, progressive), 64x48 [SAR 1:1 DAR 4:3], 10 fps, 10 tbr, 1k tbn';
const H264_MP4 =
  'Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 64x48 [SAR 1:1 DAR 4:3], 31 kb/s, 10 fps, 10 tbr, 10240 tbn (default)';
const AAC_MP4 =
  'Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 70 kb/s (default)';
const FILES = {
  mkvAc3: read(MKV, 'clip.mkv', H264, 'Stream #0:1: Audio: ac3, 48000 Hz, mono, fltp, 96 kb/s'),
  mkvDts: read(MKV, 'clip.mkv', H264, 'Stream #0:1: Audio: dts (dca) (DTS), 48000 Hz, mono, fltp, 1411 kb/s'),
  mkvEac3: read(MKV, 'clip.mkv', H264, 'Stream #0:1: Audio: eac3, 48000 Hz, mono, fltp, 96 kb/s'),
  mkvAac: read(MKV, 'clip.mkv', H264, 'Stream #0:1: Audio: aac (LC), 48000 Hz, mono, fltp'),
  webm: read(
    MKV,
    'clip.webm',
    'Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv, progressive), 64x48, SAR 1:1 DAR 4:3, 10 fps, 10 tbr, 1k tbn',
    'Stream #0:1: Audio: opus, 48000 Hz, mono, fltp',
  ),
  avi: read(
    'avi',
    'clip.avi',
    'Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 64x48 [SAR 1:1 DAR 4:3], 10 fps, 10 tbr, 10 tbn',
    'Stream #0:1: Audio: mp3 (mp3float) (U[0][0][0] / 0x0055), 48000 Hz, mono, fltp, 64 kb/s',
  ),
  wma: read(
    'asf',
    'sound.wma',
    'Stream #0:0: Audio: wmav2 (a[1][0][0] / 0x0161), 48000 Hz, mono, fltp, 128 kb/s',
  ),
  aiff: read('aiff', 'sound.aiff', 'Stream #0:0: Audio: pcm_s16be, 48000 Hz, mono, s16, 768 kb/s'),
  flac: read('flac', 'sound.flac', 'Stream #0:0: Audio: flac, 48000 Hz, mono, s16'),
  mp4: read(ISO, 'clip.mp4', H264_MP4, AAC_MP4),
  mp3: read(
    'mp3',
    'sound.mp3',
    'Stream #0:0: Audio: mp3 (mp3float), 48000 Hz, mono, fltp, 64 kb/s, start 0.023021',
  ),
  mp3Cover: read(
    'mp3',
    'sound.mp3',
    'Stream #0:0: Audio: mp3 (mp3float), 48000 Hz, mono, fltp, 64 kb/s, start 0.023021',
    'Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 32x32 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn, start 0.023022 (attached pic)',
  ),
  wav: read(
    'wav',
    'sound.wav',
    'Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, mono, s16, 768 kb/s',
  ),
  m4a: read(ISO, 'sound.m4a', AAC_MP4.replace('#0:1[0x2]', '#0:0[0x1]')),
  ogg: read('ogg', 'sound.ogg', 'Stream #0:0: Audio: vorbis, 48000 Hz, mono, fltp, 80 kb/s'),
  opus: read('ogg', 'sound.opus', 'Stream #0:0: Audio: opus, 48000 Hz, mono, fltp'),
  movPcm: read(
    ISO,
    'clip.mov',
    H264_MP4,
    'Stream #0:1[0x2]: Audio: pcm_s16le (sowt / 0x74776F73), 48000 Hz, mono, s16, 768 kb/s (default)',
  ),
  mp4Ac3: read(
    ISO,
    'clip.mp4',
    H264_MP4,
    'Stream #0:1[0x2](und): Audio: ac3 (ac-3 / 0x332D6361), 48000 Hz, mono, fltp, 96 kb/s (default)',
  ),
  threeGp: read(ISO, 'clip.3gp', H264_MP4, AAC_MP4),
  h263: read(
    ISO,
    'clip.3gp',
    'Stream #0:0[0x1](und): Video: h263 (s263 / 0x33363273), yuv420p(progressive), 128x96 [SAR 12:11 DAR 16:11], 265 kb/s, SAR 1:1 DAR 4:3, 10 fps, 10 tbr, 10240 tbn (default)',
  ),
  flv: read(
    'flv',
    'clip.flv',
    'Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s',
    'Stream #0:1: Video: flv1 (flv), yuv420p, 64x48, 200 kb/s, 10 fps, 10 tbr, 1k tbn, start 0.025000',
  ),
  f4v: read(ISO, 'clip.f4v', H264_MP4, AAC_MP4),
  ogv: read(
    'ogg',
    'clip.ogv',
    'Stream #0:0: Video: theora, yuv420p, 64x48 [SAR 1:1 DAR 4:3], 10 tbr, 10 tbn',
    'Stream #0:1: Audio: vorbis, 48000 Hz, mono, fltp, 80 kb/s',
  ),
  ts: read(
    'mpegts',
    'clip.ts',
    'Stream #0:0[0x100]: Video: h264 (Constrained Baseline) ([27][0][0][0] / 0x001B), yuv420p(progressive), 64x48 [SAR 1:1 DAR 4:3], 10 fps, 10 tbr, 90k tbn, start 1.421333',
    'Stream #0:1[0x101]: Audio: aac (LC) ([15][0][0][0] / 0x000F), 48000 Hz, mono, fltp, 72 kb/s, start 1.400000',
  ),
  vob: read(
    'mpeg',
    'clip.vob',
    'Stream #0:0[0x1e0]: Video: mpeg2video (Main), yuv420p(tv, progressive), 64x48 [SAR 1:1 DAR 4:3], 10 fps, 10 tbr, 90k tbn, start 0.600000',
    'Stream #0:1[0x80]: Audio: ac3, 48000 Hz, mono, fltp, 96 kb/s, start 0.594667',
  ),
  mxf: read(
    'mxf',
    'clip.mxf',
    'Stream #0:0: Video: mpeg2video (Main), yuv420p(tv, progressive), 720x576 [SAR 1:1 DAR 5:4], 25 fps, 25 tbr, 25 tbn',
  ),
  wmv: read(
    'asf',
    'clip.wmv',
    'Stream #0:0: Video: wmv2 (WMV2 / 0x32564D57), yuv420p, 64x48, SAR 1:1 DAR 4:3, 10 fps, 10 tbr, 1k tbn, start 0.043000',
    'Stream #0:1: Audio: wmav2 (a[1][0][0] / 0x0161), 48000 Hz, mono, fltp, 128 kb/s',
  ),
  mkaAc3: read(MKV, 'sound.mka', 'Stream #0:0: Audio: ac3, 48000 Hz, mono, fltp, 96 kb/s'),
  mkaOpus: read(MKV, 'sound.mka', 'Stream #0:0: Audio: opus, 48000 Hz, mono, fltp'),
  ac3: read('ac3', 'sound.ac3', 'Stream #0:0: Audio: ac3, 48000 Hz, mono, fltp, 96 kb/s'),
  eac3: read('eac3', 'sound.eac3', 'Stream #0:0: Audio: eac3, 48000 Hz, mono, fltp, 96 kb/s'),
  dts: read('dts', 'sound.dts', 'Stream #0:0: Audio: dts (dca) (DTS), 48000 Hz, mono, fltp, 1411 kb/s'),
  caf: read(
    'caf',
    'sound.caf',
    'Stream #0:0: Audio: pcm_s16le (lpcm / 0x6D63706C), 48000 Hz, mono, s16, 768 kb/s',
  ),
  wv: read('wv', 'sound.wv', 'Stream #0:0: Audio: wavpack, 48000 Hz, mono, s16p'),
  mp2: read('mp3', 'sound.mp2', 'Stream #0:0: Audio: mp2 (mp3float), 48000 Hz, mono, fltp, 384 kb/s'),
  au: read(
    'au',
    'sound.au',
    'Stream #0:0: Audio: pcm_s16be ([3][0][0][0] / 0x0003), 48000 Hz, mono, s16, 768 kb/s',
  ),
  aifc: read(
    'aiff',
    'sound.aifc',
    'Stream #0:0: Audio: pcm_s16le (sowt / 0x74776F73), 48000 Hz, mono, s16, 768 kb/s',
  ),
  m4b: read(ISO, 'sound.m4b', AAC_MP4.replace('#0:1[0x2]', '#0:0[0x1]')),
  alac: read(
    ISO,
    'sound.m4a',
    'Stream #0:0[0x1](und): Audio: alac (alac / 0x63616C61), 48000 Hz, mono, s16p, 152 kb/s (default)',
  ),
  amr: read(
    'amr',
    'sound.amr',
    'Stream #0:0: Audio: amr_nb (samr / 0x726D6173), 8000 Hz, mono, flt, 12 kb/s',
  ),
  ape: read('ape', 'sound.ape', 'Stream #0:0: Audio: ape (APE  / 0x20455041), 44100 Hz, stereo, s16p'),
  hevc: read(
    ISO,
    'clip.mov',
    'Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, progressive), 320x180, 51 kb/s, 25 fps, 25 tbr, 12800 tbn (default)',
  ),
  hevcAc3: read(
    MKV,
    'clip.mkv',
    'Stream #0:0: Video: hevc (Main), yuv420p(tv, progressive), 320x180, 25 fps, 25 tbr, 1k tbn',
    'Stream #0:1: Audio: ac3, 48000 Hz, stereo, fltp, 192 kb/s',
  ),
  h264TenBit: read(
    MKV,
    'clip.mkv',
    'Stream #0:0: Video: h264 (High 10), yuv420p10le(tv, progressive), 1920x1080, 25 fps, 25 tbr, 1k tbn',
    'Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp',
  ),
  nothing:
    '[in#0 @ 0x1] Error opening input: Invalid data found when processing input\nError opening input file /Placeholder/notes.ts.',
} as const;

const at = (kind: 'video' | 'audio', file: keyof typeof FILES) =>
  atImport(kind, parseFfmpegInfo(FILES[file]));

describe('what Drashti’s player plays, and what is converted at import (Session 50)', () => {
  it('reads the container FFmpeg names', () => {
    expect(parseFfmpegInfo(FILES.mkvAc3).container).toBe('matroska,webm');
    expect(parseFfmpegInfo(FILES.mp4).container).toBe('mov,mp4,m4a,3gp,3g2,mj2');
    expect(parseFfmpegInfo(FILES.wma).container).toBe('asf');
    expect(parseFfmpegInfo(FILES.nothing).container).toBeNull();
    // A path with a comma in it is no part of the container's name.
    expect(parseFfmpegInfo("Input #0, avi, from '/a, from b/x.avi':\n").container).toBe('avi');
  });

  it('converts the files the brief names: an MKV with AC-3 or DTS sound, an AVI, a WMA and an AIFF', () => {
    expect(at('video', 'mkvAc3')).toBe('convert');
    expect(at('video', 'mkvDts')).toBe('convert');
    expect(at('video', 'mkvEac3')).toBe('convert');
    expect(at('video', 'avi')).toBe('convert');
    expect(at('audio', 'wma')).toBe('convert');
    expect(at('audio', 'aiff')).toBe('convert');
  });

  it('never converts what plays as it is: FLAC, MP4 with H.264 and AAC, and the rest Chromium plays', () => {
    expect(at('audio', 'flac')).toBe('plays');
    expect(at('video', 'mp4')).toBe('plays');
    expect(at('video', 'mkvAac')).toBe('plays');
    expect(at('video', 'webm')).toBe('plays');
    expect(at('video', 'movPcm')).toBe('plays');
    expect(at('video', 'threeGp')).toBe('plays');
    expect(at('video', 'f4v')).toBe('plays');
    for (const sound of ['mp3', 'mp3Cover', 'wav', 'm4a', 'ogg', 'opus', 'mkaOpus', 'm4b'] as const)
      expect(at('audio', sound), sound).toBe('plays');
    // A sound in a "video" file (an MP3's cover is a picture of one frame): its sound decides.
    expect(at('video', 'mp3Cover')).toBe('plays');
  });

  it('converts every other container, picture and sound Chromium cannot play', () => {
    for (const video of ['h263', 'flv', 'ogv', 'ts', 'vob', 'mxf', 'wmv', 'mp4Ac3', 'h264TenBit'] as const)
      expect(at('video', video), video).toBe('convert');
    for (const sound of [
      'mkaAc3',
      'ac3',
      'eac3',
      'dts',
      'caf',
      'wv',
      'mp2',
      'au',
      'aifc',
      'alac',
      'amr',
      'ape',
    ] as const)
      expect(at('audio', sound), sound).toBe('convert');
  });

  it('leaves HEVC to the window, which knows whether this computer plays it, unless its sound cannot play', () => {
    expect(at('video', 'hevc')).toBe('hevc');
    expect(at('video', 'hevcAc3')).toBe('convert');
  });

  it('leaves a file FFmpeg found nothing in to its own header, as before', () => {
    expect(at('video', 'nothing')).toBe('unread');
    expect(at('audio', 'nothing')).toBe('unread');
    // A sound file holding only a picture has no sound to play.
    expect(at('audio', 'mxf')).toBe('unread');
  });

  it('is data: the containers, pictures and sounds it plays', () => {
    expect([...PLAYER.containers].sort()).toEqual(
      ['aac', 'flac', 'matroska,webm', 'mov,mp4,m4a,3gp,3g2,mj2', 'mp3', 'ogg', 'wav'].sort(),
    );
    expect([...PLAYER.video].sort()).toEqual(['av1', 'h264', 'vp8', 'vp9']);
    expect([...PLAYER.audio]).toEqual(
      expect.arrayContaining(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le']),
    );
    for (const no of ['ac3', 'eac3', 'dts', 'wmav2', 'adpcm_ms', 'mp2', 'alac', 'amr_nb'])
      expect(PLAYER.audio.has(no), no).toBe(false);
  });

  it('says what each file is, for people', () => {
    const say = (kind: 'video' | 'audio', file: keyof typeof FILES, ext: string) =>
      describeMedia(kind, parseFfmpegInfo(FILES[file]), ext);
    expect(say('video', 'mkvAc3', 'mkv')).toBe('H.264 video with AC-3 sound (Matroska)');
    expect(say('video', 'mkvDts', 'mkv')).toBe('H.264 video with DTS sound (Matroska)');
    expect(say('video', 'avi', 'avi')).toBe('MPEG-4 Part 2 video with MP3 sound (AVI)');
    expect(say('audio', 'wma', 'wma')).toBe('Windows Media Audio sound file');
    expect(say('audio', 'aiff', 'aiff')).toBe('AIFF sound file');
    expect(say('audio', 'flac', 'flac')).toBe('FLAC sound file');
    expect(say('video', 'mp4', 'mp4')).toBe('H.264 video with AAC sound (MP4)');
    expect(say('video', 'movPcm', 'mov')).toBe('H.264 video with uncompressed sound (QuickTime)');
    expect(say('audio', 'm4b', 'm4b')).toBe('AAC sound file (M4A)');
    expect(say('video', 'webm', 'webm')).toBe('VP9 video with Opus sound (WebM)');
    expect(say('video', 'wmv', 'wmv')).toBe('Windows Media video with Windows Media Audio sound');
    expect(say('video', 'vob', 'vob')).toBe('MPEG-2 video with AC-3 sound (DVD-style MPEG)');
    expect(say('audio', 'mp2', 'mp2')).toBe('MP2 sound file');
    expect(say('audio', 'mkaAc3', 'mka')).toBe('AC-3 sound file (Matroska)');
    expect(say('video', 'mp3Cover', 'mp3')).toBe('MP3 sound file');
    expect(say('video', 'h264TenBit', 'mkv')).toBe('H.264 (yuv420p10le) video with AAC sound (Matroska)');
    // HEVC is named so: the window offers it for conversion where this computer cannot play it.
    expect(isHevc(say('video', 'hevc', 'mov'))).toBe(true);
    expect(say('audio', 'ape', 'ape')).toBe('Monkey’s Audio sound file');
  });

  it('copies a picture that plays rather than making it again: only the sound or the container is converted', () => {
    const args = (file: keyof typeof FILES, options: { maxHeight?: number } = {}) =>
      convertArgs('mp4', '/in', '/out.mp4', parseFfmpegInfo(FILES[file]), options).join(' ');
    for (const file of ['mkvAc3', 'mkvDts', 'ts', 'mp4Ac3'] as const) {
      expect(args(file), file).toContain('-c:v copy');
      expect(args(file), file).toContain('-c:a aac');
      expect(args(file), file).not.toContain('libx264');
    }
    // A picture Chromium cannot play, an AVI's own timing, a 10-bit H.264, or a smaller copy: made again.
    for (const file of ['avi', 'vob', 'h264TenBit', 'hevcAc3'] as const)
      expect(args(file), file).toContain('libx264');
    expect(args('mkvAc3', { maxHeight: 1080 })).toContain('libx264');
    expect(onlyFiles(convertArgs('mp4', '/in', '/out.mp4', parseFfmpegInfo(FILES.mkvAc3)))).toBe(true);
  });
});
