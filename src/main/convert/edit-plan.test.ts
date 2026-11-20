import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLAIN_VIDEO_EDIT, type VideoEditRecipe } from '../../shared/video-edit';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { testFfmpeg, ffmpegHere } from '../testing/ffmpeg-here';
import { parseFfmpegInfo, type MediaInfo } from './plan';
import { editPlan } from './edit-plan';

const ffmpeg = testFfmpeg({ linux: true });
const available = ffmpegHere(ffmpeg);
let dir = '';
let source = '';
let before = '';
const INFO: MediaInfo = {
  durationMs: 4000,
  video: { codec: 'h264', pixFmt: 'yuv420p', width: 160, height: 90, still: false },
  audio: { codec: 'aac' },
};
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function ff(args: string[]) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', ...args], {
    env: ffmpegEnv(),
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(
      `Generated-media FFmpeg failed (${String(r.status)}): ${r.stderr.toString().slice(-1800)}`,
    );
  return r;
}
function render(recipe: VideoEditRecipe, name: string) {
  const plan = editPlan({ file: source, recipe, info: INFO, identity: name });
  const output = join(dir, `${name}.${plan.target}`);
  ff(plan.args(output));
  expect(hash(source)).toBe(before);
  return { plan, output };
}
function pixel(file: string, seconds: number) {
  const r = ff([
    '-loglevel',
    'error',
    '-ss',
    String(seconds),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    'scale=1:1',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  return [...r.stdout.subarray(0, 3)];
}
function audio(file: string) {
  return ff(['-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'])
    .stdout;
}
function band(bytes: Buffer, hz: number) {
  let real = 0;
  let imaginary = 0;
  const samples = Math.min(8000, bytes.length / 4);
  for (let i = 0; i < samples; i++) {
    const sample = bytes.readFloatLE(i * 4);
    const phase = (2 * Math.PI * hz * i) / 8000;
    real += sample * Math.cos(phase);
    imaginary += sample * Math.sin(phase);
  }
  return real * real + imaginary * imaginary;
}

describe.runIf(available)('one prepared video, original untouched', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-edit-plan-'));
    source = join(dir, 'Placeholder source.mp4');
    ff([
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=160x90:r=25:d=4',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:r=48000:d=4',
      '-f',
      'lavfi',
      '-i',
      'sine=f=880:r=48000:d=4',
      '-filter_complex',
      '[0:v]drawbox=x=80:w=80:h=90:color=blue:t=fill[v]',
      '-map',
      '[v]',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads:v',
      '1',
      '-c:a',
      'aac',
      source,
    ]);
    before = hash(source);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('uses source-time trim, requested speed and the chosen audio without changing its pitch', () => {
    const recipe = { ...PLAIN_VIDEO_EDIT, trim: { startMs: 1000, endMs: 3000 }, speed: 2, audioTrack: 1 };
    const { plan, output } = render(recipe, 'speed-track');
    expect(plan.durationMs).toBe(1000);
    expect(plan.sourceStartMs).toBe(1000);
    const read = ff(['-i', output, '-map', '0:v:0', '-f', 'null', '-']).stderr.toString();
    expect(parseFfmpegInfo(read).durationMs).toBeGreaterThanOrEqual(950);
    expect(parseFfmpegInfo(read).durationMs).toBeLessThanOrEqual(1100);
    const samples = audio(output);
    expect(band(samples, 880)).toBeGreaterThan(band(samples, 440) * 20);
    expect(band(samples, 880)).toBeGreaterThan(band(samples, 1760) * 20);
  });
  it('turns then flips then crops the requested part, with Original shape following that part', () => {
    const recipe: VideoEditRecipe = {
      ...PLAIN_VIDEO_EDIT,
      picture: { ...PLAIN_VIDEO_EDIT.picture, turn: 90, flipX: true, crop: { x: 0, y: 0, w: 1, h: 0.5 } },
    };
    const { output } = render(recipe, 'geometry');
    const read = parseFfmpegInfo(ff(['-i', output, '-map', '0:v:0', '-f', 'null', '-']).stderr.toString());
    expect(read.video).toMatchObject({ width: 90, height: 80 });
    const rgb = pixel(output, 1);
    expect(rgb[0]).toBeGreaterThan(180);
    expect(rgb[2]).toBeLessThan(60);
  });
  it('bakes picture/sound fades once, with the end black and quiet', () => {
    const recipe = {
      ...PLAIN_VIDEO_EDIT,
      fades: { pictureInMs: 200, pictureOutMs: 800, soundInMs: 200, soundOutMs: 800 },
    };
    const { output } = render(recipe, 'fades');
    const middle = pixel(output, 2);
    const end = pixel(output, 3.96);
    expect((middle[0] ?? 0) + (middle[2] ?? 0)).toBeGreaterThan(150);
    expect(Math.max(...end)).toBeLessThan(30);
    const bytes = audio(output);
    const rms = (from: number, to: number) => {
      let power = 0;
      let n = 0;
      for (let i = from; i < Math.min(to, bytes.length / 4); i++) {
        power += bytes.readFloatLE(i * 4) ** 2;
        n++;
      }
      return Math.sqrt(power / Math.max(1, n));
    };
    expect(rms(31000, 31800)).toBeLessThan(rms(12000, 12800) * 0.3);
  });
});

it('refuses invalid source intervals instead of exporting an empty or different cut', () => {
  expect(() =>
    editPlan({
      file: 'Placeholder.mp4',
      recipe: { ...PLAIN_VIDEO_EDIT, trim: { startMs: 5000, endMs: 6000 } },
      info: INFO,
      identity: 'bad',
    }),
  ).toThrow();
});
