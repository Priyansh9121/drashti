import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlaybackReading } from '../../scripts/playback-check.mjs';
import { CONTROLS, FIRST_FRAME_MS, VIDEOS, WATCH_MS, judgePlayback } from '../../scripts/playback-check.mjs';
import type { PageGlobals } from '../e2e/helpers';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from '../e2e/helpers';
import type { Seen } from '../e2e/hall-looks';
import {
  audienceScreen,
  backgroundUp,
  installLooks,
  isBlack,
  OUT,
  openNewPlaylist,
  pictureUp,
  recAll,
  row,
  SCREENS,
  stopAll,
  wallpaperAndPicture,
} from '../e2e/hall-looks';
import { logLines } from '../e2e/log-lines';
import { decodePng } from '../e2e/png-decode';
import { testFfmpeg } from '../e2e/stream-helpers';

/*
 * The hall's video playback on an Intel Mac (alpha.23, a22-intelplay; the owner's QA23-INTELPLAY-1, "Yes, add it
 * (Rec.)"). Run only by performance.yml's intel_playback job on GitHub's Intel Mac runner (playwright.intel.config.ts),
 * never by CI's end-to-end parts or the release gate. Drashti, built on that Mac, plays each generated test video as an
 * operator would put it up: a playlist row clicked, the video on the audience screen's background through the hall's
 * own player and Drashti's first-frame watch (which takes a video off after 10 s with no picture). Each picture is
 * orange with a white bar moving along its foot, so a frozen hall shows in the pixels. Each is read on the hall (its
 * pixels, its page's look frame by frame, its video element, Drashti's log) and judged by scripts/playback-check.mjs.
 * The first tests prove the check fails its controls, each for its own reason: a copy cut before its movie box (taken
 * off), a black picture (black), a still one (did not move). Generated media only (the bundled FFmpeg), placeholder
 * names.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg (node scripts/fetch-ffmpeg.mjs)').not.toBeNull();
});

const FPS = 30;
const SECONDS = 24;

interface Recipe {
  name: string;
  kind: string;
  codec: 'h264' | 'h264-end' | 'owner' | 'vp8' | 'hevc';
  picture?: 'moving' | 'still' | 'black';
}

/**
 * A generated video with a 440 Hz tone, made by the bundled FFmpeg: orange, with a white bar along its foot that crosses
 * it every 4 s (or stands still, or a black picture), coded as asked.
 */
function makeVideo(path: string, r: Recipe, seconds = SECONDS): string {
  const [w, h] = r.codec === 'owner' ? [1920, 1080] : [320, 180];
  const d = String(seconds);
  const picture = r.picture ?? 'moving';
  const graph =
    picture === 'black'
      ? `color=c=black:s=${String(w)}x${String(h)}:r=${String(FPS)}:d=${d},format=yuv420p[v]`
      : [
          `color=c=0xd9480f:s=${String(w)}x${String(h)}:r=${String(FPS)}:d=${d}[bg]`,
          `color=c=white:s=${String(w / 16)}x${String(Math.round(h * 0.16))}:r=${String(FPS)}:d=${d}[bar]`,
          // Across the width every 4 s, without a comma (the filter graph's separator): t*w/4 - floor(t/4)*w.
          `[bg][bar]overlay=x=${picture === 'still' ? String(w * 0.3) : `t*${String(w / 4)}-floor(t/4)*${String(w)}`}:y=${String(Math.round(h * 0.78))}:shortest=1,format=yuv420p[v]`,
        ].join(';');
  const tone = `sine=f=440:r=48000:d=${d}[a]`;
  const coded: Record<Recipe['codec'], string[]> = {
    h264: ['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-c:a', 'aac', '-movflags', '+faststart'],
    'h264-end': ['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-c:a', 'aac'],
    // The owner's file's shape (hall-looks' "owner"): H.264 Main 1080p30, a constant 17.8 Mb/s, AAC stereo, box at the end.
    owner: [
      '-c:v',
      'libx264',
      '-preset',
      'superfast',
      '-profile:v',
      'main',
      '-g',
      '60',
      '-b:v',
      '17800k',
      '-minrate',
      '17800k',
      '-maxrate',
      '17800k',
      '-bufsize',
      '17800k',
      '-x264-params',
      'nal-hrd=cbr:force-cfr=1',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ac',
      '2',
    ],
    vp8: ['-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus'],
    hevc: [
      '-c:v',
      'libx265',
      '-preset',
      'ultrafast',
      '-tag:v',
      'hvc1',
      '-x265-params',
      'log-level=error',
      '-c:a',
      'aac',
    ],
  };
  const run = spawnSync(
    ffmpeg ?? '',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-filter_complex',
      `${graph};${tone}`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      ...coded[r.codec],
      path,
    ],
    { timeout: 600_000 },
  );
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return path;
}

/** The test videos the hall must play, in the summary's order (scripts/playback-check.mjs VIDEOS). */
const RECIPES: Recipe[] = [
  { name: 'Placeholder H.264.mp4', kind: 'H.264 320×180 30 fps, AAC, movie box first', codec: 'h264' },
  {
    name: 'Placeholder H.264 box at the end.mp4',
    kind: 'H.264 320×180 30 fps, AAC, movie box at the end',
    codec: 'h264-end',
  },
  {
    name: 'Placeholder 1080p30 17.8 Mbps.mp4',
    kind: 'H.264 Main 1080p30 at a constant 17.8 Mb/s, AAC 48 kHz stereo, movie box at the end (the owner’s file’s shape)',
    codec: 'owner',
  },
  { name: 'Placeholder VP8.webm', kind: 'VP8 320×180 30 fps, Opus, WebM', codec: 'vp8' },
  { name: 'Placeholder HEVC.mp4', kind: 'HEVC 320×180 30 fps, AAC', codec: 'hevc' },
];

// hall-looks' colours: the test video's orange, the picture up before it (green), the wallpaper (blue).
function seenOf([r, g, b]: number[]): Seen {
  const near = (rgb: number[], within: number) =>
    rgb.every((c, i) => Math.abs(([r, g, b][i] ?? -999) - c) <= within);
  if (near([217, 72, 15], 45)) return 'VIDEO';
  if (near([20, 83, 45], 40)) return 'BEFORE';
  if (near([30, 58, 138], 40)) return 'WALL';
  if (near([0, 0, 0], 12)) return 'BLACK';
  return 'OTHER';
}

/** One capture of the hall's page: what its scene's middle shows, and where its moving bar is (1 of 50 places). */
async function readHall(page: Page): Promise<{ seen: Seen; bar: number | null }> {
  const box = await page.evaluate((root) => {
    const s = document.querySelector(`${root} [data-testid="scene"]`)?.getBoundingClientRect();
    return s ? { left: s.left, top: s.top, width: s.width, height: s.height } : null;
  }, OUT);
  if (!box || box.width < 2) return { seen: 'OTHER', bar: null };
  const { width, height, rgba } = decodePng(await page.screenshot({ scale: 'css' }));
  const px = (x: number, y: number): number[] => {
    const at =
      (Math.min(height - 1, Math.max(0, Math.round(y))) * width +
        Math.min(width - 1, Math.max(0, Math.round(x)))) *
      4;
    return [rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0];
  };
  const seen = seenOf(px(box.left + box.width / 2, box.top + box.height * 0.45));
  let sum = 0;
  let n = 0;
  const y = box.top + box.height * 0.86;
  for (let x = Math.ceil(box.left); x < box.left + box.width; x++) {
    const [r = 0, g = 0, b = 0] = px(x, y);
    if (r > 180 && g > 180 && b > 180) {
      sum += x;
      n += 1;
    }
  }
  return { seen, bar: n > 0 ? Math.floor(((sum / n - box.left) / box.width) * 50) : null };
}

/** The hall's video element of that file now: its clock, its frames, its error. */
const hallVideo = (page: Page, mediaId: string) =>
  page.evaluate(
    ({ root, id }) => {
      const v = document.querySelector<HTMLVideoElement>(
        `${root} video[data-bg-slot][data-media-id="${id}"]`,
      );
      if (!v) return null;
      const q = v.getVideoPlaybackQuality();
      return {
        t: v.currentTime,
        frames: q.totalVideoFrames,
        dropped: q.droppedVideoFrames,
        error: v.error?.code ?? null,
      };
    },
    { root: OUT, id: mediaId },
  );

/** Drashti's own word for a video taken off a screen, or reloaded as the GPU process stopped (every day's log). */
function cannotPlay(userData: string): string | null {
  // No logs folder yet reads as no line.
  if (!existsSync(join(userData, 'logs'))) return null;
  return (
    logLines(userData)
      .find((l) => l.includes('A video could not play on'))
      ?.trim() ?? null
  );
}

/** Frames the hall's page drew black by its own markup (hall-looks' look, frame by frame), Black-out not counted. */
function blackFramesOf(looks: string[]): number {
  const all = looks.flatMap((s) => {
    const m = /^(\d+)f\/\d+ms:(.+)$/u.exec(s);
    return m ? [{ f: Number(m[1]), look: m[2] ?? '' }] : [];
  });
  let frames = 0;
  for (let i = 0; i < all.length; i++) {
    const cur = all[i];
    if (cur && isBlack(cur.look)) frames += (all[i + 1]?.f ?? cur.f + 1) - cur.f;
  }
  return frames;
}

/** The computer and its graphics, as Chromium reports them. */
async function runnerOf(app: ElectronApplication): Promise<Pick<PlaybackReading, 'runner' | 'gpu'>> {
  const sw = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
  const version = sw.status === 0 ? sw.stdout.trim() : 'unknown';
  const gpu = await app.evaluate(async ({ app: electronApp }) => {
    const status = electronApp.getGPUFeatureStatus();
    const info = (await electronApp.getGPUInfo('basic')) as {
      gpuDevice?: { vendorId?: number; deviceId?: number; active?: boolean }[];
    };
    return {
      videoDecode: status.video_decode,
      gpuCompositing: status.gpu_compositing,
      devices: (info.gpuDevice ?? []).map(
        (d) =>
          `${(d.vendorId ?? 0).toString(16)}:${(d.deviceId ?? 0).toString(16)}${d.active ? ' (active)' : ''}`,
      ),
    };
  });
  return { runner: `macOS ${version} (${process.arch})`, gpu };
}

/** The readings so far, kept for the job's summary (scripts/playback-check.mjs summary). */
function keep(reading: PlaybackReading): void {
  const file = process.env['DRASHTI_PLAYBACK_READINGS'];
  if (!file) return;
  const kept = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PlaybackReading[]) : [];
  writeFileSync(file, `${JSON.stringify([...kept, reading], null, 2)}\n`);
}

/**
 * One video put up on the hall as an operator does (its playlist row clicked over a picture), then read: its first
 * frame, then WATCH_MS of playing, the hall's page and element and Drashti's log. HEVC goes as this computer takes it.
 */
async function playOnHall(
  dir: string,
  video: { name: string; kind: string; file: string },
  hevc = false,
): Promise<PlaybackReading> {
  const { app, userData } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const beforeId = await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [video.file]);
    expect(id, `${video.name} came in`).not.toBe('');
    const kind = hevc ? `${video.kind}; ${await hevcHere(win, id)}` : video.kind;
    const { item } = await openNewPlaylist(win, video.name.replace(/\.\w+$/u, ''), id);
    await installLooks(hall.page, OUT);
    await pictureUp(win, hall.page, beforeId);
    const watched = await watchIt(win, hall.page, beforeId, item, userData);
    return { ...watched, name: video.name, kind, fps: FPS, ...(await runnerOf(app)) };
  } finally {
    await app.close();
  }
}

/** HEVC as this computer takes it: played as it is, or converted by Drashti first (its copy is then put up). */
async function hevcHere(win: Page, mediaId: string): Promise<string> {
  const playsHevc = () => win.evaluate(() => (globalThis as PageGlobals).drashti.media.playsHevc());
  await expect
    .poll(playsHevc, { timeout: 30_000, message: 'Drashti’s answer: does this computer play HEVC?' })
    .not.toBeNull();
  if ((await playsHevc()) === true) return 'Drashti plays HEVC as it is here';
  await expect
    .poll(
      async () =>
        (await win.evaluate(() => (globalThis as PageGlobals).drashti.media.conversions()))
          .filter((j) => j.mediaId === mediaId)
          .map((j) => j.state),
      { timeout: 180_000, message: 'Drashti converts it on this computer' },
    )
    .toEqual(['done']);
  return 'Drashti converts HEVC here: its copy put up';
}

async function watchIt(
  win: Page,
  hall: Page,
  beforeId: string,
  item: string,
  userData: string,
): Promise<Omit<PlaybackReading, 'name' | 'kind' | 'fps'>> {
  const st: { upId: string | null; off: boolean; black: number; errorCode: number | null } = {
    upId: null,
    off: false,
    black: 0,
    errorCode: null,
  };
  const bars = new Set<number>();
  // One look: what is up (the video, once it is, or off again), its element's error, and what the hall's pixels show.
  const look = async (watching: boolean): Promise<Seen | 'not up'> => {
    const up = await backgroundUp(win);
    if (st.upId === null && up !== beforeId) {
      if (up === 'none' || up === 'wallpaper') st.off = true;
      else st.upId = up;
    } else if (st.upId !== null && up !== st.upId) st.off = true;
    if (st.upId === null || st.off) return 'not up';
    const el = await hallVideo(hall, st.upId);
    if (el && el.error !== null) st.errorCode = el.error;
    const { seen, bar } = await readHall(hall);
    if (seen === 'BLACK') st.black += 1;
    if (watching && bar !== null) bars.add(bar);
    // A short pause between captures, so the watching does not load the runner's 4 cores (a22-review-intelplay N7).
    await hall.waitForTimeout(100);
    return seen;
  };
  await recAll([hall]);
  const t0 = Date.now();
  await row(win, item).click();
  let firstFrameMs: number | null = null;
  while (!st.off && firstFrameMs === null && Date.now() - t0 < FIRST_FRAME_MS)
    if ((await look(false)) === 'VIDEO') firstFrameMs = Date.now() - t0;
  let advancedS = 0;
  let presentedInWatch = 0;
  let droppedInWatch = 0;
  let watchedMs = 0;
  const id = st.upId;
  if (firstFrameMs !== null && id !== null) {
    const start = await hallVideo(hall, id);
    const w0 = Date.now();
    while (!st.off && Date.now() - w0 < WATCH_MS) await look(true);
    watchedMs = Date.now() - w0;
    const end = await hallVideo(hall, id);
    if (start && end) {
      advancedS = Math.max(0, end.t - start.t);
      // Frames shown in the watch: decoded less dropped, at its end less at its start (a22-review-intelplay M2).
      presentedInWatch = Math.max(0, end.frames - end.dropped - (start.frames - start.dropped));
      droppedInWatch = Math.max(0, end.dropped - start.dropped);
    }
  }
  const [looks = []] = await stopAll([hall]);
  // Taken off: Drashti's log says why once the hall has told Main (read for up to 10 s; never a pass or a fail).
  for (let i = 0; st.off && i < 40 && cannotPlay(userData) === null; i++)
    await letTimePass(win, 250, 'Drashti’s log line for a video taken off');
  return {
    firstFrameMs,
    watchedMs,
    advancedS,
    presentedInWatch,
    droppedInWatch,
    moves: bars.size,
    errorCode: st.errorCode,
    off: st.off,
    black: st.black,
    blackFrames: st.upId === null || st.off ? 0 : blackFramesOf(looks),
    logged: cannotPlay(userData),
    looks: looks.slice(0, 80),
  };
}

/** The check's own proof: each control must fail, for its own reason. */
async function control(dir: string, name: string, kind: string, file: string): Promise<PlaybackReading> {
  const c = CONTROLS.find((x) => x.name === name);
  expect(c, `${name} is one of the summary's controls`).toBeDefined();
  const reading = await playOnHall(dir, { name, kind, file });
  keep(reading);
  expect(
    judgePlayback(reading).some((p) => p.includes(c?.mustSay ?? '?')),
    JSON.stringify(reading),
  ).toBe(true);
  return reading;
}

test('the check first proves it fails a video the hall cannot play: a generated placeholder copy cut before its movie box, which Drashti takes off', async () => {
  test.setTimeout(240_000);
  // A fresh run's readings (a22-review-intelplay N8): this test runs first, once.
  const file = process.env['DRASHTI_PLAYBACK_READINGS'];
  if (file) rmSync(file, { force: true });
  expect(RECIPES.map((r) => r.name)).toEqual(VIDEOS);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-intel-playback-cut-'));
  const name = CONTROLS[0]?.name ?? '';
  const cut = makeVideo(join(dir, name), { name, kind: '', codec: 'h264-end' }, 12);
  truncateSync(cut, Math.floor(statSync(cut).size * 0.6));
  const reading = await control(
    dir,
    name,
    'H.264 cut at 60 %, no movie box (as a copy stopped part-way)',
    cut,
  );
  expect(reading.off, JSON.stringify(reading)).toBe(true);
});

test('the check fails a black picture with its sound playing (the hall’s pixels): a generated black H.264', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-intel-playback-black-'));
  const name = CONTROLS[1]?.name ?? '';
  const file = makeVideo(join(dir, name), { name, kind: '', codec: 'h264', picture: 'black' });
  await control(dir, name, 'H.264 320×180, a black picture, AAC', file);
});

test('the check fails a picture that does not move (a frozen hall): a generated H.264 whose bar stands still', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-intel-playback-still-'));
  const name = CONTROLS[2]?.name ?? '';
  const file = makeVideo(join(dir, name), { name, kind: '', codec: 'h264', picture: 'still' });
  await control(dir, name, 'H.264 320×180, its bar standing still, AAC', file);
});

for (const video of RECIPES)
  test(`the hall plays ${video.name} on this Mac (${video.kind}): a first frame, playing on, its frames shown, its picture moving, never off, never black`, async () => {
    test.setTimeout(360_000);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-intel-playback-'));
    const file = makeVideo(join(dir, video.name), video);
    const reading = await playOnHall(dir, { ...video, file }, video.codec === 'hevc');
    keep(reading);
    expect(judgePlayback(reading), JSON.stringify(reading)).toEqual([]);
  });
