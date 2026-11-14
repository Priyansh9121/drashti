// CI's own FFmpeg for the unit tests on its Ubuntu runner (Session 58, CI-1). Drashti is never built for Linux, so
// scripts/fetch-ffmpeg.mjs pins no Linux build, and Ubuntu skipped the unit tests that need FFmpeg, among them
// src/main/import/deck/deck-import.test.ts. This one is for CI's Ubuntu job only: never shipped, never in an
// installer (electron-builder takes only vendor/ffmpeg/darwin-* and win32-*), never given to anyone.
//   node scripts/fetch-ci-ffmpeg.mjs            put it in vendor/ffmpeg-ci/linux-x64/ (CI's Ubuntu job)
//   node scripts/fetch-ci-ffmpeg.mjs --sha256   print its pinned SHA-256 (the key of its cache in CI)
// Pinned as fetch-ffmpeg.mjs pins the bundled builds: one exact download, checked against its SHA-256 before it is
// unpacked; one that does not match fails loudly and is never used. The download is kept in
// ~/.cache/drashti/ffmpeg-ci/ (CI caches it by that SHA-256) and tried three times (download-source.mjs). If it
// still cannot be had, a warning says why and the tests that need it are skipped, as they were before: a network
// blip never fails CI. Only the tests proven on Linux use it (src/main/testing/ffmpeg-here.ts, testFfmpeg).
// Licence: GPL version 3 (LICENSES/ffmpeg/README.md).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { downloadSource } from './download-source.mjs';
import { digestLine, stillAsUnpacked } from './tree-digest.mjs';

/**
 * The build: FFmpeg-Builds' (BtbN's, https://github.com/FFmpeg-Builds/FFmpeg-Builds) static Linux build, GPL
 * version 3, of FFmpeg 9.0.2 (the version Drashti ships) with its release branch's next 17 fixes. A month's last
 * build, which FFmpeg-Builds keeps for two years (its daily builds go after 14 days). When FFmpeg's pinned version
 * changes (fetch-ffmpeg.mjs), this changes with it: a month's last build of the same version.
 */
export const CI_FFMPEG = {
  name: 'ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0.tar.xz',
  url: 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0.tar.xz',
  sha256: '68ee646831adaae2495618346f3bba94ff207ff83bbd34d643e7004730d66269',
  member: 'ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0/bin/ffmpeg',
};

/** How long one try may take before it counts as failed: 151 MB, which CI's runners fetch from GitHub in seconds. */
const TRY_MS = 180_000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The folder the program goes in, under a checkout (the tests find it there: src/main/testing/ffmpeg-here.ts). */
export const ciFfmpegDir = (checkout) => join(checkout, 'vendor', 'ffmpeg-ci', 'linux-x64');

async function sha256Of(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Unpack one file from a .tar.xz into a folder (the system's own tar: nothing to install). */
function untar(archive, member, into) {
  mkdirSync(into, { recursive: true });
  if (spawnSync('tar', ['-xJf', archive, '-C', into, member], { stdio: 'inherit' }).status !== 0)
    throw new Error(`Could not unpack ${member} from ${archive}`);
  return join(into, member);
}

/**
 * Fetch (or reuse) CI's Linux FFmpeg into `outDir`, its download kept in `cacheDir`. `{ ok: true, path }` once the
 * program is there; `{ ok: false, why }` when its download could not be had after three tries (nothing is left
 * behind, so the tests that need it skip). Throws when a download does not match the pinned SHA-256 (removed, never
 * used) or cannot be unpacked. `fetch`, `pause` and `unpack` are passed in, so the unit test needs neither the
 * network, the wait nor an archive.
 */
export async function fetchCiFfmpeg({ build = CI_FFMPEG, cacheDir, outDir, fetch, pause, unpack = untar }) {
  const out = join(outDir, 'ffmpeg');
  const stamp = join(outDir, 'SOURCE.txt');
  // Reused only while it is still what was unpacked, as fetch-ffmpeg.mjs does.
  if (
    existsSync(out) &&
    existsSync(stamp) &&
    stillAsUnpacked(readFileSync(stamp, 'utf8'), outDir, build.sha256)
  )
    return { ok: true, path: out };
  mkdirSync(cacheDir, { recursive: true });
  const archive = join(cacheDir, build.name);
  if (!existsSync(archive) || (await sha256Of(archive)) !== build.sha256) {
    console.log(`Downloading CI's Linux FFmpeg (${build.name})…`);
    rmSync(archive, { force: true });
    const partial = `${archive}.partial`;
    try {
      await downloadSource({ name: build.name, url: build.url }, partial, fetch, pause);
    } catch (error) {
      rmSync(partial, { force: true });
      return { ok: false, why: error instanceof Error ? error.message : String(error) };
    }
    renameSync(partial, archive);
  }
  const got = await sha256Of(archive);
  if (got !== build.sha256) {
    rmSync(archive, { force: true });
    throw new Error(
      `CI's Linux FFmpeg failed its check: sha256 ${got}, expected ${build.sha256} (${build.url}). It was not used.`,
    );
  }
  const tmp = join(cacheDir, 'unpacked');
  rmSync(tmp, { recursive: true, force: true });
  const unpacked = unpack(archive, build.member, tmp);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyFileSync(unpacked, out);
  chmodSync(out, 0o755);
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(
    stamp,
    `FFmpeg ${build.name}, for CI's Linux unit tests only (never shipped)\nfrom ${build.url}\nsha256 of the download ${build.sha256}\n${digestLine(outDir)}\nGPL version 3: see LICENSES/ffmpeg/ in Drashti's repository.\n`,
  );
  return { ok: true, path: out };
}

/** A GitHub Actions annotation (`::warning title=…::…`), its title and message escaped as workflow commands need. */
export function annotation(kind, title, message) {
  const data = (s) => s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  const property = (s) => data(s).replaceAll(':', '%3A').replaceAll(',', '%2C');
  return `::${kind} title=${property(title)}::${data(message)}`;
}

/** A message as an annotation on GitHub Actions, else as it is. */
const say = (kind, message) =>
  process.env['GITHUB_ACTIONS'] ? annotation(kind, "CI's Linux FFmpeg", message) : message;

async function main() {
  if (process.argv.includes('--sha256')) {
    console.log(CI_FFMPEG.sha256);
    return;
  }
  const result = await fetchCiFfmpeg({
    cacheDir: join(homedir(), '.cache', 'drashti', 'ffmpeg-ci'),
    outDir: ciFfmpegDir(root),
    fetch: (url) => fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TRY_MS) }),
    pause: (ms) => sleep(ms),
  });
  if (!result.ok) {
    console.log(
      say(
        'warning',
        `${result.why}, so this job skips the unit tests that need it (src/main/import/deck/deck-import.test.ts), as before.`,
      ),
    );
    return;
  }
  console.log(`CI's Linux FFmpeg: ${result.path}`);
  // For the step that saves its download in CI's cache.
  if (process.env['GITHUB_OUTPUT']) appendFileSync(process.env['GITHUB_OUTPUT'], 'ready=true\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(say('error', error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
