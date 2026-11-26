#!/usr/bin/env node
// After scripts/package-release.mjs: when the release was signed, check that every program in it is,
// FFmpeg, yt-dlp and Deno included, and (on a Mac) that the camera and sound input are allowed and Gatekeeper accepts
// it; when it was not signed, say so and check nothing.
//
// Since QA24-SIGN-1 a Mac build can be signed with Drashti's own certificate (kind "own" in release-signing.json):
// then every program is signed with it, and the app's designated requirement must name org.drashti.app and that
// certificate's SHA-1, never the build's own hash (as ad hoc), or macOS would forget its permissions at each update.
// The SHA-1 goes to the job's summary, so two builds can be compared.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  certificateSha1,
  designatedRequirement,
  OWN_IDENTITY,
  ownRequirement,
  ownSummary,
  signedBy,
} from './mac-signature.mjs';

const { signed, notarised, kind } = JSON.parse(readFileSync('release-signing.json', 'utf8'));
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

if (process.platform === 'darwin' && kind === 'own') {
  const builds = [];
  for (const dir of readdirSync(out).filter((d) => d.startsWith('mac'))) {
    const app = join(out, dir, 'Drashti.app');
    if (!existsSync(app)) continue;
    const deep = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    check(`${dir}: the app and everything in it is signed`, deep.status === 0);
    check(
      `${dir}: it is signed with Drashti's own certificate (${OWN_IDENTITY}), not ad hoc`,
      signedBy(run('codesign', ['-dvv', app]).stderr) === 'own',
    );
    const shown = run('codesign', ['-d', '-r-', app]);
    const requirement = designatedRequirement(`${shown.stdout}\n${shown.stderr}`);
    const own = ownRequirement(requirement);
    check(
      `${dir}: its designated requirement names org.drashti.app and the certificate, not the build's own hash`,
      own.ok,
      own.ok ? (requirement ?? '') : own.why,
    );
    // The requirement's SHA-1 is the certificate that signed this very app (codesign0: the leaf, as it signed).
    const certs = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'drashti-certs-'));
    run('codesign', ['-d', `--extract-certificates=${join(certs, 'codesign')}`, app]);
    const leaf = join(certs, 'codesign0');
    const leafSha1 = existsSync(leaf) ? certificateSha1(readFileSync(leaf)) : 'none';
    rmSync(certs, { recursive: true, force: true });
    check(
      `${dir}: the requirement's certificate is the one that signed it`,
      own.ok && own.sha1 === leafSha1,
      `SHA-1 ${leafSha1}`,
    );
    if (own.ok) builds.push({ dir, sha1: own.sha1, requirement: requirement ?? '' });
    // FFmpeg, and YouTube's two programs (Session 25c): signed with the same certificate as the app.
    for (const [what, file] of [
      ['FFmpeg', join(app, 'Contents', 'Resources', 'ffmpeg', 'ffmpeg')],
      ['yt-dlp', join(app, 'Contents', 'Resources', 'yt-dlp', 'yt-dlp_macos')],
      ['Deno', join(app, 'Contents', 'Resources', 'deno', 'deno')],
    ])
      check(
        `${dir}: ${what} is signed with Drashti's own certificate`,
        signedBy(run('codesign', ['-dvv', file]).stderr) === 'own',
      );
    const ents = run('codesign', ['-d', '--entitlements', ':-', app]).stdout;
    check(`${dir}: the camera is allowed`, ents.includes('com.apple.security.device.camera'));
    check(`${dir}: the sound input is allowed`, ents.includes('com.apple.security.device.audio-input'));
  }
  check('the Mac builds are signed', builds.length > 0);
  check(
    'every Mac build has the same designated requirement',
    new Set(builds.map((b) => b.requirement)).size === 1,
  );
  if (builds.length > 0) {
    const summary = ownSummary(builds);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
} else if (process.platform === 'darwin') {
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
    // YouTube's two programs (Session 25c), signed by Drashti's own Developer ID, not as they came.
    const appTeam = /^TeamIdentifier=(.*)$/mu.exec(run('codesign', ['-dvv', app]).stderr)?.[1];
    for (const [what, file] of [
      ['yt-dlp', join(app, 'Contents', 'Resources', 'yt-dlp', 'yt-dlp_macos')],
      ['Deno', join(app, 'Contents', 'Resources', 'deno', 'deno')],
    ]) {
      const signing = run('codesign', ['-dv', '--verbose=2', file]).stderr;
      check(
        `${dir}: ${what} is signed with Drashti's Developer ID`,
        /Authority=Developer ID Application/u.test(signing) &&
          /^TeamIdentifier=(.*)$/mu.exec(signing)?.[1] === appTeam,
      );
      check(`${dir}: ${what} runs under the hardened runtime`, /flags=.*runtime/u.test(signing));
    }
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
    join(unpacked, 'resources', 'yt-dlp', 'yt-dlp.exe'),
    join(unpacked, 'resources', 'deno', 'deno.exe'),
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
