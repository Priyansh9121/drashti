import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rm as rmPromise } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaInfo } from '../convert/plan';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { ffmpegHere, testFfmpeg } from '../testing/ffmpeg-here';
import {
  PAGE_COPIES_DIR,
  PAGE_COPY_HEIGHTS,
  pageCopiesIn,
  pageCopiesMayWork,
  pageCopyArgs,
  pageCopyCheck,
  pageCopyInspect,
  pageCopyName,
  pageCopyPlan,
  pageCopySource,
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

describe('how a page copy is made and checked (a22-review-fadecopies)', () => {
  it('one thread for its decoding and filtering too, given before the input as the lighter copies do (S2), and never a cover picture', () => {
    const plan = pageCopyPlan(webm1080, 720);
    if (!plan) throw new Error('no plan');
    const args = pageCopyArgs('in.webm', 'out.webm', webm1080, plan);
    const input = args.indexOf('-i');
    const at = (name: string) => args.findIndex((a, i) => a === name && args[i + 1] === '1');
    expect(at('-threads'), '-threads 1 before the input').toBeGreaterThanOrEqual(0);
    expect(at('-threads')).toBeLessThan(input);
    expect(at('-filter_threads'), '-filter_threads 1 before the input').toBeGreaterThanOrEqual(0);
    expect(at('-filter_threads')).toBeLessThan(input);
    expect(args[args.indexOf('-map') + 1], 'the first real video, never an attached picture').toBe('0:V:0');
  });

  it('a copy is published only if FFmpeg reads it back as planned: its size, its length within a frame, its sound (M1)', () => {
    const plan = pageCopyPlan(webm1080, 720);
    if (!plan) throw new Error('no plan');
    const check = pageCopyCheck(webm1080, plan);
    const good: MediaInfo = { ...webm1080, video: { ...VIDEO_1080, width: 1280, height: 720 } };
    expect(check(good)).toBeUndefined();
    expect(check({ ...good, durationMs: 3020 }), 'within a frame').toBeUndefined();
    expect(typeof check({ ...good, video: { ...VIDEO_1080, width: 1920, height: 1080 } })).toBe('string');
    expect(typeof check({ ...good, video: null })).toBe('string');
    expect(typeof check({ ...good, durationMs: 2900 }), 'a tenth of a second short').toBe('string');
    expect(typeof check({ ...good, durationMs: null })).toBe('string');
    expect(typeof check({ ...good, audio: null }), 'its sound lost').toBe('string');
  });

  it('copies are made only while nothing is up or armed: not on air, not recording, no cue waiting for Go (S11)', () => {
    const idle = { streamInUse: false, onAir: false, layersUp: false, cueArmed: false };
    expect(pageCopiesMayWork(idle)).toBe(true);
    expect(pageCopiesMayWork({ ...idle, cueArmed: true }), 'every page warms its decoder for a cue').toBe(false);
    expect(pageCopiesMayWork({ ...idle, layersUp: true })).toBe(false);
    expect(pageCopiesMayWork({ ...idle, streamInUse: true })).toBe(false);
    expect(pageCopiesMayWork({ ...idle, onAir: true })).toBe(false);
  });

  it('a copy is made of what the engine plays for a playlist’s video: its Edit Video version, then its lighter copy (S1)', () => {
    const edit = (readyMediaId: string | null) => ({ readyMediaId });
    const proxyNone = (id: string) => ({ mediaId: id });
    // Plain: the video itself.
    expect(pageCopySource('clip', { edit: () => edit('clip'), proxy: proxyNone })).toBe('clip');
    expect(pageCopySource('clip', { edit: () => null, proxy: proxyNone })).toBe('clip');
    // Edited: its prepared version; still preparing (or failed): none, the engine does not show the original for it.
    expect(pageCopySource('clip', { edit: () => edit('clip-edited'), proxy: proxyNone })).toBe('clip-edited');
    expect(pageCopySource('clip', { edit: () => edit(null), proxy: proxyNone })).toBeNull();
    // Over 1080p on a slow computer: its lighter copy, or none while that is preparing.
    expect(pageCopySource('clip', { edit: () => edit('clip'), proxy: () => ({ mediaId: 'clip-lighter' }) })).toBe(
      'clip-lighter',
    );
    expect(pageCopySource('clip', { edit: () => edit('clip'), proxy: () => ({ mediaId: null }) })).toBeNull();
    // Both: the edited version's lighter copy.
    expect(
      pageCopySource('clip', {
        edit: () => edit('clip-edited'),
        proxy: (id) => ({ mediaId: id === 'clip-edited' ? 'clip-edited-lighter' : id }),
      }),
    ).toBe('clip-edited-lighter');
  });
});

/**
 * Each frame's time and whether it is a keyframe, and the sound's packets' hashes, as FFmpeg reads a file on its own
 * timeline (`-copyts`: a copy shifted as a whole against its source is caught), and the file's own Duration and start
 * (a looping background is placed at `elapsed mod` its element's duration: a frame longer drifts on every loop).
 */
function timeline(file: string) {
  const video = spawnSync(
    ffmpeg,
    ['-hide_banner', '-copyts', '-i', file, '-map', '0:v:0', '-vf', 'showinfo', '-f', 'null', '-'],
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
    ['-hide_banner', '-copyts', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'framemd5', '-'],
    {
      encoding: 'utf8',
      env: ffmpegEnv(),
    },
  );
  const packets = sound.stdout.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const size = [...video.stderr.matchAll(/ s:(\d+)x(\d+)/gu)][0];
  const length = /Duration: (\S+), start: (\S+),/u.exec(video.stderr);
  return {
    frames,
    packets,
    width: Number(size?.[1]),
    height: Number(size?.[2]),
    duration: length?.[1] ?? null,
    start: length?.[2] ?? null,
  };
}

const MP4: MediaInfo = {
  ...webm1080,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  video: { ...VIDEO_1080, codec: 'h264' },
  audio: { codec: 'aac' },
};

describe.skipIf(!ffmpegHere(ffmpeg))('a page copy keeps its source’s timeline exactly', () => {
  const make = (dir: string, name: string, video: string[], sound: string[], more: string[] = []) => {
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
        ...more,
        '-shortest',
        '-y',
        file,
      ],
      { env: ffmpegEnv() },
    );
    if (r.status !== 0) throw new Error('could not make the placeholder video');
    return file;
  };
  // As real files are (a22-review-fadecopies M3): VP8 and VP9 in WebM; camera-like H.264 with B-frames and AAC (whose
  // priming is an edit list in MP4); and a file whose timeline starts 1.5 s in.
  const kinds = [
    {
      name: 'vp8.webm',
      info: webm1080,
      video: ['-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8'],
      sound: ['-c:a', 'libopus'],
    },
    {
      name: 'vp9.webm',
      info: { ...webm1080, video: { ...VIDEO_1080, codec: 'vp9' } },
      video: ['-c:v', 'libvpx-vp9', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1'],
      sound: ['-c:a', 'libopus'],
    },
    {
      name: 'h264.mp4',
      info: MP4,
      video: ['-c:v', 'libx264', '-preset', 'ultrafast'],
      sound: ['-c:a', 'aac'],
    },
    {
      name: 'h264-bframes.mp4',
      info: MP4,
      video: ['-c:v', 'libx264', '-preset', 'veryfast', '-bf', '2', '-pix_fmt', 'yuv420p'],
      sound: ['-c:a', 'aac'],
    },
    {
      name: 'h264-later-start.mp4',
      info: MP4,
      video: ['-c:v', 'libx264', '-preset', 'veryfast', '-bf', '2', '-pix_fmt', 'yuv420p'],
      sound: ['-c:a', 'aac'],
      more: ['-output_ts_offset', '1.5'],
    },
    {
      name: 'vp8-later-start.webm',
      info: webm1080,
      video: ['-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8'],
      sound: ['-c:a', 'libopus'],
      more: ['-output_ts_offset', '1.5'],
    },
  ];
  for (const kind of kinds)
    for (const height of PAGE_COPY_HEIGHTS)
      it(`${kind.name} at ${String(height)}p: every frame at the same time, the same keyframes, the same sound, the same length and start, only smaller`, () => {
        const dir = temp();
        const source = make(dir, kind.name, kind.video, kind.sound, kind.more);
        const plan = pageCopyPlan(kind.info, height);
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
        expect(a.duration).not.toBeNull();
        expect({ duration: b.duration, start: b.start }, 'the same Duration and start').toEqual({
          duration: a.duration,
          start: a.start,
        });
        expect([b.width, b.height]).toEqual([plan.width, height]);
        expect(plan.width).toBe(height === 720 ? 1280 : 960);
      });
});

describe.skipIf(!ffmpegHere(ffmpeg))('a turned video gets no page copy (a22-review-fadecopies M2)', () => {
  it('a phone video stored on its side and turned upright by its display matrix: none (FFmpeg turns it before scaling)', () => {
    const dir = temp();
    const plain = join(dir, 'plain.mp4'),
      turned = join(dir, 'turned.mp4');
    const made = spawnSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=1920x1080:r=30:d=1',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-y',
        plain,
      ],
      { env: ffmpegEnv() },
    );
    expect(made.status).toBe(0);
    const turn = spawnSync(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-display_rotation', '90', '-i', plain, '-c', 'copy', '-y', turned],
      { env: ffmpegEnv() },
    );
    expect(turn.status, String(turn.stderr)).toBe(0);
    const words = (file: string) =>
      spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8', env: ffmpegEnv() }).stderr;
    expect(words(turned)).toMatch(/rotation of/u);
    expect(pageCopyInspect(MP4, { words: words(turned), more: [] }), 'turned: none').toBe(false);
    expect(pageCopyInspect(MP4, { words: words(plain), more: [] }), 'upright: made').toBeUndefined();
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

  it('a copy that cannot be deleted (held by another program) is left, and the sweep goes on with the rest (M4)', async () => {
    const dir = temp();
    put(dir, [pageCopyName(SHA_A, 720, 'webm'), pageCopyName(SHA_B, 720, 'webm'), pageCopyName(SHA_B, 540, 'webm')]);
    const held = join(folder(dir), pageCopyName(SHA_B, 720, 'webm'));
    const remove = async (file: string) => {
      if (file === held) throw Object.assign(new Error('placeholder: in use'), { code: 'EBUSY' });
      await rmPromise(file, { force: true });
    };
    expect(await sweepPageCopies(dir, new Set([SHA_A]), remove)).toEqual([pageCopyName(SHA_B, 540, 'webm')]);
    expect(left(dir)).toEqual([pageCopyName(SHA_A, 720, 'webm'), pageCopyName(SHA_B, 720, 'webm')].sort());
    put(dir, [pageCopyName(SHA_B, 540, 'webm')]);
    await expect(removePageCopiesOf(dir, SHA_B, remove)).resolves.toBeUndefined();
    expect(left(dir)).toEqual([pageCopyName(SHA_A, 720, 'webm'), pageCopyName(SHA_B, 720, 'webm')].sort());
  });

  it('lists the copies there by source, with their heights', async () => {
    const dir = temp();
    put(dir, [pageCopyName(SHA_A, 720, 'webm'), pageCopyName(SHA_A, 540, 'webm'), 'notes.txt']);
    const found = await pageCopiesIn(dir);
    expect([...found.keys()]).toEqual([SHA_A]);
    expect([...(found.get(SHA_A) ?? [])].sort()).toEqual([540, 720]);
  });
});
