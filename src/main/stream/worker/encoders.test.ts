import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STREAM_PRESETS } from '../../../shared/stream';
import { audioArgs, videoArgs } from './encoders';
import { ffmpegHere } from '../../testing/ffmpeg-here';

/*
 * The encoder's keyframes, with the real FFmpeg where it has been fetched (Session 27): one every 2 s and no
 * others, as the platforms ask, whatever the picture does. A hard cut late in the 2 s (a slide cut in, the
 * screen black before the show) used to bring one of its own from x264.
 */

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);

describe('the sound the encoder makes (Session 31, MED-3)', () => {
  it('goes through a limiter at -1 dBFS, with its own level setting off, before AAC: for every stream and recording', () => {
    for (const preset of Object.values(STREAM_PRESETS)) {
      const args = audioArgs(preset);
      const filter = args[args.indexOf('-af') + 1] ?? '';
      expect(args.indexOf('-af')).toBeGreaterThanOrEqual(0);
      expect(filter).toBe('alimiter=limit=-1dB:level=false');
      expect(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2)).toEqual(['-c:a', 'aac']);
    }
  });
});

describe.skipIf(!ffmpegHere(ffmpeg))("the software encoder's keyframes", () => {
  it('come every 2 s and only then, even across a hard cut late in the 2 s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-keyframes-'));
    try {
      const preset = { ...STREAM_PRESETS.weak, width: 320, height: 180, videoKbps: 800 };
      const file = join(dir, 'cut.flv');
      const made = spawnSync(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          `color=black:size=320x180:rate=${String(preset.fps)}:duration=3.6[b];testsrc2=size=320x180:rate=${String(preset.fps)}:duration=5[t];[b][t]concat=n=2:v=1`,
          ...videoArgs('libx264', preset),
          '-f',
          'flv',
          file,
        ],
        { encoding: 'utf8' },
      );
      expect(made.status, made.stderr).toBe(0);
      const shown = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-vf', 'showinfo', '-f', 'null', '-'], {
        encoding: 'utf8',
      });
      const keyframes = [...shown.stderr.matchAll(/pts_time:([\d.]+).*?iskey:1/gu)].map((m) => Number(m[1]));
      expect(keyframes).toEqual(keyframes.map((_, i) => i * preset.keyframeSeconds));
      expect(keyframes.length).toBeGreaterThanOrEqual(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
