// Fetch the live captions engine Drashti bundles (Session 55, Part 10): whisper.cpp (MIT), a separate program, for
// one platform or all of them:
//   node scripts/fetch-whisper.mjs                 this computer's platform
//   node scripts/fetch-whisper.mjs --target darwin-x64
//   node scripts/fetch-whisper.mjs --all            (a Mac target needs a Mac: its program is compiled there)
// One pinned whisper.cpp release (v1.9.5, its build b5454) for every platform, each download checked against its
// SHA-256 before anything is unpacked. Downloads are kept in ~/.cache/drashti/whisper-<version>/ and the engine is
// put in vendor/whisper/<platform>-<arch>/ (never committed: see .gitignore), from where the installers take it.
// - Windows x64: whisper.cpp's own whisper-server.exe and its DLLs (whisper-bin-x64.zip).
// - macOS (Apple silicon and Intel): whisper.cpp's prebuilt library (whisper.framework, from its xcframework), and
//   tools/whisper-server/drashti-whisper.c, our small program on it that answers as whisper-server does, compiled
//   here by the Mac's own clang (the owner's choice, 4 Nov 2026: no prebuilt Mac program exists). The library needs
//   macOS 13.3 or later.
// The models are never bundled: Drashti downloads the one an admin chooses into its data folder (main/speech/models.ts).
// Licences: LICENSES/whisper/.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
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
import { digestLine, stillAsUnpacked } from './tree-digest.mjs';

export const WHISPER_VERSION = '1.9.5';
const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454';

/** whisper-server.exe's DLLs: whisper and ggml, with every CPU variant ggml picks from at run time. */
const WINDOWS_FILES = [
  'whisper-server.exe',
  'whisper.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu-x64.dll',
  'ggml-cpu-sse42.dll',
  'ggml-cpu-sandybridge.dll',
  'ggml-cpu-haswell.dll',
  'ggml-cpu-skylakex.dll',
  'ggml-cpu-icelake.dll',
  'ggml-cpu-alderlake.dll',
  'ggml-cpu-cannonlake.dll',
  'ggml-cpu-cascadelake.dll',
];

const XCFRAMEWORK = {
  url: `${RELEASE}/whisper-b5454-xcframework.zip`,
  sha256: 'e57f8c48933000acabc13bb913fbe82805d483a2deff692cc6738836bd92393b',
  framework: 'build-apple/whisper.xcframework/macos-arm64_x86_64/whisper.framework',
};

export const WHISPER_BUILDS = {
  'win32-x64': {
    url: `${RELEASE}/whisper-bin-x64.zip`,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
    exe: 'whisper-server.exe',
  },
  'darwin-arm64': { ...XCFRAMEWORK, exe: 'drashti-whisper', arch: 'arm64' },
  'darwin-x64': { ...XCFRAMEWORK, exe: 'drashti-whisper', arch: 'x86_64' },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(homedir(), '.cache', 'drashti', `whisper-${WHISPER_VERSION}`);

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = (command, args) => {
  const r = spawnSync(command, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};

async function download(url, to) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  const partial = `${to}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, to);
}

/** The pinned zip, downloaded once and checked. */
async function fetchZip(url, sha256, name) {
  mkdirSync(cacheDir, { recursive: true });
  const zip = join(cacheDir, name);
  if (!existsSync(zip) || sha256Of(zip) !== sha256) {
    console.log(`Downloading whisper.cpp ${WHISPER_VERSION} (${name})…`);
    rmSync(zip, { force: true });
    await download(url, zip);
  }
  const got = sha256Of(zip);
  if (got !== sha256) {
    rmSync(zip, { force: true });
    throw new Error(`whisper.cpp's ${name} failed its check: sha256 ${got}, expected ${sha256}`);
  }
  return zip;
}

function unpackWindows(zip, into) {
  // Windows' own tar reads zip files (Git's GNU tar, often first on the PATH, does not).
  const windowsTar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
  const members = WINDOWS_FILES.map((f) => `Release/${f}`);
  if (process.platform === 'win32') run(windowsTar, ['-xf', zip, '-C', into, ...members]);
  else run('unzip', ['-o', '-q', zip, ...members, '-d', into]);
  return join(into, 'Release');
}

/** Fetch (or reuse) one target's engine and put it in vendor/; returns its program's path. */
export async function fetchWhisper(target) {
  const build = WHISPER_BUILDS[target];
  if (!build) throw new Error(`No captions engine is pinned for ${target}`);
  const outDir = join(root, 'vendor', 'whisper', target);
  const out = join(outDir, build.exe);
  const stamp = join(outDir, 'SOURCE.txt');
  const source = target.startsWith('darwin')
    ? join(root, 'tools', 'whisper-server', 'drashti-whisper.c')
    : null;
  const sourceSha = source ? sha256Of(source) : null;
  // Reused only while it is still what was made (and, on a Mac, from today's drashti-whisper.c).
  if (
    existsSync(out) &&
    existsSync(stamp) &&
    stillAsUnpacked(readFileSync(stamp, 'utf8'), outDir, build.sha256) &&
    (!sourceSha || readFileSync(stamp, 'utf8').includes(sourceSha))
  )
    return out;
  const name = target === 'win32-x64' ? 'whisper-bin-x64.zip' : 'whisper-xcframework.zip';
  const zip = await fetchZip(build.url, build.sha256, name);
  const tmp = join(cacheDir, `${target}-unpacked`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (target === 'win32-x64') {
    const from = unpackWindows(zip, tmp);
    for (const f of WINDOWS_FILES) copyFileSync(join(from, f), join(outDir, f));
  } else {
    if (process.platform !== 'darwin')
      throw new Error(`The Mac engine is compiled on a Mac (asked for ${target}).`);
    // The macOS slice only, its framework's links kept; then only this target's architecture in it.
    run('unzip', ['-o', '-q', zip, `${build.framework}/*`, '-d', tmp]);
    run('ditto', [join(tmp, build.framework), join(outDir, 'whisper.framework')]);
    const lib = join(outDir, 'whisper.framework', 'Versions', 'A', 'whisper');
    run('lipo', [lib, '-thin', build.arch, '-output', `${lib}.thin`]);
    renameSync(`${lib}.thin`, lib);
    run('clang', [
      '-std=c11',
      '-O2',
      '-Wall',
      '-Wextra',
      '-Wno-unused-parameter',
      '-arch',
      build.arch,
      '-mmacosx-version-min=13.3',
      '-F',
      outDir,
      '-framework',
      'whisper',
      '-Wl,-rpath,@executable_path',
      '-o',
      out,
      source,
    ]);
  }
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(
    stamp,
    `whisper.cpp ${WHISPER_VERSION} (build b5454) for ${target}\nfrom ${build.url}\nsha256 of the download ${build.sha256}\n${
      sourceSha
        ? `drashti-whisper compiled here from tools/whisper-server/drashti-whisper.c, sha256 ${sourceSha}\n`
        : ''
    }${digestLine(outDir)}\nMIT: see LICENSES/whisper/ in Drashti's repository.\n`,
  );
  console.log(`whisper.cpp ${WHISPER_VERSION} for ${target}: ${out}`);
  return out;
}

const thisTarget = `${process.platform}-${process.arch}`;

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--target');
  const targets = args.includes('--all')
    ? Object.keys(WHISPER_BUILDS)
    : [at >= 0 ? args[at + 1] : thisTarget];
  for (const target of targets) await fetchWhisper(target);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
