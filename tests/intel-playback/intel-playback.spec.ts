import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlaybackReading } from '../../scripts/playback-check.mjs';
import { FIRST_FRAME_MS, WATCH_MS, judgePlayback } from '../../scripts/playback-check.mjs';
import type { PageGlobals } from '../e2e/helpers';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from '../e2e/helpers';
import type { Clip } from '../e2e/hall-looks';
import {
  audienceScreen,
  backgroundUp,
  installLooks,
  makeClip,
  OUT,
  openNewPlaylist,
  pictureUp,
  row,
  SCREENS,
  shown,
  wallpaperAndPicture,
} from '../e2e/hall-looks';
import { testFfmpeg } from '../e2e/stream-helpers';

/*
 * The hall's video playback on an Intel Mac (alpha.23, a22-intelplay; the owner's QA23-INTELPLAY-1, "Yes, add it
 * (Rec.)"). Run only by performance.yml's intel_playback job on GitHub's Intel Mac runner (playwright.intel.config.ts),
 * never by CI's end-to-end parts or the release gate. Drashti, built on that Mac, plays each generated test video as an
 * operator would put it up: a playlist row clicked, the video on the audience screen's background through the hall's
 * own player and Drashti's first-frame watch (which takes a video off after 10 s with no picture). Each is read on the
 * hall (its pixels, its video element, Drashti's log) and judged by scripts/playback-check.mjs. The first test proves
 * the check fails a video the hall cannot play. Generated media only (the bundled FFmpeg), placeholder names.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg (node scripts/fetch-ffmpeg.mjs)').not.toBeNull();
});

/** Everything this Drashti wrote to its log. */
function logOf(userData: string): string {
  const dir = join(userData, 'logs');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((f) => /^drashti(\.\d+)?\.log$/u.test(f))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

/** A generated orange video with a tone, made by the bundled FFmpeg: VP8 and Opus in a WebM, or HEVC in an MP4. */
function makeOther(path: string, codec: 'vp8' | 'hevc', seconds: number): string {
  const coded =
    codec === 'vp8'
      ? ['-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus']
      : [
          '-c:v',
          'libx265',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-tag:v',
          'hvc1',
          '-x265-params',
          'log-level=error',
          '-c:a',
          'aac',
        ];
  const r = spawnSync(
    ffmpeg ?? '',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0xd9480f:s=320x180:r=30:d=${String(seconds)}`,
      '-f',
      'lavfi',
      '-i',
      `sine=f=440:r=48000:d=${String(seconds)}`,
      ...coded,
      path,
    ],
    { timeout: 600_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return path;
}

interface TestVideo {
  name: string;
  kind: string;
  make: (dir: string) => string;
}

const SECONDS = 24;
const h264 = (name: string, kind: string, clip: Clip): TestVideo => ({
  name,
  kind,
  make: (dir) => makeClip(join(dir, name), clip, SECONDS),
});

/** The test videos the hall must play. */
const VIDEOS: TestVideo[] = [
  h264('Placeholder H.264.mp4', 'H.264 320×180 30 fps, AAC, movie box first', 'h264'),
  h264(
    'Placeholder H.264 box at the end.mp4',
    'H.264 320×180 30 fps, AAC, movie box at the end',
    'h264-moov-at-end',
  ),
  h264(
    'Placeholder 1080p30 17.8 Mbps.mp4',
    'H.264 Main 1080p30 at a constant 17.8 Mb/s, AAC 48 kHz stereo, movie box at the end (the owner’s file’s shape)',
    'owner',
  ),
  {
    name: 'Placeholder VP8.webm',
    kind: 'VP8 320×180 30 fps, Opus, WebM',
    make: (dir) => makeOther(join(dir, 'Placeholder VP8.webm'), 'vp8', SECONDS),
  },
  {
    name: 'Placeholder HEVC.mp4',
    kind: 'HEVC 320×180 30 fps, AAC',
    make: (dir) => makeOther(join(dir, 'Placeholder HEVC.mp4'), 'hevc', SECONDS),
  },
];

/** The hall's video element of that file now: how far it played, its frames, its error. */
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

/** Drashti's own word for a video taken off a screen, or reloaded as the GPU process stopped. */
const cannotPlay = (log: string): string | null =>
  /A video could not play on [^\n]*/u.exec(log)?.[0].trim() ?? null;

/** The readings so far, kept for the job's summary (scripts/playback-check.mjs summary). */
function keep(reading: PlaybackReading): void {
  const file = process.env['DRASHTI_PLAYBACK_READINGS'];
  if (!file) return;
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PlaybackReading[]) : [];
  writeFileSync(file, `${JSON.stringify([...all, reading], null, 2)}\n`);
}

/**
 * One video put up on the hall as an operator does (its playlist row clicked over a picture), then read: its first
 * frame, then WATCH_MS of playing, the hall's element and Drashti's log. HEVC goes as this computer takes it.
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
    return { ...(await watchIt(win, hall.page, beforeId, item, userData)), name: video.name, kind };
  } finally {
    await app.close();
  }
}

/** HEVC as this computer takes it: played as it is, or converted by Drashti first (its copy then plays). */
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
  return 'Drashti converts HEVC here: its copy played';
}

async function watchIt(
  win: Page,
  hall: Page,
  beforeId: string,
  item: string,
  userData: string,
): Promise<Omit<PlaybackReading, 'name' | 'kind'>> {
  const t0 = Date.now();
  await row(win, item).click();
  const st: { upId: string | null; off: boolean; black: number; errorCode: number | null } = {
    upId: null,
    off: false,
    black: 0,
    errorCode: null,
  };
  // One look: what is up (the video, once it is, or off again), its element's error, and what the hall draws.
  const look = async (): Promise<string> => {
    const up = await backgroundUp(win);
    if (st.upId === null && up !== beforeId) {
      if (up === 'none' || up === 'wallpaper') st.off = true;
      else st.upId = up;
    } else if (st.upId !== null && up !== st.upId) st.off = true;
    if (st.upId === null || st.off) return 'not up';
    const el = await hallVideo(hall, st.upId);
    if (el && el.error !== null) st.errorCode = el.error;
    const seen = await shown(hall, OUT);
    if (seen === 'BLACK') st.black += 1;
    return seen;
  };
  let firstFrameMs: number | null = null;
  while (!st.off && firstFrameMs === null && Date.now() - t0 < FIRST_FRAME_MS)
    if ((await look()) === 'VIDEO') firstFrameMs = Date.now() - t0;
  let advancedS = 0;
  let decodedFrames = 0;
  let droppedFrames = 0;
  let watchedMs = 0;
  const id = st.upId;
  if (firstFrameMs !== null && id !== null) {
    const start = await hallVideo(hall, id);
    const w0 = Date.now();
    while (!st.off && Date.now() - w0 < WATCH_MS) await look();
    watchedMs = Date.now() - w0;
    const end = await hallVideo(hall, id);
    if (start && end) {
      advancedS = Math.max(0, end.t - start.t);
      decodedFrames = end.frames;
      droppedFrames = end.dropped;
    }
  }
  // Taken off: Drashti's log says why once the hall has told Main (read for up to 10 s; never a pass or a fail).
  for (let i = 0; st.off && i < 40 && cannotPlay(logOf(userData)) === null; i++)
    await letTimePass(win, 250, 'Drashti’s log line for a video taken off');
  return {
    firstFrameMs,
    watchedMs,
    advancedS,
    decodedFrames,
    droppedFrames,
    errorCode: st.errorCode,
    off: st.off,
    black: st.black,
    logged: cannotPlay(logOf(userData)),
  };
}

test('the check first proves it fails a video the hall cannot play: a generated placeholder copy cut before its movie box', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-intel-playback-cut-'));
  const name = 'Placeholder cut copy (cannot play).mp4';
  const file = makeClip(join(dir, name), 'h264-moov-at-end', 12);
  truncateSync(file, Math.floor(statSync(file).size * 0.6));
  const reading = await playOnHall(dir, {
    name,
    kind: 'H.264 cut at 60 %, no movie box (as a copy stopped part-way)',
    file,
  });
  keep({ ...reading, expectFail: true });
  expect(judgePlayback(reading)).not.toEqual([]);
});

for (const video of VIDEOS)
  test(`the hall plays ${video.name} on this Mac (${video.kind}): a first frame, playing on, never off, never black`, async () => {
    test.setTimeout(360_000);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-intel-playback-'));
    const file = video.make(dir);
    const reading = await playOnHall(dir, { ...video, file }, video.name.includes('HEVC'));
    keep(reading);
    expect(judgePlayback(reading), JSON.stringify(reading)).toEqual([]);
  });
