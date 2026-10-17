import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FromWorker } from './protocol';
import type { YtDlpLaunch } from './youtube-run';
import { toolEnv, toolFolders } from './youtube-tools';
import { youtubeWorker } from './youtube-worker';
import { ffmpegHere } from '../testing/ffmpeg-here';

/*
 * yt-dlp in the download process (Session 25c), run for real against the
 * fake yt-dlp (tests/e2e/fake-yt-dlp.cjs, run by Electron as Node): the
 * details, a download with its progress, a hold that stops it (and the child
 * it started) and carries on from its part-file, a stop, and a failure in
 * plain words. A made-up video and FFmpeg-made placeholders only.
 */

const app = join(__dirname, '..', '..', '..');
const fake = join(app, 'tests', 'e2e', 'fake-yt-dlp.cjs');
const ffmpeg = join(
  app,
  'vendor',
  'ffmpeg',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
);
const LINK = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';

let root: string | null = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

function setUp(config: Record<string, unknown> = {}) {
  root = mkdtempSync(join(tmpdir(), 'drashti-yt-worker-'));
  const tools = join(root, 'tools');
  const folders = toolFolders(tools);
  for (const dir of [folders.home, folders.temp, folders.deno]) mkdirSync(dir, { recursive: true });
  const workDir = join(root, 'Saved here', '.drashti-youtube-placeholder');
  mkdirSync(workDir, { recursive: true });
  const log = join(root, 'fake.log');
  const launch: YtDlpLaunch = {
    command: process.execPath,
    prefix: [fake],
    env: {
      ...toolEnv(folders, process.platform),
      ELECTRON_RUN_AS_NODE: '1',
      DRASHTI_FAKE_YT_DLP_CONFIG: JSON.stringify({ log, ...config }),
    },
    deno: 'deno',
    ffmpeg,
  };
  const heard: FromWorker[] = [];
  const free = { bytes: 100 * 1024 ** 3 };
  const worker = youtubeWorker(
    (m) => heard.push(m),
    () => free.bytes,
  );
  return { worker, heard, launch, cwd: tools, workDir, log, free };
}

async function until(check: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The fake's own process and its child, from its log of each start. */
const startsIn = (log: string) =>
  (existsSync(log) ? readFileSync(log, 'utf8') : '')
    .split('\n')
    .filter((l) => l.startsWith('start '))
    .map((l) => {
      const [, kind, , , pid, , child] = l.split(' ');
      return { kind, pid: Number(pid), child: Number(child) };
    });

describe.skipIf(!ffmpegHere(ffmpeg))('yt-dlp in the download process (with the fake)', () => {
  it('asks for the details', async () => {
    const t = setUp({ title: 'Placeholder video', duration: 65 });
    t.worker.look({ type: 'yt-look', link: LINK, launch: t.launch, cwd: t.cwd });
    await until(() => t.heard.some((m) => m.type === 'yt-looked'));
    const looked = t.heard.find((m) => m.type === 'yt-looked');
    expect(looked?.type === 'yt-looked' && looked.details.title).toBe('Placeholder video');
    expect(looked?.type === 'yt-looked' && looked.details.heights.map((h) => h.height)).toEqual([
      4320, 2160, 1440, 1080, 720,
    ]);
    // It said which process ran, then that it ended.
    expect(t.heard.filter((m) => m.type === 'tool').map((m) => m.pid !== null)).toEqual([true, false]);
  });

  it('downloads an MP4, saying how far it has got, and leaves only download.mp4', async () => {
    const t = setUp({ steps: 5, stepMs: 30 });
    t.worker.download({
      type: 'yt-download',
      link: LINK,
      launch: t.launch,
      cwd: t.cwd,
      workDir: t.workDir,
      choice: { type: 'mp4', height: 720 },
      keepFree: 2 * 1024 ** 3,
    });
    await until(() => t.heard.some((m) => m.type === 'yt-downloaded' || m.type === 'failed'));
    const progress = t.heard.flatMap((m) => (m.type === 'progress' ? [m.done] : []));
    expect(progress.length).toBeGreaterThan(2);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    const got = t.heard.find((m) => m.type === 'yt-downloaded');
    expect(got?.type === 'yt-downloaded' && got.file).toBe(join(t.workDir, 'download.mp4'));
    expect(readdirSync(t.workDir)).toEqual(['download.mp4']);
    // The fake and the child it started have both ended.
    const [start] = startsIn(t.log);
    await until(() => start !== undefined && !alive(start.pid) && !alive(start.child), 10_000);
  });

  it('stops while on air (the child too), then carries on from its part-file', async () => {
    const t = setUp({ steps: 40, stepMs: 60 });
    t.worker.download({
      type: 'yt-download',
      link: LINK,
      launch: t.launch,
      cwd: t.cwd,
      workDir: t.workDir,
      choice: { type: 'mp4', height: 720 },
      keepFree: 2 * 1024 ** 3,
    });
    await until(() => t.heard.filter((m) => m.type === 'progress').length >= 4);
    t.worker.hold(true);
    await until(
      () => t.heard.at(-1)?.type === 'tool' && (t.heard.at(-1) as { pid: number | null }).pid === null,
    );
    const [first] = startsIn(t.log);
    await until(() => first !== undefined && !alive(first.pid) && !alive(first.child), 10_000);
    // Held: the part-file stays, and nothing starts.
    expect(readdirSync(t.workDir).some((n) => n.endsWith('.part'))).toBe(true);
    const heardWhileHeld = t.heard.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(t.heard.length).toBe(heardWhileHeld);
    expect(startsIn(t.log)).toHaveLength(1);
    t.worker.hold(false);
    await until(() => t.heard.some((m) => m.type === 'yt-downloaded' || m.type === 'failed'), 60_000);
    expect(t.heard.some((m) => m.type === 'yt-downloaded')).toBe(true);
    expect(startsIn(t.log)).toHaveLength(2);
    expect(readFileSync(t.log, 'utf8')).toMatch(/^resume \d+$/mu);
    expect(readdirSync(t.workDir)).toEqual(['download.mp4']);
  });

  it('stops when told: the fake and its child end, and nothing more is said', async () => {
    const t = setUp({ steps: 100, stepMs: 60 });
    t.worker.download({
      type: 'yt-download',
      link: LINK,
      launch: t.launch,
      cwd: t.cwd,
      workDir: t.workDir,
      choice: { type: 'mp3', height: null },
      keepFree: 2 * 1024 ** 3,
    });
    await until(() => t.heard.filter((m) => m.type === 'progress').length >= 2);
    t.worker.stop();
    const [start] = startsIn(t.log);
    await until(() => start !== undefined && !alive(start.pid) && !alive(start.child), 10_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(t.heard.some((m) => m.type === 'yt-downloaded' || m.type === 'failed')).toBe(false);
  });

  it('stops when the disk would have less than 2 GB free', async () => {
    const t = setUp({ steps: 200, stepMs: 50 });
    t.worker.download({
      type: 'yt-download',
      link: LINK,
      launch: t.launch,
      cwd: t.cwd,
      workDir: t.workDir,
      choice: { type: 'mp4', height: 720 },
      keepFree: 2 * 1024 ** 3,
    });
    await until(() => t.heard.some((m) => m.type === 'progress'));
    t.free.bytes = 1024 ** 3;
    await until(() => t.heard.some((m) => m.type === 'failed'), 15_000);
    const failed = t.heard.find((m) => m.type === 'failed');
    expect(failed?.type === 'failed' && failed.code).toBe('space');
  });

  it('says what went wrong in plain words, never yt-dlp’s own', async () => {
    const t = setUp({
      failWith: 'ERROR: [youtube] AAAAAAAAAAA: Private video. Sign in if you have been granted access',
    });
    t.worker.look({ type: 'yt-look', link: LINK, launch: t.launch, cwd: t.cwd });
    await until(() => t.heard.some((m) => m.type === 'failed'));
    const failed = t.heard.find((m) => m.type === 'failed');
    expect(failed?.type === 'failed' && failed.code).toBe('sign-in');
    expect(failed?.type === 'failed' ? failed.message : '').not.toMatch(/AAAAAAAAAAA|ERROR/u);
  });
});
