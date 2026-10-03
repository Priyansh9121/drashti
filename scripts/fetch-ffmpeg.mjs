// Fetch the FFmpeg that Drashti bundles (a separate executable, for streaming,
// recording and converting media), for one platform or all of them:
//   node scripts/fetch-ffmpeg.mjs                 this computer's platform
//   node scripts/fetch-ffmpeg.mjs --target darwin-x64
//   node scripts/fetch-ffmpeg.mjs --all
// One pinned version from a known builder per platform, checked against its
// SHA-256 before anything is unpacked. Downloads are kept in
// ~/.cache/drashti/ffmpeg-<version>/ and the executable is put in
// vendor/ffmpeg/<platform>-<arch>/ (never committed: see .gitignore).
// Licences: LICENSES/ffmpeg/ (FFmpeg as built here is GPL version 3).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const FFMPEG_VERSION = '9.0.2';

/**
 * Where each build comes from. macOS: Martin Riedl's static builds (signed by
 * him, with VideoToolbox, x264 and OpenSSL for RTMPS). Windows: Gyan Doshi's
 * "essentials" build as published on GitHub (with NVENC, Quick Sync, AMF,
 * Media Foundation, x264 and Schannel/OpenSSL for RTMPS).
 */
export const FFMPEG_BUILDS = {
  'darwin-arm64': {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip',
    sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
    member: 'ffmpeg',
    exe: 'ffmpeg',
  },
  'darwin-x64': {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip',
    sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
    member: 'ffmpeg',
    exe: 'ffmpeg',
  },
  'win32-x64': {
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
    sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    member: 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe',
    exe: 'ffmpeg.exe',
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(homedir(), '.cache', 'drashti', `ffmpeg-${FFMPEG_VERSION}`);

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

async function download(url, to) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  const partial = `${to}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, to);
}

/** Unpack one file from a zip into a folder (the system's own unzip or tar: nothing to install). */
function unpack(zip, member, into) {
  mkdirSync(into, { recursive: true });
  const run = (command, args) => spawnSync(command, args, { stdio: 'inherit' }).status === 0;
  // Windows' own tar reads zip files (Git's GNU tar, often first on the PATH, does not).
  const windowsTar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
  const ok =
    process.platform === 'win32'
      ? run(windowsTar, ['-xf', zip, '-C', into, member])
      : run('unzip', ['-o', '-q', zip, member, '-d', into]);
  if (!ok) throw new Error(`Could not unpack ${member} from ${zip}`);
  return join(into, member);
}

/** Fetch (or reuse) one target's FFmpeg and put it in vendor/; returns its path. */
export async function fetchFfmpeg(target) {
  const build = FFMPEG_BUILDS[target];
  if (!build) throw new Error(`No FFmpeg build is pinned for ${target}`);
  const outDir = join(root, 'vendor', 'ffmpeg', target);
  const out = join(outDir, build.exe);
  const stamp = join(outDir, 'SOURCE.txt');
  if (existsSync(out) && existsSync(stamp) && readFileSync(stamp, 'utf8').includes(build.sha256)) return out;
  mkdirSync(cacheDir, { recursive: true });
  const zip = join(cacheDir, `${target}.zip`);
  if (!existsSync(zip) || sha256Of(zip) !== build.sha256) {
    console.log(`Downloading FFmpeg ${FFMPEG_VERSION} for ${target}…`);
    rmSync(zip, { force: true });
    await download(build.url, zip);
  }
  const got = sha256Of(zip);
  if (got !== build.sha256) {
    rmSync(zip, { force: true });
    throw new Error(`FFmpeg for ${target} failed its check: sha256 ${got}, expected ${build.sha256}`);
  }
  const tmp = join(cacheDir, `${target}-unpacked`);
  rmSync(tmp, { recursive: true, force: true });
  const unpacked = unpack(zip, build.member, tmp);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyFileSync(unpacked, out);
  if (!build.exe.endsWith('.exe')) chmodSync(out, 0o755);
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(
    stamp,
    `FFmpeg ${FFMPEG_VERSION} for ${target}\nfrom ${build.url}\nsha256 of the download ${build.sha256}\nGPL version 3: see LICENSES/ffmpeg/ in Drashti's repository.\n`,
  );
  console.log(`FFmpeg ${FFMPEG_VERSION} for ${target}: ${out}`);
  return out;
}

const thisTarget = `${process.platform}-${process.arch}`;

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--target');
  const targets = args.includes('--all') ? Object.keys(FFMPEG_BUILDS) : [at >= 0 ? args[at + 1] : thisTarget];
  for (const target of targets) await fetchFfmpeg(target);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
