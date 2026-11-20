import { describe, expect, it } from 'vitest';
import type { PictureTrack, SoundTrack } from '../../shared/media-details';
import { languageName, parseMediaDetails, topLevelParts } from './media-details-parse';

/*
 * Media information… (alpha.20, Q60-34 item 1): what the bundled FFmpeg 9.0.2 printed for generated files (FFmpeg's
 * test sources, 0.4 s each), read as the window says them. Each text is FFmpeg's own, its trailing spaces trimmed.
 */

const MAIN_WITH_SOUND = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'h264-main.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf63.1.102
  Duration: 00:00:00.40, start: 0.000000, bitrate: 182 kb/s
  Stream #0:0[0x1](und): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(progressive), 64x64 [SAR 1:1 DAR 1:1], 72 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      encoder         : Lavc63.1.102 libx264
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 71 kb/s (default)
    Metadata:
      handler_name    : SoundHandler`;

const TWO_SOUNDS = `Input #0, matroska,webm, from 'multi.mkv':
  Metadata:
    title           : Placeholder
    ENCODER         : Lavf63.1.102
  Duration: 00:00:00.42, start: 0.000000, bitrate: 259 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(tv, progressive), 64x64 [SAR 1:1 DAR 1:1], 25 fps, 25 tbr, 1k tbn
    Metadata:
      ENCODER         : Lavc63.1.102 libx264
      DURATION        : 00:00:00.400000000
  Stream #0:1(eng): Audio: aac (LC), 44100 Hz, mono, fltp (default)
    Metadata:
      ENCODER         : Lavc63.1.102 aac
      DURATION        : 00:00:00.423000000
  Stream #0:2(guj): Audio: ac3, 44100 Hz, mono, fltp, 96 kb/s
    Metadata:
      title           : Commentary
      ENCODER         : Lavc63.1.102 ac3
      DURATION        : 00:00:00.406000000`;

const LOSSLESS = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'h264-lossless420.mp4':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 248 kb/s
  Stream #0:0[0x1](und): Video: h264 (High 4:4:4 Predictive) (avc1 / 0x31637661), yuv420p(progressive), 64x64 [SAR 1:1 DAR 1:1], 230 kb/s, 25 fps, 25 tbr, 12800 tbn (default)`;

const INTERLACED = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'h264-interlaced.mp4':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 96 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(top first), 64x64 [SAR 1:1 DAR 1:1], 76 kb/s, 25 fps, 25 tbr, 12800 tbn (default)`;

const NOT_SQUARE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'h264-sar.mp4':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 1311 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 720x576 [SAR 64:45 DAR 16:9], 1292 kb/s, 25 fps, 25 tbr, 12800 tbn (default)`;

const HDR_PQ = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'hdr-pq.mp4':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 107 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hev1 / 0x31766568), yuv420p10le(tv, bt2020nc/bt2020/smpte2084, progressive), 64x64 [SAR 1:1 DAR 1:1], 38 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
    Metadata:
      handler_name    : VideoHandler
      encoder         : Lavc63.1.102 libx265`;

const HDR_HLG = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'hdr-hlg.mov':
  Metadata:
    major_brand     : qt
    minor_version   : 512
    compatible_brands: qt
    encoder         : Lavf63.1.102
  Duration: 00:00:00.40, start: 0.000000, bitrate: 106 kb/s
  Stream #0:0[0x1]: Video: hevc (Main 10) (hev1 / 0x31766568), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67, progressive), 64x64 [SAR 1:1 DAR 1:1], 38 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)`;

const VP9_444 = `Input #0, matroska,webm, from 'vp9-444.webm':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 127 kb/s
  Stream #0:0: Video: vp9 (Profile 1), yuv444p(tv, progressive), 64x64, SAR 1:1 DAR 1:1, 25 fps, 25 tbr, 1k tbn`;

const AV1 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'av1.mp4':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 95 kb/s
  Stream #0:0[0x1](und): Video: av1 (libdav1d) (Main) (av01 / 0x31307661), yuv420p(tv, progressive), 64x64 [SAR 1:1 DAR 1:1], 77 kb/s, 25 fps, 25 tbr, 12800 tbn (default)`;

const PRORES = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'prores.mov':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 797 kb/s
  Stream #0:0[0x1]: Video: prores (HQ) (apch / 0x68637061), yuv422p10le(tv, progressive), 64x64, 781 kb/s, SAR 1:1 DAR 1:1, 29.97 fps, 29.97 tbr, 30k tbn (default)`;

const MPEG2_BOTTOM = `Input #0, mpegts, from 'mpeg2-interlaced.ts':
  Duration: 00:00:00.40, start: 1.440000, bitrate: 387 kb/s
  Program 1
    Metadata:
      service_name    : Service01
      service_provider: FFmpeg
  Stream #0:0[0x100]: Video: mpeg2video (Main) ([2][0][0][0] / 0x0002), yuv420p(tv, bottom first), 64x64 [SAR 1:1 DAR 1:1], 25 fps, 25 tbr, 90k tbn, start 1.440000
    Side data:
      CPB properties: bitrate max/min/avg: 0/0/0 buffer size: 49152 vbv_delay: N/A`;

const MP3_COVER = `Input #0, mp3, from 'cover.mp3':
  Metadata:
    encoder         : Lavf63.1.102
  Duration: 00:00:03.00, start: 0.025056, bitrate: 65 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s, start 0.025057
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 32x32 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn, start 0.025056 (attached pic)
    Metadata:
      comment         : Other`;

const CAPTIONS = `Input #0, matroska,webm, from 'subs.mkv':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 94 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(tv, progressive), 64x64 [SAR 1:1 DAR 1:1], 29.97 fps, 29.97 tbr, 1k tbn
  Stream #0:1(eng): Subtitle: subrip (srt)
    Metadata:
      ENCODER         : Lavc63.1.102 srt
      DURATION        : 00:00:00.300000000`;

const PCM_24 = `Input #0, wav, from 'pcm24.wav':
  Metadata:
    encoder         : Lavf63.1.102
  Duration: 00:00:00.40, bitrate: 2306 kb/s
  Stream #0:0: Audio: pcm_s24le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s32 (24 bit), 2304 kb/s`;

const EAC3 = `[in#0/eac3 @ 0x137e16260] Estimating duration from bitrate, this may be inaccurate
Input #0, eac3, from 'surround.eac3':
  Duration: 00:00:00.42, start: 0.000000, bitrate: 447 kb/s
  Stream #0:0: Audio: eac3, 44100 Hz, 5.1(side), fltp, 447 kb/s`;

const M4A_51 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'surround.m4a':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 378 kb/s
  Stream #0:0[0x1](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, 5.1, fltp, 340 kb/s (default)`;

const OPUS = `Input #0, matroska,webm, from 'opus.webm':
  Duration: 00:00:00.41, start: 0.000000, bitrate: 91 kb/s
  Stream #0:0: Audio: opus, 48000 Hz, mono, fltp`;

const FLAC = `Input #0, flac, from 'sound.flac':
  Duration: 00:00:00.40, start: 0.000000, bitrate: 289 kb/s
  Stream #0:0: Audio: flac, 44100 Hz, mono, s16`;

const TITLED = `[in#0 @ 0x158616260] UDTA parsing failed retrying raw
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'plain-title.mov':
  Metadata:
    major_brand     : qt
    minor_version   : 512
    compatible_brands: qt
    title           : Placeholder title
    encoder         : Lavf63.1.102
  Duration: 00:00:00.40, start: 0.000000, bitrate: 244 kb/s
  Stream #0:0[0x1]: Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 64x64 [SAR 1:1 DAR 1:1], 72 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      vendor_id       : FFMP
      encoder         : Lavc63.1.102 libx264
  Stream #0:1[0x2](hin): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 126 kb/s (default)
    Metadata:
      handler_name    : SoundHandler
      vendor_id       : [0][0][0][0]
      name            : Placeholder sound`;

/** An H.264 picture of 64 × 64 at 25 a second, 8-bit 4:2:0 and progressive, with what differs. */
const picture = (more: Partial<PictureTrack>): PictureTrack => ({
  codec: 'h264',
  codecName: 'H.264',
  profile: 'High',
  level: null,
  pixFmt: 'yuv420p',
  bitDepth: 8,
  chroma: '4:2:0',
  hdr: null,
  alpha: false,
  width: 64,
  height: 64,
  sar: '1:1',
  dar: '1:1',
  fps: 25,
  scan: 'progressive',
  bitRateKbps: null,
  language: null,
  title: null,
  ...more,
});

/** A sound track at 44.1 kHz, mono, with what differs. */
const sound = (more: Partial<SoundTrack>): SoundTrack => ({
  codec: 'aac',
  codecName: 'AAC',
  profile: 'LC',
  sampleRateHz: 44100,
  channels: 'mono',
  bitDepth: null,
  bitRateKbps: null,
  language: null,
  title: null,
  ...more,
});

describe('what FFmpeg says a file holds, for Media information', () => {
  it('reads the container, length, bit rate, the picture and the sound of an ordinary MP4', () => {
    expect(parseMediaDetails(MAIN_WITH_SOUND, 'mp4')).toEqual({
      container: 'MP4',
      durationMs: 400,
      bitRateKbps: 182,
      title: null,
      pictures: [picture({ profile: 'Main', bitRateKbps: 72 })],
      sounds: [sound({ bitRateKbps: 71 })],
      captions: [],
      cover: null,
      chapters: 0,
    });
  });

  it('reads each sound track with its language and its own name, and the file’s title', () => {
    const read = parseMediaDetails(TWO_SOUNDS, 'mkv');
    expect(read.container).toBe('Matroska');
    expect(read.title).toBe('Placeholder');
    expect(read.durationMs).toBe(420);
    expect(read.pictures).toEqual([picture({})]);
    expect(read.sounds).toEqual([
      sound({ language: 'English' }),
      sound({
        codec: 'ac3',
        codecName: 'AC-3',
        profile: null,
        bitRateKbps: 96,
        language: 'Gujarati',
        title: 'Commentary',
      }),
    ]);
  });

  it('names an H.264 profile Drashti’s player may not draw, whatever its pixels say', () => {
    expect(parseMediaDetails(LOSSLESS, 'mp4').pictures[0]).toEqual(
      picture({ profile: 'High 4:4:4 Predictive', bitRateKbps: 230 }),
    );
  });

  it('says which field comes first in an interlaced picture', () => {
    expect(parseMediaDetails(INTERLACED, 'mp4').pictures[0]?.scan).toBe('top first');
    expect(parseMediaDetails(MPEG2_BOTTOM, 'ts').pictures[0]).toEqual(
      picture({ codec: 'mpeg2video', codecName: 'MPEG-2', profile: 'Main', scan: 'bottom first' }),
    );
    // A transport stream's program and its side data change nothing.
    expect(parseMediaDetails(MPEG2_BOTTOM, 'ts')).toMatchObject({
      container: 'MPEG transport stream',
      durationMs: 400,
      bitRateKbps: 387,
      sounds: [],
    });
  });

  it('keeps the shape of pixels that are not square, and the shape of the picture they make', () => {
    expect(parseMediaDetails(NOT_SQUARE, 'mp4').pictures[0]).toEqual(
      picture({ width: 720, height: 576, sar: '64:45', dar: '16:9', bitRateKbps: 1292 }),
    );
  });

  it('reads 10-bit HDR, PQ and HLG, and names a QuickTime file by its extension', () => {
    const pq = parseMediaDetails(HDR_PQ, 'mp4');
    expect(pq.pictures[0]).toEqual(
      picture({
        codec: 'hevc',
        codecName: 'HEVC (H.265)',
        profile: 'Main 10',
        pixFmt: 'yuv420p10le',
        bitDepth: 10,
        hdr: 'pq',
        fps: 29.97,
        bitRateKbps: 38,
      }),
    );
    const hlg = parseMediaDetails(HDR_HLG, 'mov');
    expect(hlg.container).toBe('QuickTime');
    expect(hlg.pictures[0]?.hdr).toBe('hlg');
    expect(hlg.pictures[0]?.bitDepth).toBe(10);
  });

  it('reads VP9’s and AV1’s profiles (never a decoder’s name) and ProRes’s kind, with their depth and colour', () => {
    expect(parseMediaDetails(VP9_444, 'webm')).toMatchObject({
      container: 'WebM',
      pictures: [
        picture({ codec: 'vp9', codecName: 'VP9', profile: 'Profile 1', pixFmt: 'yuv444p', chroma: '4:4:4' }),
      ],
    });
    expect(parseMediaDetails(AV1, 'mp4').pictures[0]).toEqual(
      picture({ codec: 'av1', codecName: 'AV1', profile: 'Main', bitRateKbps: 77 }),
    );
    expect(parseMediaDetails(PRORES, 'mov').pictures[0]).toEqual(
      picture({
        codec: 'prores',
        codecName: 'ProRes',
        profile: 'HQ',
        pixFmt: 'yuv422p10le',
        bitDepth: 10,
        chroma: '4:2:2',
        fps: 29.97,
        bitRateKbps: 781,
      }),
    );
  });

  it('reads an MP3 with its cover picture, which is not a moving picture', () => {
    expect(parseMediaDetails(MP3_COVER, 'mp3')).toEqual({
      container: 'MP3',
      durationMs: 3000,
      bitRateKbps: 65,
      title: null,
      pictures: [],
      sounds: [sound({ codec: 'mp3', codecName: 'MP3', profile: null, bitRateKbps: 64 })],
      captions: [],
      cover: { codecName: 'JPEG', width: 32, height: 32 },
      chapters: 0,
    });
  });

  it('lists the captions carried in the file', () => {
    expect(parseMediaDetails(CAPTIONS, 'mkv').captions).toEqual([
      { codec: 'subrip', codecName: 'SubRip (SRT)', language: 'English', title: null },
    ]);
  });

  it('reads sounds of every kind: uncompressed with its bits, surround, Opus, FLAC', () => {
    expect(parseMediaDetails(PCM_24, 'wav')).toMatchObject({
      container: 'WAV',
      durationMs: 400,
      bitRateKbps: 2306,
      sounds: [
        sound({
          codec: 'pcm_s24le',
          codecName: 'Uncompressed (PCM)',
          profile: null,
          sampleRateHz: 48000,
          channels: 'stereo',
          bitDepth: 24,
          bitRateKbps: 2304,
        }),
      ],
    });
    // A line FFmpeg prints before the file's own (it guessed the length) changes nothing.
    expect(parseMediaDetails(EAC3, 'eac3')).toMatchObject({
      container: 'E-AC-3',
      sounds: [
        sound({ codec: 'eac3', codecName: 'E-AC-3', profile: null, channels: '5.1(side)', bitRateKbps: 447 }),
      ],
    });
    expect(parseMediaDetails(M4A_51, 'm4a')).toMatchObject({
      container: 'M4A',
      sounds: [sound({ channels: '5.1', bitRateKbps: 340 })],
    });
    expect(parseMediaDetails(OPUS, 'webm').sounds).toEqual([
      sound({ codec: 'opus', codecName: 'Opus', profile: null, sampleRateHz: 48000 }),
    ]);
    expect(parseMediaDetails(FLAC, 'flac')).toMatchObject({
      container: 'FLAC',
      sounds: [sound({ codec: 'flac', codecName: 'FLAC', profile: null, bitDepth: 16 })],
    });
  });

  it('takes a QuickTime track’s own name as its title, and the file’s title, never its handler’s name', () => {
    const read = parseMediaDetails(TITLED, 'mov');
    expect(read.title).toBe('Placeholder title');
    expect(read.pictures[0]?.title).toBeNull();
    expect(read.sounds[0]).toEqual(
      sound({ channels: 'stereo', bitRateKbps: 126, language: 'Hindi', title: 'Placeholder sound' }),
    );
  });

  it('reads nothing from a text that is not a file’s, and only the first file of two', () => {
    expect(parseMediaDetails('', 'mp4')).toEqual({
      container: null,
      durationMs: null,
      bitRateKbps: null,
      title: null,
      pictures: [],
      sounds: [],
      captions: [],
      cover: null,
      chapters: 0,
    });
    const two = `${MAIN_WITH_SOUND}\n${OPUS.replace('Input #0', 'Input #1').replace('Stream #0:0', 'Stream #1:0')}`;
    expect(parseMediaDetails(two, 'mp4').sounds).toEqual([sound({ bitRateKbps: 71 })]);
  });

  it('counts chapters, and a chapter’s title is never the file’s', () => {
    const chaptered = `${MAIN_WITH_SOUND.split('\n').slice(0, 7).join('\n')}
  Chapters:
    Chapter #0:0: start 0.000000, end 0.200000
      Metadata:
        title           : Placeholder chapter one
    Chapter #0:1: start 0.200000, end 0.400000
      Metadata:
        title           : Placeholder chapter two
${MAIN_WITH_SOUND.split('\n').slice(7).join('\n')}`;
    const read = parseMediaDetails(chaptered, 'mp4');
    expect(read.chapters).toBe(2);
    expect(read.title).toBeNull();
    expect(read.pictures).toHaveLength(1);
    expect(read.sounds).toHaveLength(1);
  });
});

describe('the parts of a stream’s line', () => {
  it('splits at its commas outside brackets', () => {
    expect(topLevelParts('yuv420p(tv, bt709, progressive), 64x64 [SAR 1:1 DAR 16:9], 25 fps')).toEqual([
      'yuv420p(tv, bt709, progressive)',
      '64x64 [SAR 1:1 DAR 16:9]',
      '25 fps',
    ]);
  });
});

describe('a file’s languages, for people', () => {
  it('names the languages Drashti’s files have, by their three or two letters, and none for undetermined', () => {
    expect(languageName('guj')).toBe('Gujarati');
    expect(languageName('GU')).toBe('Gujarati');
    expect(languageName('hin')).toBe('Hindi');
    expect(languageName('eng')).toBe('English');
    expect(languageName('san')).toBe('Sanskrit');
    expect(languageName('und')).toBeNull();
    expect(languageName('')).toBeNull();
    expect(languageName(null)).toBeNull();
    // A code no one names stays as it is.
    expect(languageName('qaa')).toBe('qaa');
  });
});
