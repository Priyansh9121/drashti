import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ffmpegHere } from '../testing/ffmpeg-here';
import { edgePoints, findEdges, parseEdges, parseLength, parseLoudness, readSound } from './read-sound';

/*
 * Session 55, Part 7: a video's or sound's loudness (EBU R128) and length read with FFmpeg, and the black and silence
 * at a video's start and end found for its points. FFmpeg's own words, and the bundled FFmpeg itself on media it
 * makes from its test sources (a tone, colours, silence) where it is there. The file is never changed.
 */

const SUMMARY = `Input #0, wav, from 'tone.wav':
  Duration: 00:00:05.50, bitrate: 1536 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s16, 1536 kb/s
[Parsed_ebur128_0 @ 0x14bf040b0] Summary:

  Integrated loudness:
    I:         -32.9 LUFS
    Threshold: -43.0 LUFS

  Loudness range:
    LRA:         2.3 LU
    Threshold: -53.6 LUFS
    LRA low:   -34.9 LUFS
    LRA high:  -32.6 LUFS

  True peak:
    Peak:      -32.0 dBFS
[out#0/null @ 0x14d0045f0] video:0KiB audio:1031KiB subtitle:0KiB other streams:0KiB
size=N/A time=00:00:05.50 bitrate=N/A speed= 199x elapsed=0:00:00.02
`;

describe('what FFmpeg says of a file’s sound', () => {
  it('its integrated loudness and true peak, from the meter’s summary', () => {
    expect(parseLoudness(SUMMARY)).toEqual({ lufs: -32.9, peak: -32 });
    // Windows' line ends, and silence (−70 LUFS, a peak of −inf).
    expect(parseLoudness(SUMMARY.replace('-32.0 dBFS', '-inf dBFS').replaceAll('\n', '\r\n'))).toEqual({
      lufs: -32.9,
      peak: null,
    });
    expect(parseLoudness('Input #0, wav\n')).toBeNull();
  });

  it('its length: the container’s, else how far it decoded', () => {
    expect(parseLength(SUMMARY)).toBe(5500);
    expect(parseLength('  Duration: N/A, bitrate: N/A\nsize=N/A time=00:01:02.25 bitrate=N/A\n')).toBe(
      62_250,
    );
    expect(parseLength('nothing')).toBeNull();
  });

  it('the black and the silence it found, a run that read the end counted from where it began', () => {
    const text = [
      '[Parsed_silencedetect_0 @ 0x1] silence_start: 0',
      '[Parsed_silencedetect_0 @ 0x1] silence_end: 1.500062 | silence_duration: 1.500062',
      '[Parsed_blackdetect_0 @ 0x2] black_start:0 black_end:1.5 black_duration:1.5',
      '[Parsed_silencedetect_0 @ 0x1] silence_start: 4.499958',
      '[Parsed_blackdetect_0 @ 0x2] black_start:4.5 black_end:5.466667 black_duration:0.966667',
    ].join('\r\n');
    expect(parseEdges(text, 0, 5.5)).toEqual({
      black: [
        { start: 0, end: 1.5 },
        { start: 4.5, end: 5.466667 },
      ],
      // Silent to the end of what was read.
      silence: [
        { start: 0, end: 1.500062 },
        { start: 4.499958, end: 5.5 },
      ],
    });
    expect(parseEdges('black_start:1 black_end:1.966667', 118).black).toEqual([
      { start: 119, end: 119.966667 },
    ]);
  });
});

describe('a video’s points past the black and silence at its start and end', () => {
  const black = [
    { start: 0, end: 1.5 },
    { start: 4.5, end: 5.466667 },
  ];
  const silence = [
    { start: 0, end: 1.5 },
    { start: 4.5, end: 5.5 },
  ];

  it('start where the picture and the sound begin, end where both have ended', () => {
    expect(edgePoints({ black, silence }, 5.5, true)).toEqual({ startMs: 1500, endMs: 4500 });
  });

  it('never cuts what is seen or heard: black with sound, or a picture with silence, stays', () => {
    // Black at the start, but the sound begins at once.
    expect(edgePoints({ black, silence: [{ start: 4.5, end: 5.5 }] }, 5.5, true)).toEqual({
      startMs: 0,
      endMs: 4500,
    });
    // Silence at the end, but a picture to its end.
    expect(edgePoints({ black: [{ start: 0, end: 1.5 }], silence }, 5.5, true)).toEqual({
      startMs: 1500,
      endMs: null,
    });
    // The black ending first: the start is where the picture begins (the sound came first).
    expect(
      edgePoints({ black: [{ start: 0, end: 0.8 }], silence: [{ start: 0, end: 2 }] }, 5.5, true),
    ).toEqual({ startMs: 800, endMs: null });
  });

  it('a video with no sound track goes by its black alone; nothing worth a point, or nothing left, is none', () => {
    expect(edgePoints({ black, silence: [] }, 5.5, false)).toEqual({ startMs: 1500, endMs: 4500 });
    expect(edgePoints({ black: [{ start: 0, end: 0.05 }], silence: [] }, 5.5, false)).toBeNull();
    expect(edgePoints({ black: [], silence: [] }, 5.5, true)).toBeNull();
    // All black and silent: left as it is.
    expect(
      edgePoints({ black: [{ start: 0, end: 5.5 }], silence: [{ start: 0, end: 5.5 }] }, 5.5, true),
    ).toBeNull();
  });
});

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);
const dir = mkdtempSync(join(tmpdir(), 'drashti-read-sound-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const make = (args: string[]) => {
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (made.status !== 0) throw new Error(made.stderr.toString());
};

describe.skipIf(!ffmpegHere(ffmpeg))(
  'the bundled FFmpeg reading made media (generated sound and video only)',
  () => {
    it('measures a tone’s loudness and length; a silent clip and a video with no sound track have no sound', async () => {
      const loud = join(dir, 'Placeholder loud tone.wav');
      make(['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=4', '-af', 'volume=4', loud]);
      const quiet = join(dir, 'Placeholder quiet tone.wav');
      make(['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=4', '-af', 'volume=0.1', quiet]);
      const silent = join(dir, 'Placeholder silence.wav');
      make(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', silent]);
      const mute = join(dir, 'Placeholder mute clip.mp4');
      make(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=3', '-pix_fmt', 'yuv420p', mute]);

      const a = await readSound(ffmpeg, loud);
      const b = await readSound(ffmpeg, quiet);
      expect(a).toMatchObject({ lengthMs: 4000, audio: true });
      expect(b).toMatchObject({ lengthMs: 4000, audio: true });
      // 32 times quieter (4 against 0.1) is 32 dB down.
      expect((a.loudness?.lufs ?? 0) - (b.loudness?.lufs ?? 0)).toBeCloseTo(32, 0);
      expect(a.loudness?.peak).toBeGreaterThan(b.loudness?.peak ?? 0);
      const s = await readSound(ffmpeg, silent);
      expect(s.audio).toBe(true);
      expect(s.loudness?.lufs).toBeLessThanOrEqual(-70);
      expect(await readSound(ffmpeg, mute)).toEqual({
        lengthMs: 3000,
        audio: false,
        loudness: { lufs: null, peak: null },
      });
      // Not a file FFmpeg can read: nothing measured.
      expect((await readSound(ffmpeg, join(dir, 'not there.wav'))).loudness).toBeNull();
    });

    it('finds the black and silence at a video’s start and end, short or long', async () => {
      const clip = join(dir, 'Placeholder edges.mp4');
      // 1.5 s black and silent, 3 s of colour and a tone, 1 s black and silent.
      make([
        ...['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30:d=1.5'],
        ...['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=3'],
        ...['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30:d=1'],
        ...['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1.5'],
        ...['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=3'],
        ...['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1'],
        '-filter_complex',
        '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[4:a]aformat=channel_layouts=stereo[s];[3:a][s][5:a]concat=n=3:v=0:a=1[a]',
        ...['-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip],
      ]);
      const read = await readSound(ffmpeg, clip);
      const points = await findEdges(ffmpeg, clip, read.lengthMs ?? 0, read.audio);
      expect(points?.startMs).toBeGreaterThanOrEqual(1400);
      expect(points?.startMs).toBeLessThanOrEqual(1600);
      expect(points?.endMs).toBeGreaterThanOrEqual(4400);
      expect(points?.endMs).toBeLessThanOrEqual(4600);

      // Longer than two minutes: the first and last minute read, the end's times counted from the file's start.
      const long = join(dir, 'Placeholder long.mp4');
      make([
        ...['-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=5:d=2'],
        ...['-f', 'lavfi', '-i', 'color=c=red:s=64x36:r=5:d=126'],
        ...['-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=5:d=2'],
        '-filter_complex',
        '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
        ...['-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', long],
      ]);
      const longRead = await readSound(ffmpeg, long);
      expect(longRead).toMatchObject({ lengthMs: 130_000, audio: false });
      const longPoints = await findEdges(ffmpeg, long, 130_000, false);
      expect(longPoints?.startMs).toBeGreaterThanOrEqual(1800);
      expect(longPoints?.startMs).toBeLessThanOrEqual(2200);
      expect(longPoints?.endMs).toBeGreaterThanOrEqual(127_800);
      expect(longPoints?.endMs).toBeLessThanOrEqual(128_200);
    });
  },
);
