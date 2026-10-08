#!/usr/bin/env node
// Install each of this computer's installers as a person would, then start the Drashti it installed
// (Session 18). The installers are the ones scripts/package-release.mjs left in release/<version>/,
// under the names that never change (build/downloads.json).
//
//   macOS    each .dmg is opened (hdiutil), Drashti.app is dragged out of it (ditto) into a folder of
//            its own (never /Applications), and the disk image is closed. The app must be built for
//            the processor its name says, with an FFmpeg for that processor inside, and must start:
//            its FFmpeg self-test and its watchdog self-test (an Intel Mac's app under Rosetta, when
//            this Mac has it). Each .zip, what Drashti's own updates install, is opened the same way
//            and must hold the same app for the same processor. What Gatekeeper says is printed.
//   Windows  the setup .exe installs silently (/S) into the usual place (%LOCALAPPDATA%\Programs\Drashti),
//            with its Start menu entry; the installed Drashti must start (the same two self-tests);
//            then it is uninstalled silently and must be gone.
//
//   node scripts/check-installers.mjs
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { makeTempRoot, removeTempRoot } from './temp-root.mjs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const out = resolve('release', version);
const { files } = JSON.parse(readFileSync(join('build', 'downloads.json'), 'utf8'));
const mine = files.filter((f) => f.platform === process.platform);
const TIMEOUT_MS = 240_000;
const results = [];

const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 300_000, ...options });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), status: r.status };
};
const fail = (name, why) => {
  results.push({ name, ok: false, why });
  console.log(`  FAILED: ${why}`);
};
const pass = (name, what) => {
  results.push({ name, ok: true, why: what });
  console.log(`  ${what}`);
};

/** Start Drashti for one of its self-tests (DRASHTI_SELFTEST), with a data folder of its own. */
function selfTest(mode, command, args) {
  const root = makeTempRoot();
  const env = {
    ...process.env,
    DRASHTI_SELFTEST: mode,
    DRASHTI_USER_DATA_DIR: join(root, 'data'),
    DRASHTI_NO_QUIT_CONFIRM: '1',
  };
  delete env['ELECTRON_RUN_AS_NODE'];
  return new Promise((done) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d.toString()));
    child.stderr.on('data', (d) => (log += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      removeTempRoot(root);
      const line = log.split('\n').find((l) => l.startsWith('DRASHTI_SELFTEST_RESULT '));
      done({ code, result: line ? JSON.parse(line.slice('DRASHTI_SELFTEST_RESULT '.length)) : null, log });
    });
  });
}

/** True when `path` is inside `dir` (links resolved: a Mac's temporary folder is reached through one). */
function within(path, dir) {
  const real = (p) => {
    const r = existsSync(p) ? realpathSync(p) : resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return real(path).startsWith(real(dir) + sep);
}

/** The installed app starts: it finds and runs its own FFmpeg, and the watchdog self-test passes. */
async function starts(name, command, args, appDir) {
  const ffmpeg = await selfTest('ffmpeg', command, args);
  const f = ffmpeg.result;
  if (!f) fail(name, `no FFmpeg self-test result (exit ${String(ffmpeg.code)})\n${ffmpeg.log.slice(-1500)}`);
  else if (!f.passed) fail(name, `its FFmpeg self-test failed (${String(f.path)})`);
  else if (!within(f.path, appDir))
    fail(name, `it ran an FFmpeg from outside the installed app: ${String(f.path)}`);
  else pass(name, `starts, and runs its own FFmpeg (${f.version}; streams with ${f.chosen ?? 'nothing'})`);
  const watchdog = await selfTest('watchdog', command, args);
  const w = watchdog.result;
  if (!w)
    fail(name, `no watchdog self-test result (exit ${String(watchdog.code)})\n${watchdog.log.slice(-1500)}`);
  else if (!w.passed || watchdog.code !== 0)
    fail(
      name,
      `the watchdog self-test failed: ${w.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.name} (${c.detail})`)
        .join('; ')}`,
    );
  else
    pass(
      name,
      `the watchdog self-test passed (${String(w.checks.length)} checks: an output, the sound, crashes)`,
    );
}

const MAC_ARCH = { arm64: 'arm64', x64: 'x86_64' };

/** The app's version and processor, and its FFmpeg's processor. */
function checkMacApp(name, app, arch) {
  const plist = join(app, 'Contents', 'Info.plist');
  const shown = run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]).out;
  if (!shown.startsWith(version.split('-')[0] ?? version)) {
    fail(name, `the app inside says version ${shown}, not ${version}`);
    return false;
  }
  const binary = join(app, 'Contents', 'MacOS', 'Drashti');
  const ffmpeg = join(app, 'Contents', 'Resources', 'ffmpeg', 'ffmpeg');
  const archs = run('lipo', ['-archs', binary]).out;
  const ffArchs = existsSync(ffmpeg) ? run('lipo', ['-archs', ffmpeg]).out : 'missing';
  if (archs !== MAC_ARCH[arch] || ffArchs !== MAC_ARCH[arch]) {
    fail(name, `built for ${archs} with an FFmpeg for ${ffArchs}, not ${MAC_ARCH[arch]}`);
    return false;
  }
  // Its own signature covers it all (a Developer ID's, or ad hoc without a certificate): otherwise a
  // downloaded copy is one macOS calls damaged, with no Open Anyway.
  const covered = run('codesign', ['--verify', '--deep', '--strict', app]);
  if (!covered.ok) {
    fail(
      name,
      `its signature does not cover it (macOS would call a download damaged): ${covered.out.slice(-300)}`,
    );
    return false;
  }
  const kind = /Authority=Developer ID Application/u.test(run('codesign', ['-dvv', app]).out)
    ? 'a Developer ID'
    : 'ad hoc';
  pass(
    name,
    `holds Drashti ${shown} for ${archs}, with its FFmpeg for ${ffArchs}, signed (${kind}) all through`,
  );
  return true;
}

async function checkDmg(f) {
  const dmg = join(out, f.name);
  console.log(`${f.name} (for ${f.for})`);
  if (!existsSync(dmg)) return fail(f.name, 'missing');
  const mount = mkdtempSync(join(tmpdir(), 'drashti-dmg-'));
  const apps = mkdtempSync(join(tmpdir(), 'drashti-apps-'));
  try {
    let attached = { ok: false, out: '' };
    for (let i = 0; i < 3 && !attached.ok; i++) {
      if (i > 0) spawnSync('sleep', ['5']);
      attached = run('hdiutil', [
        'attach',
        '-nobrowse',
        '-noautoopen',
        '-readonly',
        '-mountpoint',
        mount,
        dmg,
      ]);
    }
    if (!attached.ok) return fail(f.name, `the disk image did not open: ${attached.out.slice(-300)}`);
    const link = join(mount, 'Applications');
    const toApplications =
      existsSync(link) && lstatSync(link).isSymbolicLink() && readlinkSync(link) === '/Applications';
    if (!existsSync(join(mount, 'Drashti.app')) || !toApplications) {
      run('hdiutil', ['detach', mount, '-force']);
      return fail(f.name, 'it does not hold Drashti.app beside a link to Applications');
    }
    // Dragged to Applications, as a person would (here, a folder of its own).
    const copied = run('ditto', [join(mount, 'Drashti.app'), join(apps, 'Drashti.app')]);
    const detached = run('hdiutil', ['detach', mount]).ok || run('hdiutil', ['detach', mount, '-force']).ok;
    if (!copied.ok) return fail(f.name, `Drashti.app could not be copied out: ${copied.out.slice(-300)}`);
    if (!detached) console.log('  (the disk image would not close; carrying on)');
    pass(f.name, 'opens, with Drashti.app beside a link to Applications, and copies out');
    const app = join(apps, 'Drashti.app');
    if (!checkMacApp(f.name, app, f.arch)) return;
    const gatekeeper = run('spctl', ['--assess', '--type', 'execute', '-vv', app])
      .out.split('\n')
      .slice(0, 2)
      .join('; ');
    console.log(`  Gatekeeper says: ${gatekeeper || 'nothing'}`);
    const binary = join(app, 'Contents', 'MacOS', 'Drashti');
    if (f.arch === 'arm64' && process.arch !== 'arm64')
      return console.log('  not started: this Mac has an Intel processor');
    if (f.arch === 'x64' && process.arch === 'arm64') {
      if (!run('arch', ['-x86_64', '/usr/bin/true']).ok)
        return console.log('  not started: this Mac has no Rosetta to run Intel apps');
      await starts(`${f.name} (under Rosetta)`, 'arch', ['-x86_64', binary], app);
    } else await starts(f.name, binary, [], app);
  } finally {
    rmSync(apps, { recursive: true, force: true });
    rmSync(mount, { recursive: true, force: true });
  }
}

function checkZip(f) {
  const zip = join(out, f.name);
  console.log(`${f.name} (for ${f.for})`);
  if (!existsSync(zip)) return fail(f.name, 'missing');
  const into = mkdtempSync(join(tmpdir(), 'drashti-zip-'));
  try {
    const opened = run('ditto', ['-x', '-k', zip, into]);
    if (!opened.ok || !existsSync(join(into, 'Drashti.app')))
      return fail(f.name, `it does not open to Drashti.app: ${opened.out.slice(-300)}`);
    checkMacApp(f.name, join(into, 'Drashti.app'), f.arch);
  } finally {
    rmSync(into, { recursive: true, force: true });
  }
}

async function checkWindows(f) {
  const setup = join(out, f.name);
  console.log(`${f.name} (for ${f.for})`);
  if (!existsSync(setup)) return fail(f.name, 'missing');
  const local = process.env['LOCALAPPDATA'] ?? '';
  const installDir = join(local, 'Programs', 'Drashti');
  const exe = join(installDir, 'Drashti.exe');
  if (existsSync(exe))
    return fail(f.name, `Drashti is installed already at ${installDir}: not installing over it`);
  const installed = run(setup, ['/S'], { timeout: 600_000 });
  if (!installed.ok || !existsSync(exe))
    return fail(
      f.name,
      `the silent install did not put Drashti.exe in ${installDir} (exit ${String(installed.status)})`,
    );
  try {
    const shown = run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-Item -LiteralPath '${exe.replace(/'/gu, "''")}').VersionInfo.ProductVersion`,
    ]).out;
    const menu = join(
      process.env['APPDATA'] ?? '',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Drashti.lnk',
    );
    if (!shown.startsWith(version.split('-')[0] ?? version))
      fail(f.name, `the installed Drashti.exe says version ${shown}, not ${version}`);
    else if (!existsSync(menu)) fail(f.name, 'no Drashti in the Start menu');
    else pass(f.name, `installs Drashti ${shown} into ${installDir}, with a Start menu entry`);
    await starts(f.name, exe, [], installDir);
  } finally {
    // Uninstalled as a person would (Settings, Apps), silently; the uninstaller finishes on its own.
    const uninstaller = join(installDir, 'Uninstall Drashti.exe');
    if (existsSync(uninstaller)) run(uninstaller, ['/S']);
    for (let i = 0; i < 60 && existsSync(exe); i++)
      spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 1']);
    if (existsSync(exe)) fail(f.name, 'the silent uninstall left Drashti.exe behind');
    else pass(f.name, 'uninstalls silently');
  }
}

console.log(`Installing Drashti ${version} as a person would, from ${out}\n`);
for (const f of mine) {
  if (f.kind === 'dmg') await checkDmg(f);
  else if (f.kind === 'zip') checkZip(f);
  else if (f.kind === 'nsis') await checkWindows(f);
  console.log('');
}
const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `Every installer for ${process.platform} installs, and the Drashti it installs starts.`
    : `${String(failed.length)} check(s) failed: ${failed.map((r) => r.name).join(', ')}`,
);
process.exit(failed.length === 0 && results.length > 0 ? 0 : 1);
