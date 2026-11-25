import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaInfo } from '../convert/plan';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { ffmpegHere, testFfmpeg } from '../testing/ffmpeg-here';
import {
  PAGE_COPIES_DIR,
  pageCopiesIn,
  pageCopyArgs,
  pageCopyName,
  pageCopyPlan,
  removePageCopiesOf,
  sweepPageCopies,
} from './page-copies';

/*
 * Page copies (QA23-FADE-9 candidate 1): which videos get one, that a copy keeps its source's timeline exactly, and
 * that the sweep deletes a copy only with its source or when its source's bytes change. Generated placeholder videos
 * and files only.
 */

const ffmpeg = testFfmpeg({ linux: true });
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'drashti-page-copies-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const VIDEO_1080: NonNullable<MediaInfo['video']> = {
  codec: 'vp8',
  pixFmt: 'yuv420p',
  width: 1920,
  height: 1080,
  still: false,
};
const webm1080: MediaInfo = {
  container: 'matroska,webm',
  durationMs: 3000,
  video: VIDEO_1080,
  audio: { codec: 'opus' },
};

describe('which videos get a page copy', () => {
  it('a 1080p video gets a 720p and a 540p copy in its own container and codec family', () => {
    expect(pageCopyPlan(webm1080, 720)).toEqual({ width: 1280, height: 720, ext: 'webm' });
    expect(pageCopyPlan(webm1080, 540)).toEqual({ width: 960, height: 540, ext: 'webm' });
    const mp4 = {
      ...webm1080,
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      video: { ...VIDEO_1080, codec: 'h264' },
    };
    expect(pageCopyPlan(mp4, 720)).toEqual({ width: 1280, height: 720, ext: 'mp4' });
  });

  it('none for a video no taller than the page draws it, a still, transparency, interlacing or another format', () => {
    const at = (video: Partial<NonNullable<MediaInfo['video']>>, container = 'matroska,webm') =>
      pageCopyPlan({ ...webm1080, container, video: { ...VIDEO_1080, ...video } }, 720);
    expect(at({ width: 1280, height: 720 })).toBeNull();
    expect(at({ width: 960, height: 540 })).toBeNull();
    expect(at({ still: true })).toBeNull();
    expect(at({ pixFmt: 'yuva420p' })).toBeNull();
    expect(at({ interlaced: true })).toBeNull();
    expect(at({ width: 1080, height: 1920 }), 'portrait: the pages draw 16:9').toBeNull();
    expect(at({}, 'avi')).toBeNull();
    expect(at({ codec: 'hevc' }, 'mov,mp4,m4a,3gp,3g2,mj2')).toBeNull();
    expect(pageCopyPlan({ ...webm1080, video: null }, 720)).toBeNull();
  });
});

/** Each frame's time and whether it is a keyframe, and the sound's packets' hashes, as FFmpeg reads a file. */
function timeline(file: string) {
  const video = spawnSync(
    ffmpeg,
    ['-hide_banner', '-i', file, '-map', '0:v:0', '-vf', 'showinfo', '-f', 'null', '-'],
    {
      encoding: 'utf8',
      env: ffmpegEnv(),
    },
  );
  const frames = [...video.stderr.matchAll(/pts_time:(\S+).*?iskey:(\d)/gu)].map((m) => ({
    t: Number(m[1]),
    key: m[2] === '1',
  }));
  const sound = spawnSync(
    ffmpeg,
    ['-hide_banner', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'framemd5', '-'],
    {
      encoding: 'utf8',
      env: ffmpegEnv(),
    },
  );
  const packets = sound.stdout.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const size = [...video.stderr.matchAll(/ s:(\d+)x(\d+)/gu)][0];
  return { frames, packets, width: Number(size?.[1]), height: Number(size?.[2]) };
}

describe.skipIf(!ffmpegHere(ffmpeg))('a page copy keeps its source’s timeline exactly', () => {
  const make = (dir: string, name: string, video: string[], sound: string[]) => {
    const file = join(dir, name);
    const r = spawnSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=1920x1080:r=30:d=3',
        '-f',
        'lavfi',
        '-i',
        'sine=f=440:d=3:sample_rate=48000',
        '-force_key_frames',
        'expr:gte(t,n_forced*0.5)',
        ...video,
        ...sound,
        '-shortest',
        '-y',
        file,
      ],
      { env: ffmpegEnv() },
    );
    if (r.status !== 0) throw new Error('could not make the placeholder video');
    return file;
  };
  for (const kind of [
    {
      name: 'placeholder.webm',
      info: webm1080,
      video: ['-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8'],
      sound: ['-c:a', 'libopus'],
    },
    {
      name: 'placeholder.mp4',
      info: {
        ...webm1080,
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        video: { ...VIDEO_1080, codec: 'h264' },
        audio: { codec: 'aac' },
      },
      video: ['-c:v', 'libx264', '-preset', 'ultrafast'],
      sound: ['-c:a', 'aac'],
    },
  ])
    it(`${kind.name}: every frame at the same time, the same keyframes, the same sound, only smaller`, () => {
      const dir = temp();
      const source = make(dir, kind.name, kind.video, kind.sound);
      const plan = pageCopyPlan(kind.info, 720);
      if (!plan) throw new Error('no plan');
      const out = join(dir, `copy.${plan.ext}`);
      const r = spawnSync(ffmpeg, pageCopyArgs(source, out, kind.info, plan), { env: ffmpegEnv() });
      expect(r.status, String(r.stderr)).toBe(0);
      const a = timeline(source),
        b = timeline(out);
      expect(a.frames.length).toBe(90);
      expect(
        b.frames.map((f) => f.t),
        'each frame at its source frame’s time',
      ).toEqual(a.frames.map((f) => f.t));
      expect(
        b.frames.filter((f) => f.key).map((f) => f.t),
        'keyframes where the source has them, and nowhere else',
      ).toEqual(a.frames.filter((f) => f.key).map((f) => f.t));
      expect(b.packets.length).toBeGreaterThan(50);
      expect(b.packets, 'the sound’s own packets, copied').toEqual(a.packets);
      expect([b.width, b.height]).toEqual([1280, 720]);
    });
});

describe('the sweep deletes a copy only with its source, or when its source changes', () => {
  const folder = (mediaDir: string) => join(mediaDir, PAGE_COPIES_DIR);
  const put = (mediaDir: string, names: string[]) => {
    mkdirSync(folder(mediaDir), { recursive: true });
    for (const n of names) writeFileSync(join(folder(mediaDir), n), 'placeholder');
  };
  const left = (mediaDir: string) => readdirSync(folder(mediaDir)).sort();

  it('keeps every copy of a source still in the library', async () => {
    const dir = temp();
    put(dir, [pageCopyName(SHA_A, 720, 'webm'), pageCopyName(SHA_A, 540, 'webm')]);
    expect(await sweepPageCopies(dir, new Set([SHA_A]))).toEqual([]);
    expect(left(dir)).toHaveLength(2);
  });

  it('deletes the copies of a source that is gone, and only those', async () => {
    const dir = temp();
    put(dir, [
      pageCopyName(SHA_A, 720, 'webm'),
      pageCopyName(SHA_B, 720, 'mp4'),
      pageCopyName(SHA_B, 540, 'mp4'),
    ]);
    const gone = await sweepPageCopies(dir, new Set([SHA_A]));
    expect(gone.sort()).toEqual([pageCopyName(SHA_B, 540, 'mp4'), pageCopyName(SHA_B, 720, 'mp4')]);
    expect(left(dir)).toEqual([pageCopyName(SHA_A, 720, 'webm')]);
  });

  it('a source whose bytes changed: its old copies go, the new bytes’ copies stay', async () => {
    const dir = temp();
    // The same media row now holds the bytes SHA_C, not SHA_A: only SHA_C is in the library.
    put(dir, [pageCopyName(SHA_A, 720, 'webm'), pageCopyName(SHA_C, 720, 'webm')]);
    expect(await sweepPageCopies(dir, new Set([SHA_C]))).toEqual([pageCopyName(SHA_A, 720, 'webm')]);
    expect(left(dir)).toEqual([pageCopyName(SHA_C, 720, 'webm')]);
  });

  it('never touches anything not named exactly as a copy: other files, unfinished work, folders, other heights', async () => {
    const dir = temp();
    const strangers = [
      'notes.txt',
      `${SHA_B}-720p.webm.part`,
      `${SHA_B}-480p.webm`,
      `${SHA_B}-720p.mov`,
      `${'B'.repeat(64)}-720p.webm`,
      `${SHA_B.slice(1)}-720p.webm`,
    ];
    put(dir, strangers);
    mkdirSync(join(folder(dir), `${SHA_B}-720p.webm.d`));
    // And a file of the copy's name outside the folder: never looked at.
    writeFileSync(join(dir, pageCopyName(SHA_B, 720, 'webm')), 'placeholder');
    expect(await sweepPageCopies(dir, new Set())).toEqual([]);
    expect(left(dir)).toEqual([...strangers, `${SHA_B}-720p.webm.d`].sort());
    expect(existsSync(join(dir, pageCopyName(SHA_B, 720, 'webm')))).toBe(true);
  });

  it('a library with no copies folder: nothing happens', async () => {
    const dir = temp();
    expect(await sweepPageCopies(dir, new Set())).toEqual([]);
    expect(existsSync(folder(dir))).toBe(false);
  });

  it('removing a source deletes its own copies only', async () => {
    const dir = temp();
    put(dir, [
      pageCopyName(SHA_A, 720, 'webm'),
      pageCopyName(SHA_A, 540, 'mp4'),
      pageCopyName(SHA_B, 720, 'webm'),
      'notes.txt',
    ]);
    await removePageCopiesOf(dir, SHA_A);
    expect(left(dir)).toEqual([pageCopyName(SHA_B, 720, 'webm'), 'notes.txt'].sort());
  });

  it('lists the copies there by source, with their heights', async () => {
    const dir = temp();
    put(dir, [pageCopyName(SHA_A, 720, 'webm'), pageCopyName(SHA_A, 540, 'webm'), 'notes.txt']);
    const found = await pageCopiesIn(dir);
    expect([...found.keys()]).toEqual([SHA_A]);
    expect([...(found.get(SHA_A) ?? [])].sort()).toEqual([540, 720]);
  });
});
