// Check that Drashti finds and runs its own FFmpeg: DRASHTI_SELFTEST=ffmpeg
// (src/main/stream/ffmpeg-selftest.ts) prints its version, whether it speaks
// RTMPS, and which H.264 encoders work here. And YouTube's two programs
// (Session 25c, src/main/links/youtube-selftest.ts): yt-dlp and Deno run
// (--version only), and Deno, started as yt-dlp starts it, cannot read a
// file, reach 127.0.0.1 or start a program.
// In packaged apps the bundled Whisper program must also start (with --help, without a model), and video out's
// program (x30: Syphon on a Mac, Spout on Windows) must be there and start: its input ended at once, it says "ready"
// and stops by itself (scripts/fetch-video-out.mjs builds it; tools/video-out/).
// Book OCR (alpha.21): the reading process reads a blank page with its own model (src/main/ocr/ocr-selftest.ts).
// Prepare translations' engine (alpha.22): each packaged app's drashti-translate starts, says hello in its own
// protocol and stops by itself when its input ends (scripts/fetch-translate.mjs builds it; tools/translate/).
//
//   node scripts/check-ffmpeg.mjs             the built app in out/ (pnpm build first)
//   node scripts/check-ffmpeg.mjs --packaged  every app electron-builder left in release/
//                                             (an Intel Mac build runs under Rosetta when it can)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, removeTempRoot } from './temp-root.mjs';
import { probeTranslate } from './translate-probe.mjs';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const TIMEOUT_MS = 180_000;
// Under Rosetta (the Intel app on CI's Apple-silicon Mac) every program is translated the first time it
// runs: the app alone took 84 s to start in Session 25c's first run, and yt-dlp's and Deno's first runs
// come on top. Native runs take seconds.
const EMULATED_TIMEOUT_MS = 480_000;

/** Each packaged app's video out program: [label, command, arguments] (an Intel Mac's under Rosetta). */
const videoOutPrograms = [];
/** Each packaged app's translation engine, the same way. */
const translatePrograms = [];

/** Each packaged app: [label, command, arguments]. */
function packagedApps() {
  const release = join(app, 'release');
  const found = [];
  for (const version of existsSync(release) ? readdirSync(release) : []) {
    const at = (...parts) => join(release, version, ...parts);
    const macArm = at('mac-arm64', 'Drashti.app', 'Contents', 'MacOS', 'Drashti');
    const macIntel = at('mac', 'Drashti.app', 'Contents', 'MacOS', 'Drashti');
    const win = at('win-unpacked', 'Drashti.exe');
    const videoOut = (exe, appExe) => join(dirname(appExe), '..', 'Resources', 'video-out', exe);
    const translate = (appExe) => join(dirname(appExe), '..', 'Resources', 'translate', 'drashti-translate');
    if (existsSync(macArm)) {
      found.push(['macOS arm64', macArm, []]);
      videoOutPrograms.push(['macOS arm64', videoOut('drashti-video-out', macArm), []]);
      translatePrograms.push(['macOS arm64', translate(macArm), []]);
    }
    if (existsSync(macIntel)) {
      const program = videoOut('drashti-video-out', macIntel);
      if (process.arch === 'x64') {
        found.push(['macOS x64', macIntel, []]);
        videoOutPrograms.push(['macOS x64', program, []]);
        translatePrograms.push(['macOS x64', translate(macIntel), []]);
      } else if (spawnSync('arch', ['-x86_64', '/usr/bin/true']).status === 0) {
        found.push(['macOS x64 (under Rosetta)', 'arch', ['-x86_64', macIntel]]);
        videoOutPrograms.push(['macOS x64 (under Rosetta)', 'arch', ['-x86_64', program]]);
        translatePrograms.push(['macOS x64 (under Rosetta)', 'arch', ['-x86_64', translate(macIntel)]]);
      } else console.log('macOS x64: not run (this Mac has no Rosetta to run Intel apps)');
    }
    if (existsSync(win)) {
      found.push(['Windows x64', win, []]);
      videoOutPrograms.push([
        'Windows x64',
        join(dirname(win), 'resources', 'video-out', 'drashti-video-out.exe'),
        [],
      ]);
      translatePrograms.push([
        'Windows x64',
        join(dirname(win), 'resources', 'translate', 'drashti-translate.exe'),
        [],
      ]);
    }
  }
  if (found.length === 0)
    throw new Error('No unpacked app in release/: run pnpm package (or package:dir) first.');
  return found;
}

function check(label, command, args) {
  const limit = command === 'arch' ? EMULATED_TIMEOUT_MS : TIMEOUT_MS;
  const root = makeTempRoot();
  const env = { ...process.env, DRASHTI_SELFTEST: 'ffmpeg', DRASHTI_USER_DATA_DIR: join(root, 'data') };
  delete env['ELECTRON_RUN_AS_NODE'];
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), limit);
    child.on('exit', (code) => {
      clearTimeout(timer);
      removeTempRoot(root);
      const line = out.split('\n').find((l) => l.startsWith('DRASHTI_SELFTEST_RESULT '));
      if (!line) {
        const said =
          code === null ? `stopped after ${String(limit / 1000)} s without a result` : `exit ${code}`;
        console.log(`${label}: no result (${said})\n${out.slice(-2000)}`);
        resolve(false);
        return;
      }
      const result = JSON.parse(line.slice('DRASHTI_SELFTEST_RESULT '.length));
      const works = result.encoders.map((e) => `${e.label}: ${e.works ? 'works' : 'no'}`).join('; ');
      const yt = result.youtube;
      const whisper = result.whisper?.detail ?? (packaged ? 'no startup result' : 'checked in packaged apps');
      const passed = result.passed && (!packaged || result.whisper?.passed === true);
      const sandbox = yt.sandbox
        ? `reading a file: ${yt.sandbox.readFile}; reaching 127.0.0.1: ${yt.sandbox.network} (${yt.sandbox.connections} connection(s) arrived); starting a program: ${yt.sandbox.runProgram}`
        : 'not run';
      console.log(
        `${label}: ${passed ? 'OK' : 'FAILED'}\n  ${result.path}\n  ${result.version}\n  RTMPS: ${result.rtmps ? 'yes' : 'no'}\n  ${works}\n  Streams with: ${result.chosen ?? 'nothing'}\n  yt-dlp: ${yt.ytDlp.version ?? 'does not run'} (${yt.ytDlp.path ?? 'missing'})\n  Deno: ${yt.deno.version ?? 'does not run'} (${yt.deno.path ?? 'missing'})\n  Deno as yt-dlp starts it: ${sandbox}\n  Live captions: ${whisper}\n  Book OCR: ${result.ocr?.detail ?? 'no result'}`,
      );
      resolve(passed);
    });
  });
}

/** A packaged app's video out program starts: its input ended at once, it says "ready" and stops by itself. */
function checkVideoOut(label, command, args) {
  const program = command === 'arch' ? args[1] : command;
  if (!existsSync(program)) {
    console.log(`${label}: video out FAILED: no program at ${program}`);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const child = spawn(command, [...args, '--name', 'Drashti packaged check'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.stdin.end();
    const limit = command === 'arch' ? EMULATED_TIMEOUT_MS : 60_000;
    const timer = setTimeout(() => child.kill('SIGKILL'), limit);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const passed = code === 0 && /^ready$/mu.test(out);
      console.log(
        `${label}: video out ${passed ? 'OK' : `FAILED (exit ${String(code)})`}\n  ${program}\n  ${out.trim().split(/\r?\n/u).join('\n  ')}`,
      );
      resolve(passed);
    });
  });
}

/**
 * A packaged app's drashti-translate starts: it says hello (protocol 1), refuses what it must (scripts/translate-probe.mjs:
 * a bad line, a line over 64 KiB, an unknown op, a sentence before any model, a missing model), answers cancel and
 * quit, and exits 0. No model is needed.
 */
async function checkTranslate(label, command, args) {
  const program = command === 'arch' ? args[1] : command;
  if (!existsSync(program)) {
    console.log(`${label}: translation engine FAILED: no program at ${program}`);
    return false;
  }
  const result = await probeTranslate(command, args, command === 'arch' ? EMULATED_TIMEOUT_MS : 60_000);
  console.log(
    `${label}: translation engine ${result.passed ? 'OK' : `FAILED (${result.problems.join('; ')})`}\n  ${program}\n  ${result.output.trim().split(/\r?\n/u).join('\n  ')}`,
  );
  return result.passed;
}

const targets = packaged
  ? packagedApps()
  : [['built app', createRequire(import.meta.url)('electron'), ['.']]];
let ok = true;
for (const [label, command, args] of targets) ok = (await check(label, command, args)) && ok;
for (const [label, command, args] of videoOutPrograms) ok = (await checkVideoOut(label, command, args)) && ok;
for (const [label, command, args] of translatePrograms)
  ok = (await checkTranslate(label, command, args)) && ok;
process.exit(ok ? 0 : 1);
