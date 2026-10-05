#!/usr/bin/env node
// After scripts/package-release.mjs: when the release was signed, check that every program in it is,
// FFmpeg included, and (on a Mac) that the camera and sound input are allowed and Gatekeeper accepts
// it; when it was not signed, say so and check nothing.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { signed, notarised } = JSON.parse(readFileSync('release-signing.json', 'utf8'));
if (!signed) {
  console.log('Not signed (no certificate was given): nothing to check.');
  process.exit(0);
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const out = join('release', version);
let failed = 0;
const check = (what, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
};
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

if (process.platform === 'darwin') {
  for (const dir of readdirSync(out).filter((d) => d.startsWith('mac'))) {
    const app = join(out, dir, 'Drashti.app');
    if (!existsSync(app)) continue;
    const deep = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    check(`${dir}: the app and everything in it is signed`, deep.status === 0);
    const ffmpeg = run('codesign', [
      '-dv',
      '--verbose=2',
      join(app, 'Contents', 'Resources', 'ffmpeg', 'ffmpeg'),
    ]);
    check(
      `${dir}: FFmpeg is signed with the Developer ID`,
      /Authority=Developer ID Application/u.test(ffmpeg.stderr),
    );
    check(`${dir}: FFmpeg runs under the hardened runtime`, /flags=.*runtime/u.test(ffmpeg.stderr));
    const ents = run('codesign', ['-d', '--entitlements', ':-', app]).stdout;
    check(`${dir}: the camera is allowed`, ents.includes('com.apple.security.device.camera'));
    check(`${dir}: the sound input is allowed`, ents.includes('com.apple.security.device.audio-input'));
    if (notarised) {
      const gate = run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
      check(
        `${dir}: Gatekeeper accepts it (notarised)`,
        gate.status === 0,
        gate.stderr.trim().split('\n')[0],
      );
    }
  }
} else if (process.platform === 'win32') {
  const unpacked = join(out, 'win-unpacked');
  const files = [
    join(unpacked, 'Drashti.exe'),
    join(unpacked, 'resources', 'ffmpeg', 'ffmpeg.exe'),
    ...readdirSync(out)
      .filter((f) => f.endsWith('.exe'))
      .map((f) => join(out, f)),
  ];
  for (const file of files) {
    const ps = run('powershell', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature '${file}').Status`]);
    check(`${file} is signed`, ps.stdout.trim() === 'Valid', ps.stdout.trim());
  }
}
process.exit(failed > 0 ? 1 : 0);
