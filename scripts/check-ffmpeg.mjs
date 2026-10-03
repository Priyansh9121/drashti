// Check that Drashti finds and runs its own FFmpeg: DRASHTI_SELFTEST=ffmpeg
// (src/main/stream/ffmpeg-selftest.ts) prints its version, whether it speaks
// RTMPS, and which H.264 encoders work here.
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

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const TIMEOUT_MS = 120_000;

/** Each packaged app: [label, command, arguments]. */
function packagedApps() {
  const release = join(app, 'release');
  const found = [];
  for (const version of existsSync(release) ? readdirSync(release) : []) {
    const at = (...parts) => join(release, version, ...parts);
    const macArm = at('mac-arm64', 'Drashti.app', 'Contents', 'MacOS', 'Drashti');
    const macIntel = at('mac', 'Drashti.app', 'Contents', 'MacOS', 'Drashti');
    const win = at('win-unpacked', 'Drashti.exe');
    if (existsSync(macArm)) found.push(['macOS arm64', macArm, []]);
    if (existsSync(macIntel)) {
      if (process.arch === 'x64') found.push(['macOS x64', macIntel, []]);
      else if (spawnSync('arch', ['-x86_64', '/usr/bin/true']).status === 0)
        found.push(['macOS x64 (under Rosetta)', 'arch', ['-x86_64', macIntel]]);
      else console.log('macOS x64: not run (this Mac has no Rosetta to run Intel apps)');
    }
    if (existsSync(win)) found.push(['Windows x64', win, []]);
  }
  if (found.length === 0) throw new Error('No unpacked app in release/: run pnpm package (or package:dir) first.');
  return found;
}

function check(label, command, args) {
  const root = makeTempRoot();
  const env = { ...process.env, DRASHTI_SELFTEST: 'ffmpeg', DRASHTI_USER_DATA_DIR: join(root, 'data') };
  delete env['ELECTRON_RUN_AS_NODE'];
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      removeTempRoot(root);
      const line = out.split('\n').find((l) => l.startsWith('DRASHTI_SELFTEST_RESULT '));
      if (!line) {
        console.log(`${label}: no result (exit ${code})\n${out.slice(-2000)}`);
        resolve(false);
        return;
      }
      const result = JSON.parse(line.slice('DRASHTI_SELFTEST_RESULT '.length));
      const works = result.encoders.map((e) => `${e.label}: ${e.works ? 'works' : 'no'}`).join('; ');
      console.log(
        `${label}: ${result.passed ? 'OK' : 'FAILED'}\n  ${result.path}\n  ${result.version}\n  RTMPS: ${result.rtmps ? 'yes' : 'no'}\n  ${works}\n  Streams with: ${result.chosen ?? 'nothing'}`,
      );
      resolve(result.passed);
    });
  });
}

const targets = packaged
  ? packagedApps()
  : [['built app', createRequire(import.meta.url)('electron'), ['.']]];
let ok = true;
for (const [label, command, args] of targets) ok = (await check(label, command, args)) && ok;
process.exit(ok ? 0 : 1);
