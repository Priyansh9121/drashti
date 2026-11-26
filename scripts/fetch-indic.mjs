// Approved Microsoft ONNX Runtime release, native CPU C API only. One official package covers all three systems.
// Models are NEVER fetched or bundled here. The version, byte count and SHA-256 are fixed before extraction.
// Local worktrees link vendor to phase1: refuse that destination. Use --out to stage somewhere private instead.
//   node scripts/fetch-indic.mjs [--target <t>] [--out <dir>]   build Route C's helper for this computer (or <t>)
//   node scripts/fetch-indic.mjs --cache-key   print key=… and path=… for CI's cache (alpha.23, QA23-ORTCACHE-1):
//     the exact version, the runner's platform and the pinned SHA-256, and the one file kept (ORT_ARCHIVE).
// The package is kept at ORT_ARCHIVE between runs (CI's cache restores it there). A kept package is checked by size and
// SHA-256 before it is used, exactly as a download is; one that fails fails the build and is never used.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { buildIndic } from './build-indic.mjs';

export const ORT_RELEASE = Object.freeze({
  version: '1.23.2',
  url: 'https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.23.2/microsoft.ml.onnxruntime.1.23.2.nupkg',
  bytes: 123371574,
  sha256: '25fe172f7fcdf34f2b5b02c8b997f6b88abc282956849d4af4335af23d0c4e4a',
});
export const ORT_TARGETS = Object.freeze({
  'darwin-arm64': { rid: 'osx-arm64', files: ['libonnxruntime.dylib'], bytes: 35138784 },
  'darwin-x64': { rid: 'osx-x64', files: ['libonnxruntime.dylib'], bytes: 39742608 },
  'win32-x64': {
    rid: 'win-x64',
    files: ['onnxruntime.dll', 'onnxruntime_providers_shared.dll'],
    bytes: 14208104,
  },
});
export function verifyOrtArchive(file, expected = ORT_RELEASE) {
  if (statSync(file).size !== expected.bytes) throw new Error('ONNX Runtime archive size mismatch');
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== expected.sha256)
    throw new Error('ONNX Runtime archive SHA-256 mismatch');
}
/** Where the package is kept, relative to the checkout: the one file CI's cache keeps (QA23-ORTCACHE-1). */
const ORT_KEPT = `.scratch/onnxruntime-${ORT_RELEASE.version}`;
export const ORT_ARCHIVE = `${ORT_KEPT}/microsoft.ml.onnxruntime.${ORT_RELEASE.version}.nupkg`;
/** CI's cache key: the exact version, the runner's platform and the pinned SHA-256. */
export function ortCacheKey(platform = process.platform, arch = process.arch, release = ORT_RELEASE) {
  return `onnxruntime-${release.version}-${platform}-${arch}-${release.sha256}`;
}
/** The cache's key and the kept file's path, one line each, for $GITHUB_OUTPUT. */
export function ortCacheOutputs(platform = process.platform, arch = process.arch) {
  return `key=${ortCacheKey(platform, arch)}\npath=${ORT_ARCHIVE}\n`;
}
/**
 * The pinned package at `archive`: the one kept there (CI's cache, an earlier run) or, when there is none, downloaded
 * from the pinned address as before. Either way checked by size and SHA-256 before it is used; a download that fails
 * its check is removed, so only a checked package is ever kept.
 */
export async function ensureOrtArchive(
  archive = resolve(ORT_ARCHIVE),
  { release = ORT_RELEASE, fetch = globalThis.fetch, log = console.log } = {},
) {
  mkdirSync(dirname(archive), { recursive: true });
  const kept = existsSync(archive);
  if (!kept) {
    const partial = `${archive}.partial`;
    try {
      const response = await fetch(release.url, { redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('Official ONNX Runtime release unavailable');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
      verifyOrtArchive(partial, release);
      renameSync(partial, archive);
    } finally {
      rmSync(partial, { force: true });
    }
  }
  verifyOrtArchive(archive, release);
  const checked = `checked: ${String(release.bytes)} bytes, SHA-256 ${release.sha256}`;
  log(
    kept
      ? `ONNX Runtime ${release.version}: already here (CI's cache, or an earlier build), ${checked}`
      : `ONNX Runtime ${release.version}: downloaded from ${release.url}, ${checked}`,
  );
  return archive;
}
/** The staged libraries of a target, by their pinned size together (Microsoft's 1.23.2 files). */
export function verifyOrtFiles(dir, target) {
  const bytes = target.files.reduce((sum, file) => sum + statSync(join(dir, file)).size, 0);
  if (bytes !== target.bytes) throw new Error('ONNX Runtime library size mismatch');
}
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native staging failed: ${command}`);
};

export async function fetchIndic(target, output = join('vendor', 'indic', target)) {
  const selected = ORT_TARGETS[target];
  if (!selected) throw new Error('Unsupported ONNX Runtime target');
  // Do not mutate another worker's linked vendor or any symlink ancestor.
  for (let p = resolve(output); ; p = resolve(p, '..')) {
    if (existsSync(p) && lstatSync(p).isSymbolicLink())
      throw new Error('Refusing shared linked staging directory');
    if (resolve(p, '..') === p) break;
  }
  const archive = await ensureOrtArchive(resolve(ORT_ARCHIVE));
  const unpacked = join(dirname(archive), 'extracted');
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked);
  const members = [
    'LICENSE',
    'ThirdPartyNotices.txt',
    'build/native/include',
    `runtimes/${selected.rid}/native`,
  ];
  if (process.platform === 'win32') {
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    run(tar, ['-xf', archive, '-C', unpacked, ...members]);
  } else
    run('unzip', [
      '-q',
      archive,
      'LICENSE',
      'ThirdPartyNotices.txt',
      'build/native/include/*',
      `runtimes/${selected.rid}/native/*`,
      '-d',
      unpacked,
    ]);
  mkdirSync(output, { recursive: true });
  const native = join(unpacked, 'runtimes', selected.rid, 'native');
  for (const file of [...selected.files, 'LICENSE', 'ThirdPartyNotices.txt']) {
    copyFileSync(
      join(file === 'LICENSE' || file === 'ThirdPartyNotices.txt' ? unpacked : native, file),
      join(output, file),
    );
  }
  verifyOrtFiles(output, selected);
  const program = buildIndic({ ort: unpacked, output, target });
  if (target.startsWith('darwin')) {
    // Microsoft's dylib id is versioned; ship the library next to the helper under its actual load name.
    run('install_name_tool', [
      '-change',
      join(resolve(native), 'libonnxruntime.dylib'),
      '@executable_path/libonnxruntime.dylib',
      program,
    ]);
    // Remove the build-machine rpath; the packaged process needs only its own directory.
    run('install_name_tool', ['-delete_rpath', resolve(native), program]);
    run('codesign', ['--force', '--sign', '-', join(output, 'libonnxruntime.dylib')]);
    run('codesign', ['--force', '--sign', '-', program]);
  }
  writeFileSync(
    join(output, 'SOURCE.txt'),
    `${ORT_RELEASE.url}\nMIT; Microsoft Corporation\n${ORT_RELEASE.bytes} bytes\nSHA-256 ${ORT_RELEASE.sha256}\n`,
  );
  return program;
}
/** The command line: `--cache-key` prints CI's cache outputs and fetches nothing; otherwise it builds the helper. */
export async function main(args, { write = (text) => process.stdout.write(text), build = fetchIndic } = {}) {
  if (args.includes('--cache-key')) {
    write(ortCacheOutputs());
    return;
  }
  const target = args.includes('--target')
    ? args[args.indexOf('--target') + 1]
    : `${process.platform}-${process.arch}`;
  const output = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
  await build(target, output);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
