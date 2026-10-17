import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseFfmpegInfo } from './plan';
import {
  freeFileName,
  keyframeArgs,
  keyframeAtOrBefore,
  lengthName,
  mp4Problem,
  readKeyframes,
  savedFileName,
  trimArgs,
} from './trim';
import { keyframeOf } from './trim-saves';

/* Saving a video's part as an MP4 by copying it (Session 26e): made-up FFmpeg output, and the real FFmpeg where it is. */

const info = (video: string | null, audio: string | null) => ({
  durationMs: 10_000,
  video: video ? { codec: video, pixFmt: 'yuv420p', width: 320, height: 180, still: false } : null,
  audio: audio ? { codec: audio } : null,
});

describe('a video saved as an MP4 by copying it', () => {
  it('takes what an MP4 holds, and says plainly when it cannot hold a stream', () => {
    expect(mp4Problem(info('h264', 'aac'))).toBeNull();
    expect(mp4Problem(info('hevc', null))).toBeNull();
    expect(mp4Problem(info('vp9', 'opus'))).toBeNull();
    expect(mp4Problem(info('vp8', 'vorbis'))).toMatch(/^Its picture is VP8, which an MP4 cannot hold/u);
    expect(mp4Problem(info('prores', 'pcm_s16le'))).toMatch(/ProRes/u);
    expect(mp4Problem(info('h264', 'vorbis'))).toMatch(/^Its sound is Vorbis/u);
    expect(mp4Problem(info(null, 'aac'))).toBe('FFmpeg found no video in it to save.');
  });

  it('reads the keyframes FFmpeg lists, counted from the file’s own start', () => {
    const text = [
      '  Duration: 00:00:10.00, start: 1.400000, bitrate: 768 kb/s',
      '[Parsed_showinfo_0 @ 0x1] n:   0 pts:  51200 pts_time:41.4    duration:    512 duration_time:0.04 fmt:yuv420p s:320x180 i:P iskey:1 type:I checksum:1',
      '[Parsed_showinfo_0 @ 0x1] n:   1 pts:  64000 pts_time:46.4    duration:    512 duration_time:0.04 fmt:yuv420p s:320x180 i:P iskey:1 type:I checksum:2',
    ].join('\n');
    expect(readKeyframes(text)).toEqual({ startMs: 1400, keys: [40_000, 45_000] });
    expect(keyframeAtOrBefore([0, 40_000, 45_000], 41_200)).toBe(40_000);
    expect(keyframeAtOrBefore([40_000], 40_000)).toBe(40_000);
    expect(keyframeAtOrBefore([45_000], 41_200)).toBeNull();
    expect(keyframeArgs('/in.mp4', 41_200)).toEqual(
      expect.arrayContaining(['-noaccurate_seek', '-ss', '41.200', '-skip_frame', 'nokey', 'showinfo']),
    );
  });

  it('opens nothing but files, before the input (Session 31, MED-6)', () => {
    for (const args of [trimArgs('/in.mov', '/o.mp4', 40_000, 280_000), keyframeArgs('/in.mp4', 41_200)]) {
      const at = args.indexOf('-protocol_whitelist');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(args[at + 1]).toBe('file');
      expect(at).toBeLessThan(args.indexOf('-i'));
    }
  });

  it('copies every picture and sound stream from the keyframe to the end, with its details, starting as it downloads', () => {
    const args = trimArgs('/in.mov', '/out/.part.mp4', 40_000, 280_000);
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 6)).toEqual([
      '-ss',
      '40.000',
      '-i',
      '/in.mov',
      '-t',
      '240.000',
    ]);
    expect(args).toEqual(
      expect.arrayContaining(['-c', 'copy', '-map_metadata', '0', '+faststart', '0:V?', '0:a?']),
    );
    expect(args).not.toContain('-readrate');
    expect(trimArgs('/in.mov', '/o.mp4', 0, 1000, true)).toEqual(expect.arrayContaining(['-readrate', '1']));
    expect(args.at(-1)).toBe('/out/.part.mp4');
  });

  it('names a saved part by its length, never over a file already there', () => {
    expect(lengthName(240_000)).toBe('4m 00s');
    expect(lengthName(45_400)).toBe('0m 45s');
    expect(lengthName(3_725_000)).toBe('1h 02m 05s');
    expect(savedFileName('Placeholder Katha.mov', 240_000)).toBe('Placeholder Katha (4m 00s).mp4');
    expect(savedFileName('a/b:c.mp4', 60_000)).toBe('a-b-c (1m 00s).mp4');
    // Joined as the computer joins them (with backslashes on Windows), as freeFileName looks them up.
    const taken = new Set([join('/d', 'Clip (4m 00s).mp4'), join('/d', 'Clip (4m 00s) (2).mp4')]);
    expect(freeFileName('/d', 'Clip (4m 00s).mp4', (p) => taken.has(p))).toBe('Clip (4m 00s) (3).mp4');
    expect(freeFileName('/d', 'New.mp4', (p) => taken.has(p))).toBe('New.mp4');
  });
});

/** The bundled FFmpeg (pnpm fetch-ffmpeg), when it is here. */
const ffmpeg = join(
  __dirname,
  '..',
  '..',
  '..',
  'vendor',
  'ffmpeg',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
);
const work = mkdtempSync(join(tmpdir(), 'drashti-trim-'));

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe.skipIf(!existsSync(ffmpeg))('with the real FFmpeg', () => {
  it('finds the keyframe at or before a start, and copies from it with the picture and sound unchanged', async () => {
    const source = join(work, 'placeholder.mp4');
    const made = spawnSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=25',
      '-f',
      'lavfi',
      '-i',
      'sine=r=48000:f=440',
      '-t',
      '6',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '25',
      '-keyint_min',
      '25',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      source,
    ]);
    expect(made.status).toBe(0);
    // Keyframes every second: from 2.4 s, the one at 2 s.
    expect(await keyframeOf(ffmpeg, source, 2400)).toBe(2000);
    expect(await keyframeOf(ffmpeg, source, 3000)).toBe(3000);
    const out = join(work, 'part.mp4');
    expect(spawnSync(ffmpeg, trimArgs(source, out, 2000, 4000)).status).toBe(0);
    const said = spawnSync(ffmpeg, ['-hide_banner', '-i', out]).stderr.toString();
    const got = parseFfmpegInfo(said);
    expect(got.video).toMatchObject({ codec: 'h264', width: 320, height: 180 });
    expect(got.audio?.codec).toBe('aac');
    expect(Math.abs((got.durationMs ?? 0) - 2000)).toBeLessThanOrEqual(100);
    // Packets copied, not made again: the part's pictures are the source's from 2 s, byte for byte.
    const hashes = (file: string, extra: string[] = []) =>
      spawnSync(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        ...extra,
        '-i',
        file,
        '-map',
        '0:v',
        '-c',
        'copy',
        '-f',
        'framemd5',
        '-',
      ])
        .stdout.toString()
        .split('\n')
        .filter((l) => l !== '' && !l.startsWith('#'))
        .map((l) => l.split(',').at(-1)?.trim());
    const part = hashes(out);
    expect(part.length).toBe(50);
    expect(hashes(source).slice(50, 100)).toEqual(part);
  });
});
