import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegHere, testFfmpeg } from '../testing/ffmpeg-here';
import { fromAvcC, fromHvcC, h264Level, hevcLevel, movieVideo, readCodecLevel } from './codec-config';

/*
 * A video's level from its own codec record (alpha.20, Media information…; Q60-34): FFmpeg names an H.264's or an
 * HEVC's profile but never its level. The records' bytes by hand, and files made here by the bundled FFmpeg.
 */

describe('levels as people write them', () => {
  it('H.264’s by its level_idc, 1b included; none for a number that is no level', () => {
    expect(h264Level(31)).toBe('3.1');
    expect(h264Level(40)).toBe('4');
    expect(h264Level(42)).toBe('4.2');
    expect(h264Level(62)).toBe('6.2');
    expect(h264Level(9)).toBe('1b');
    expect(h264Level(77)).toBeNull();
    expect(h264Level(0)).toBeNull();
  });

  it('HEVC’s by its general_level_idc, thirty times the level', () => {
    expect(hevcLevel(30)).toBe('1');
    expect(hevcLevel(93)).toBe('3.1');
    expect(hevcLevel(120)).toBe('4');
    expect(hevcLevel(153)).toBe('5.1');
    expect(hevcLevel(186)).toBe('6.2');
    expect(hevcLevel(94)).toBeNull();
    expect(hevcLevel(0)).toBeNull();
  });
});

describe('a codec record’s bytes', () => {
  it('an AVC record: version 1, its profile, compatibility and level', () => {
    expect(fromAvcC(Uint8Array.from([1, 100, 0, 42, 0xff, 0xe1, 0]))).toEqual({
      codec: 'h264',
      profileIdc: 100,
      level: '4.2',
    });
    expect(fromAvcC(Uint8Array.from([1, 77, 0x40, 31, 0xff, 0xe1, 0]))).toEqual({
      codec: 'h264',
      profileIdc: 77,
      level: '3.1',
    });
    // Another version, a profile that is none, a level that is none, too short: none.
    expect(fromAvcC(Uint8Array.from([2, 100, 0, 42, 0xff, 0xe1, 0]))).toBeNull();
    expect(fromAvcC(Uint8Array.from([1, 99, 0, 42, 0xff, 0xe1, 0]))).toBeNull();
    expect(fromAvcC(Uint8Array.from([1, 100, 0, 43, 0xff, 0xe1, 0]))).toBeNull();
    expect(fromAvcC(Uint8Array.from([1, 100, 0, 42]))).toBeNull();
  });

  it('an HEVC record: its profile in the low five bits of byte 1, its level at byte 12', () => {
    const record = new Uint8Array(23);
    record[0] = 1;
    // Profile space 0, Main tier, Main 10 (2).
    record[1] = 0x02;
    record[12] = 153;
    expect(fromHvcC(record)).toEqual({ codec: 'hevc', profileIdc: 2, level: '5.1' });
    record[12] = 0;
    expect(fromHvcC(record)).toBeNull();
    expect(fromHvcC(record.subarray(0, 13))).toBeNull();
  });
});

describe('a movie box’s first picture (alpha.20, "Plays anything")', () => {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
  };
  const moov = (entry: Buffer) => {
    const whole = box(
      'moov',
      box(
        'trak',
        box(
          'mdia',
          box('hdlr', u32(0), u32(0), Buffer.from('vide', 'latin1'), Buffer.alloc(12)),
          box('minf', box('stbl', box('stsd', u32(0), u32(1), entry))),
        ),
      ),
    );
    return whole.subarray(8);
  };
  const fields = (width: number, height: number) => {
    const f = Buffer.alloc(78);
    f.writeUInt16BE(width, 24);
    f.writeUInt16BE(height, 26);
    return f;
  };

  it('its size from its sample entry, with its record', () => {
    expect(
      movieVideo(
        moov(box('avc1', fields(7680, 4320), box('avcC', Buffer.from([1, 66, 0, 62, 0xff, 0xe1, 0])))),
      ),
    ).toEqual({ codec: 'h264', profileIdc: 66, level: '6.2', width: 7680, height: 4320 });
    // No record (a sample entry cut short, or another codec's): nothing said.
    expect(movieVideo(moov(box('avc1', Buffer.alloc(16))))).toBeNull();
    expect(movieVideo(moov(box('apcn', fields(1920, 1080))))).toBeNull();
  });
});

const ffmpeg = testFfmpeg({ linux: true });

describe.skipIf(!ffmpegHere(ffmpeg))('a file’s own record, from files made by FFmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-codec-config-'));
  const make = (name: string, args: string[]): string => {
    const file = join(dir, name);
    const r = spawnSync(ffmpeg, [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=0.4'],
      ...args,
      file,
    ]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
    return file;
  };
  const x264 = (profile: string, level: string) => [
    ...['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
    ...['-profile:v', profile, '-level', level],
  ];

  it('an MP4’s, its movie box at its end (as FFmpeg writes one) or at its start', async () => {
    expect(await readCodecLevel(make('end.mp4', x264('high', '4.2')))).toEqual({
      codec: 'h264',
      profileIdc: 100,
      level: '4.2',
    });
    expect(
      await readCodecLevel(make('start.mp4', [...x264('main', '3.0'), '-movflags', '+faststart'])),
    ).toEqual({ codec: 'h264', profileIdc: 77, level: '3' });
  });

  it('a QuickTime file’s and a Matroska file’s', async () => {
    expect(await readCodecLevel(make('clip.mov', x264('high', '5.1')))).toEqual({
      codec: 'h264',
      profileIdc: 100,
      level: '5.1',
    });
    expect(await readCodecLevel(make('clip.mkv', x264('high', '3.1')))).toEqual({
      codec: 'h264',
      profileIdc: 100,
      level: '3.1',
    });
  });

  it('an HEVC MP4’s', async () => {
    const hevc = make('hevc.mp4', [
      ...['-c:v', 'libx265', '-pix_fmt', 'yuv420p'],
      ...['-x265-params', 'log-level=error:level-idc=4.1'],
    ]);
    expect(await readCodecLevel(hevc)).toEqual({ codec: 'hevc', profileIdc: 1, level: '4.1' });
  });

  it('none for a picture with no such record, a file that is no video, or no file', async () => {
    expect(
      await readCodecLevel(make('vp9.webm', ['-c:v', 'libvpx-vp9', '-deadline', 'realtime'])),
    ).toBeNull();
    const text = join(dir, 'notes.mp4');
    writeFileSync(text, 'Placeholder words, not a video.');
    expect(await readCodecLevel(text)).toBeNull();
    expect(await readCodecLevel(join(dir, 'gone.mp4'))).toBeNull();
  });
});
