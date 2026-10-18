import { expect, test } from '@playwright/test';
import { type ChildProcess, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { networkOn } from './devices';
import { dropboxStandIn, fileLink } from './dropbox-stand-in';
import {
  importAndGetIds,
  killMainOnly,
  launchApp,
  operatorPage,
  operatorReady,
  relaunchApp,
  type PageGlobals,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';
import { releaseServer } from './release-server';
import { freePort, rtmpListener, setUpStream, testFfmpeg } from './stream-helpers';

/*
 * Quitting with everything going on (Session 23): the stream on air and
 * recording to FFmpeg listening on this computer, a conversion waiting for the
 * stream (conversions wait while the stream is in use), an import running, a
 * node paired, the network on, and an update set to install at quit (its test
 * hook writes what it would run). Every service stops in order (src/main/
 * lifecycle.ts): nothing throws, the quit is clean, the update installs, and
 * no FFmpeg is left behind. Generated media and placeholder words only.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const listeners: ChildProcess[] = [];
test.afterEach(() => {
  for (const l of listeners.splice(0)) l.kill('SIGKILL');
});

/** Every process with its parent and name, from the system. */
function processes(): { pid: number; ppid: number; name: string }[] {
  if (process.platform === 'win32') {
    // Windows PowerShell, without the PowerShell 7 module path CI's steps run under.
    const env = { ...process.env };
    delete env['PSModulePath'];
    const out = spawnSync(
      `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }',
      ],
      { encoding: 'utf8', env },
    ).stdout;
    return out
      .split(/\r?\n/u)
      .map((l) => l.trim().split(' '))
      .filter((p) => p.length >= 3)
      .map(([pid, ppid, ...name]) => ({ pid: Number(pid), ppid: Number(ppid), name: name.join(' ') }));
  }
  return spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' })
    .stdout.split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3] ?? '' }));
}

/** Every process under this one (its helpers, workers and what they started). */
function under(root: number): { pid: number; ppid: number; name: string }[] {
  const all = processes();
  const mine = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of all)
      if (mine.has(p.ppid) && !mine.has(p.pid)) {
        mine.add(p.pid);
        grew = true;
      }
  }
  return all.filter((p) => mine.has(p.pid) && p.pid !== root);
}

/** The FFmpeg processes started under this process (by its workers). */
function ffmpegUnder(root: number): number[] {
  return under(root)
    .filter((p) => /ffmpeg/iu.test(p.name))
    .map((p) => p.pid);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A placeholder song with enough verses to give the import real work. */
function song(i: number): string {
  const lines = ['[Chorus]', `Placeholder chorus ${i}`, ''];
  for (let v = 1; v <= 16; v++)
    lines.push(`[Verse ${v}]`, `Placeholder song ${i}, verse ${v}, line one`, 'Placeholder line two', '');
  return lines.join('\n');
}

test('quitting with everything going on: each service stops in order, cleanly, with nothing left running', async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-quit-all-'));
  const installer = randomBytes(256 * 1024);
  const release = await releaseServer({ '9.9.9': installer }, '9.9.9');
  const installLog = join(dir, 'install.json');
  const node = await launchNode();
  try {
    const main = await launchMain({
      DRASHTI_TEST_FAKE_DEVICES: '1',
      DRASHTI_UPDATE_URL: release.base,
      DRASHTI_TEST_UPDATE_INSTALL: installLog,
    });
    const { app, win, userData } = main;

    // An update, downloaded (before going on air: downloads wait while on air) and set to install at quit.
    await win.evaluate(async () => {
      const u = (globalThis as PageGlobals).drashti.updates;
      const checked = await u.check();
      if (!checked.ok) throw new Error(checked.message);
      const got = await u.download();
      if (!got.ok) throw new Error(got.message);
    });
    await expect
      .poll(
        async () => (await win.evaluate(() => (globalThis as PageGlobals).drashti.updates.view())).phase,
        {
          timeout: 30_000,
        },
      )
      .toBe('ready');
    await win.evaluate(() => (globalThis as PageGlobals).drashti.updates.setInstallOnQuit(true));

    // The network on, and a node paired and following.
    await networkOn(win);
    await pairNode(main, node);

    // On air and recording.
    const port = await freePort();
    listeners.push(rtmpListener(ffmpeg ?? '', port, join(dir, 'received.flv')));
    await setUpStream(app, win, port, dir);
    await win.evaluate(async () => {
      const s = (globalThis as PageGlobals).drashti.stream;
      await s.startRecording();
      await s.goLive({ confirmed: true });
    });
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status())).live.state,
        {
          timeout: 45_000,
        },
      )
      .toBe('live');
    // A clip Drashti converts before it plays it (ProRes): it waits, as conversions do while the stream is in use.
    const clip = join(dir, 'Placeholder clip.mov');
    const made = spawnSync(ffmpeg ?? '', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=640x360:r=25',
      '-t',
      '4',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '0',
      clip,
    ]);
    expect(made.status, made.stderr.toString()).toBe(0);
    const [clipId] = await importAndGetIds(win, [clip]);
    const converting = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.media.convert([id]),
      clipId ?? '',
    );
    expect(converting.ok).toBe(true);
    const conversion = () =>
      win.evaluate(async () => (await (globalThis as PageGlobals).drashti.media.conversions()).at(-1)?.state);

    await expect.poll(conversion).toBe('waiting');

    // An import, still going when Drashti quits.
    const songs = join(dir, 'songs');
    mkdirSync(songs);
    const files: string[] = [];
    for (let i = 1; i <= 800; i++) {
      const file = join(songs, `Placeholder Song ${String(i).padStart(3, '0')}.txt`);
      writeFileSync(file, song(i));
      files.push(file);
    }
    await win.evaluate((paths) => {
      const g = globalThis as PageGlobals & { importProgress?: unknown };
      g.drashti.library.onImportProgress((p) => {
        g.importProgress = p;
      });
      void g.drashti.library.importPaths(paths);
    }, files);
    // Importing (not finished) as Drashti quits.
    await expect
      .poll(() =>
        win.evaluate(() => {
          const p = (globalThis as { importProgress?: { phase: string } }).importProgress;
          return p?.phase ?? 'none';
        }),
      )
      .toBe('importing');

    // Quit on purpose.
    const mainPid = await app.evaluate(() => process.pid);
    const ffmpegs = ffmpegUnder(mainPid);
    expect(ffmpegs.length, 'the stream’s encoder and connection').toBeGreaterThanOrEqual(2);
    expect(existsSync(installLog)).toBe(false);
    await app.close();

    const log = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
    expect(log).not.toContain('Uncaught exception');
    expect(log).not.toContain('did not stop cleanly');
    // A clean quit: the mark names the run the saved show belongs to.
    const saved = JSON.parse(readFileSync(join(userData, 'live-state.json'), 'utf8')) as { session: string };
    const mark = JSON.parse(readFileSync(join(userData, 'live-state.clean'), 'utf8')) as { session: string };
    expect(mark.session).toBe(saved.session);
    expect(JSON.parse(readFileSync(join(userData, 'stream-state.json'), 'utf8'))).toMatchObject({
      live: false,
      recording: false,
    });
    // The update installed (its test hook wrote what it would run).
    const ran = JSON.parse(readFileSync(installLog, 'utf8')) as { file: string };
    expect(readFileSync(ran.file).equals(installer)).toBe(true);
    // No FFmpeg left running.
    await expect.poll(() => ffmpegs.filter(alive), { timeout: 15_000 }).toEqual([]);
  } finally {
    release.close();
    await node.app.close();
  }
});

test('quitting during a download from a link (Session 25b): nothing of it is left behind', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-quit-link-'));
  const chosen = join(dir, 'Chosen folder');
  // Placeholder bytes, sent slowly: still downloading when Drashti quits.
  const standIn = await dropboxStandIn(
    {
      slowAAAAAAAAAAA: {
        name: 'Placeholder clip.mp4',
        body: randomBytes(16 * 1024 * 1024),
        type: 'video/mp4',
        slowMs: 50,
      },
    },
    {},
  );
  try {
    const { app, userData } = await launchApp({
      DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
      DRASHTI_TEST_DOWNLOADS_DIR: dir,
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, chosen);
    const view = () => win.evaluate(() => (globalThis as PageGlobals).drashti.links.view());
    await win.evaluate(
      (link) => (globalThis as PageGlobals).drashti.links.look('dropbox', link),
      fileLink('slowAAAAAAAAAAA', 'Placeholder clip.mp4'),
    );
    await expect.poll(async () => (await view()).phase).toBe('looked');
    await win.evaluate(async () => {
      const links = (globalThis as PageGlobals).drashti.links;
      await links.pickFolder();
      const started = await links.download();
      if (!started.ok) throw new Error(started.message);
    });
    // Downloading: some bytes are in its part-file (under a hidden name), more on the way.
    await expect
      .poll(async () => (await view()).progress?.done ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(256 * 1024);
    const parts = readdirSync(chosen);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatch(/^\.drashti-download-.+\.part$/u);

    const mainPid = await app.evaluate(() => process.pid);
    const helpers = under(mainPid).map((p) => p.pid);
    expect(helpers.length).toBeGreaterThan(0);
    await app.close();

    // Nothing of the download is left: no part-file, no record of one, and no process of Drashti's.
    expect(readdirSync(chosen)).toEqual([]);
    expect(existsSync(join(userData, 'link-downloads.json'))).toBe(false);
    await expect.poll(() => helpers.filter(alive), { timeout: 15_000 }).toEqual([]);
    const log = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
    expect(log).not.toContain('Uncaught exception');
    expect(log).not.toContain('did not stop cleanly');
  } finally {
    await standIn.close();
  }
});

test('quitting during Save as MP4 (Session 26e): no file under its name, no part-file, and no FFmpeg left', async () => {
  test.skip(!ffmpeg, 'needs the bundled FFmpeg');
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-quit-save-'));
  const source = join(dir, 'Placeholder long.mp4');
  const made = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=25',
    '-t',
    '20',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  expect(made.status).toBe(0);
  const out = join(dir, 'Saved');
  mkdirSync(out);
  // The save reads no faster than the video plays (a test switch): still going when Drashti quits.
  const { app, userData } = await launchApp({ DRASHTI_TEST_SAVE_READRATE: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const [mediaId = ''] = await importAndGetIds(win, [source]);
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    },
    join(out, 'Placeholder long (0m 18s).mp4'),
  );
  const started = await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.media.saveTrim({
        mediaId: id,
        startMs: null,
        endMs: 18_000,
        addToLibrary: false,
      }),
    mediaId,
  );
  expect(started).toMatchObject({ ok: true });
  // Saving: into a part-file under a hidden name, FFmpeg running.
  await expect
    .poll(
      async () =>
        (await win.evaluate(() => (globalThis as PageGlobals).drashti.media.saves()))[0]?.progress ?? 0,
      {
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(0.05);
  const parts = readdirSync(out);
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatch(/^\..+\.mp4$/u);
  const mainPid = await app.evaluate(() => process.pid);
  const running = ffmpegUnder(mainPid);
  expect(running.length).toBeGreaterThan(0);
  await app.close();
  // Nothing of it is left: no file under its name, no part-file, no FFmpeg.
  expect(readdirSync(out)).toEqual([]);
  await expect.poll(() => running.filter(alive), { timeout: 15_000 }).toEqual([]);
  const log = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
  expect(log).not.toContain('Uncaught exception');
  expect(log).not.toContain('did not stop cleanly');
});

test('Drashti stopped dead during Save as MP4: on a Mac its FFmpeg runs on and the next start stops that very one, on Windows it ends with Drashti; either way the next start removes its part-file and says so (Session 31, ROB-3)', async () => {
  test.skip(!ffmpeg, 'needs the bundled FFmpeg');
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-crash-save-'));
  const source = join(dir, 'Placeholder long.mp4');
  const made = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=25',
    '-t',
    '90',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  expect(made.status).toBe(0);
  const out = join(dir, 'Saved');
  mkdirSync(out);
  // The save reads no faster than the video plays (a test switch): still going long after the crash.
  const env = { DRASHTI_TEST_SAVE_READRATE: '1' };
  const { app, userData } = await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  const [mediaId = ''] = await importAndGetIds(win, [source]);
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    },
    join(out, 'Placeholder long (1m 25s).mp4'),
  );
  const started = await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.media.saveTrim({
        mediaId: id,
        startMs: null,
        endMs: 85_000,
        addToLibrary: false,
      }),
    mediaId,
  );
  expect(started).toMatchObject({ ok: true });
  await expect
    .poll(
      async () =>
        (await win.evaluate(() => (globalThis as PageGlobals).drashti.media.saves()))[0]?.progress ?? 0,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0.02);
  const mainPid = await app.evaluate(() => process.pid);
  const running = ffmpegUnder(mainPid);
  expect(running.length).toBeGreaterThan(0);
  // A crash of Drashti's main process alone. On a Mac what it started carries on by itself. On Windows,
  // Node starts each program in a job that Windows closes, ending them, when Drashti's process ends.
  await killMainOnly(app);
  if (process.platform === 'win32')
    await expect.poll(() => running.filter(alive), { timeout: 10_000 }).toEqual([]);
  else await expect.poll(() => running.filter(alive).length, { timeout: 3000 }).toBeGreaterThan(0);
  expect(readdirSync(out).filter((f) => f.startsWith('.'))).toHaveLength(1);
  // The next start stops one still running before anything else, removes the part-file it was writing,
  // and says so.
  const again = await relaunchApp(userData, env);
  await expect.poll(() => running.filter(alive), { timeout: 20_000 }).toEqual([]);
  await expect.poll(() => readdirSync(out), { timeout: 10_000 }).toEqual([]);
  // Said as it is removed, by Drashti's own process a moment after the file goes: waited for, not read once
  // (CI's Mac read the log in that moment, run 39054667458).
  const logged = () => readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
  await expect.poll(logged, { timeout: 10_000 }).toContain('Removed a part-file left by the last run');
  const log = logged();
  if (process.platform === 'win32') expect(log).not.toContain('left running by the last run');
  else expect(log).toContain('Stopped a conversion left running by the last run');
  // Quit once it has started, as a person would (Session 37). Playwright's quit runs in the middle of whatever
  // the main process is doing, and Electron itself crashes (SIGSEGV) on a quit inside the making of a window,
  // which a start is full of: the audio player is the last window it makes.
  await operatorReady(await operatorPage(again.app));
  await expect.poll(() => again.app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  await again.app.close();
});

test('quitting during a YouTube download (Session 25c): no part-file, and no yt-dlp, Deno or FFmpeg left', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-quit-youtube-'));
  const chosen = join(dir, 'Chosen folder');
  const log = join(dir, 'fake.log');
  // The fake yt-dlp (never the real one), slow: still downloading when Drashti quits.
  const { app, userData } = await launchApp({
    DRASHTI_TEST_FAKE_YT_DLP: join(__dirname, 'fake-yt-dlp.cjs'),
    DRASHTI_TEST_FAKE_YT_DLP_CONFIG: JSON.stringify({
      log,
      title: 'Placeholder video',
      steps: 400,
      stepMs: 50,
    }),
    DRASHTI_TEST_DOWNLOADS_DIR: dir,
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, chosen);
  const view = () => win.evaluate(() => (globalThis as PageGlobals).drashti.links.view());
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.links.look('youtube', 'https://youtu.be/AAAAAAAAAAA'),
  );
  await expect.poll(async () => (await view()).phase, { timeout: 60_000 }).toBe('looked');
  await win.evaluate(async () => {
    const links = (globalThis as PageGlobals).drashti.links;
    await links.pickFolder();
    const started = await links.download({ type: 'mp4', height: 1080, permission: true });
    if (!started.ok) throw new Error(started.message);
  });
  await expect
    .poll(async () => (await view()).progress?.done ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(2000);
  // yt-dlp writes under a hidden name in the folder chosen.
  const parts = readdirSync(chosen);
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatch(/^\.drashti-youtube-[0-9a-f-]+$/u);
  expect(readdirSync(join(chosen, parts[0] ?? '')).some((n) => n.endsWith('.part'))).toBe(true);
  // The fake and the child it started (as yt-dlp starts Deno and FFmpeg), both running.
  const started = readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('start download'))
    .map((l) => l.split(' '))
    .flatMap((p) => [Number(p[4]), Number(p[6])]);
  expect(started).toHaveLength(2);
  expect(started.filter(alive)).toEqual(started);

  const mainPid = await app.evaluate(() => process.pid);
  const helpers = under(mainPid).map((p) => p.pid);
  for (const pid of started) expect(helpers).toContain(pid);
  await app.close();

  // Nothing of it is left: no part-file or work folder, and no yt-dlp (the fake), no child of it.
  expect(readdirSync(chosen)).toEqual([]);
  await expect.poll(() => started.filter(alive), { timeout: 15_000 }).toEqual([]);
  await expect.poll(() => helpers.filter(alive), { timeout: 15_000 }).toEqual([]);
  expect(
    existsSync(join(userData, 'Link downloads')) ? readdirSync(join(userData, 'Link downloads')) : [],
  ).toEqual([]);
  const drashtiLog = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
  expect(drashtiLog).not.toContain('Uncaught exception');
  expect(drashtiLog).not.toContain('did not stop cleanly');
});
