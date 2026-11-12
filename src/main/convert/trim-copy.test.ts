import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { ffmpegHere } from '../testing/ffmpeg-here';
import type { ConvertService } from './convert-service';
import { frameAtOrBefore } from './frame-at';
import { parseFfmpegInfo } from './plan';
import type { MediaInfo } from './plan';
import { queueTrimCopy } from './trim-copy';
import type { TrimCopyInput } from './trim-copy';

const ffmpeg = join(
  process.cwd(),
  'vendor',
  'ffmpeg',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
);

const INFO: MediaInfo = {
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationMs: 1200,
  video: { codec: 'h264', pixFmt: 'yuv420p', width: 64, height: 48, still: false },
  audio: { codec: 'aac' },
};

function plan(input: TrimCopyInput) {
  const saveCopy = vi.fn<ConvertService['saveCopy']>(() => ({
    id: 'copy',
    done: Promise.resolve({ ok: true, copy: null }),
  }));
  const job = queueTrimCopy({ saveCopy }, input);
  const call = saveCopy.mock.calls[0];
  if (!call) throw new Error('Trim did not queue a copy');
  const [source, dest, info, copy] = call;
  return { job, source, dest, info, copy };
}

describe('queuing a trimmed video', () => {
  it('keeps the original path, queues beside it, and re-encodes exactly the selected part', () => {
    const path = join(tmpdir(), 'source.mp4');
    const output = join(tmpdir(), '.part.mp4');
    const waiting = vi.fn();
    const progress = vi.fn();
    const { source, dest, info, copy } = plan({
      path,
      name: 'Example: video.mov',
      info: INFO,
      startMs: 250,
      endMs: 650,
      waiting,
      progress,
    });
    expect(source).toBe(path);
    expect(dest).toBe(join(dirname(path), 'Example_ video trimmed.mp4'));
    expect(info).toBe(INFO);
    expect(copy).toMatchObject({ lengthMs: 400, waitForShow: true, waiting, progress });
    const args = copy.args(output);
    const seek = args.indexOf('-ss');
    expect(args.slice(seek, seek + 6)).toEqual(['-ss', '0.250', '-i', path, '-t', '0.400']);
    expect(args).toEqual(
      expect.arrayContaining([
        '-protocol_whitelist',
        'file',
        '0:V:0',
        '0:a:0',
        'libx264',
        'aac',
        '+faststart+use_metadata_tags',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
        'passthrough',
      ]),
    );
    expect(args).not.toContain('copy');
    expect(args.slice(-3)).toEqual(['-f', 'mp4', output]);
  });

  it('keeps dots that are part of the video’s display name', () => {
    const { dest } = plan({
      path: join(tmpdir(), 'source.mp4'),
      name: 'Placeholder v1.2',
      info: INFO,
      startMs: 250,
      endMs: 650,
    });
    expect(basename(dest)).toBe('Placeholder v1.2 trimmed.mp4');
  });

  it('keeps a transparent WebM transparent and handles a silent video', () => {
    const path = join(tmpdir(), 'source.webm');
    const output = join(tmpdir(), '.part.mp4');
    const { dest, copy } = plan({
      path,
      name: 'Example.webm',
      info: {
        ...INFO,
        video: { codec: 'vp9', pixFmt: 'yuv420p', width: 64, height: 48, still: false },
        audio: null,
      },
      alpha: true,
      startMs: 250,
      endMs: 650,
    });
    expect(basename(dest)).toBe('Example trimmed.webm');
    const args = copy.args(output);
    expect(args.slice(args.indexOf('-c:V:0'), args.indexOf('-i'))).toEqual([
      '-c:V:0',
      'libvpx-vp9',
      '-ss',
      '0.250',
    ]);
    expect(args).toContain('yuva420p');
    expect(args).not.toContain('0:a:0');
    expect(args.slice(-3)).toEqual(['-f', 'webm', output]);
  });
});

function run(args: string[]): Buffer {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    env: ffmpegEnv(),
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

function probe(path: string): MediaInfo {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', path], { env: ffmpegEnv(), windowsHide: true });
  return parseFfmpegInfo(result.stderr.toString());
}

describe.skipIf(!ffmpegHere(ffmpeg))('trimming with the bundled FFmpeg', () => {
  it('keeps the frame displayed between timestamps and the chosen part with converted sound', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-trim-copy-'));
    try {
      const path = join(dir, 'Example.mkv');
      run([
        '-f',
        'lavfi',
        '-i',
        "nullsrc=s=64x48:r=10,geq=lum='16+12*N':cb=128:cr=128",
        '-f',
        'lavfi',
        '-i',
        'sine=r=48000:f=440',
        '-t',
        '1.2',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-g',
        '100',
        '-sc_threshold',
        '0',
        '-c:a',
        'pcm_s16le',
        path,
      ]);
      const before = readFileSync(path);
      const date = statSync(path).mtimeMs;
      const info = probe(path);
      const startMs = await frameAtOrBefore(ffmpeg, path, 250);
      expect(startMs).toBe(200);
      if (startMs === null) throw new Error('The source frame could not be read.');
      const { dest, copy } = plan({ path, name: 'Example.mkv', info, startMs, endMs: 650 });
      run(copy.args(dest));
      const another = join(dir, 'Another cut.mp4');
      run(plan({ path, name: 'Example.mkv', info, startMs, endMs: 650 }).copy.args(another));
      expect(readFileSync(dest)).not.toEqual(readFileSync(another));
      const kept = probe(dest);
      expect(kept.video).toMatchObject({ codec: 'h264', width: 64, height: 48, pixFmt: 'yuv420p' });
      expect(kept.audio?.codec).toBe('aac');
      const frames = run([
        '-i',
        dest,
        '-map',
        '0:V:0',
        '-fps_mode',
        'passthrough',
        '-pix_fmt',
        'yuv420p',
        '-f',
        'rawvideo',
        '-',
      ]);
      // Start at 250 ms shows the frame from 200 ms. The cut keeps it and the next four frames.
      const frameSize = (64 * 48 * 3) / 2;
      expect(frames.length).toBe(5 * frameSize);
      [40, 52, 64, 76, 88].forEach((shade, index) => {
        expect(Math.abs((frames[index * frameSize] ?? 0) - shade)).toBeLessThanOrEqual(2);
      });
      expect(readFileSync(path).equals(before)).toBe(true);
      expect(statSync(path).mtimeMs).toBe(date);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a generated translucent WebM’s alpha channel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-trim-alpha-'));
    try {
      const path = join(dir, 'Example.webm');
      run([
        '-f',
        'lavfi',
        '-i',
        'color=c=red@0.5:s=64x48:r=10,format=yuva420p',
        '-t',
        '1',
        '-c:v',
        'libvpx-vp9',
        '-auto-alt-ref',
        '0',
        path,
      ]);
      const { dest, copy } = plan({
        path,
        name: 'Example.webm',
        info: probe(path),
        alpha: true,
        startMs: 250,
        endMs: 650,
      });
      run(copy.args(dest));
      const plane = run([
        '-c:v',
        'libvpx-vp9',
        '-i',
        dest,
        '-frames:v',
        '1',
        '-vf',
        'alphaextract',
        '-f',
        'rawvideo',
        '-',
      ]);
      expect(plane.length).toBe(64 * 48);
      expect(plane[0]).toBeGreaterThan(120);
      expect(plane[0]).toBeLessThan(135);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
