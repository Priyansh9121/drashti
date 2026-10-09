import { expect, test } from '@playwright/test';
import { type ChildProcess, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { networkOn } from './devices';
import { importAndGetIds, type PageGlobals } from './helpers';
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

/** The FFmpeg processes started under this process (by its workers). */
function ffmpegUnder(root: number): number[] {
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
  return all.filter((p) => mine.has(p.pid) && /ffmpeg/iu.test(p.name)).map((p) => p.pid);
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
