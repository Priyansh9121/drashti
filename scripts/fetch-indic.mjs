// Approved Microsoft ONNX Runtime release, native CPU C API only. One official package covers all three systems.
// Models are NEVER fetched or bundled here. The version, byte count and SHA-256 are fixed before extraction.
// Local worktrees link vendor to phase1: refuse that destination. Use --out to stage somewhere private instead.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  'win32-x64': { rid: 'win-x64', files: ['onnxruntime.dll', 'onnxruntime_providers_shared.dll'], bytes: 14208104 },
});
export function verifyOrtArchive(file, expected = ORT_RELEASE) {
  if (statSync(file).size !== expected.bytes) throw new Error('ONNX Runtime archive size mismatch');
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== expected.sha256) throw new Error('ONNX Runtime archive SHA-256 mismatch');
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
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error('Refusing shared linked staging directory');
    if (resolve(p, '..') === p) break;
  }
  const cache = resolve('.scratch', 'onnxruntime-1.23.2');
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, 'microsoft.ml.onnxruntime.1.23.2.nupkg');
  if (!existsSync(archive)) {
    const partial = `${archive}.partial`;
    try {
      const response = await fetch(ORT_RELEASE.url, { redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('Official ONNX Runtime release unavailable');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
      verifyOrtArchive(partial); renameSync(partial, archive);
    } finally { rmSync(partial, { force: true }); }
  }
  verifyOrtArchive(archive);
  const unpacked = join(cache, 'extracted');
  rmSync(unpacked, { recursive: true, force: true }); mkdirSync(unpacked);
  const members = ['LICENSE', 'ThirdPartyNotices.txt', 'build/native/include', `runtimes/${selected.rid}/native`];
  if (process.platform === 'win32') {
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    run(tar, ['-xf', archive, '-C', unpacked, ...members]);
  } else run('unzip', ['-q', archive, 'LICENSE', 'ThirdPartyNotices.txt', 'build/native/include/*', `runtimes/${selected.rid}/native/*`, '-d', unpacked]);
  mkdirSync(output, { recursive: true });
  const native = join(unpacked, 'runtimes', selected.rid, 'native');
  for (const file of [...selected.files, 'LICENSE', 'ThirdPartyNotices.txt']) {
    copyFileSync(join(file === 'LICENSE' || file === 'ThirdPartyNotices.txt' ? unpacked : native, file), join(output, file));
  }
  const program = buildIndic({ ort: unpacked, output, target });
  if (target.startsWith('darwin')) {
    // Microsoft's dylib id is versioned; ship the library next to the helper under its actual load name.
    run('install_name_tool', ['-change', '@rpath/libonnxruntime.1.23.2.dylib', '@executable_path/libonnxruntime.dylib', program]);
    // Remove the build-machine rpath; the packaged process needs only its own directory.
    run('install_name_tool', ['-delete_rpath', resolve(native), program]);
    run('codesign', ['--force', '--sign', '-', join(output, 'libonnxruntime.dylib')]);
    run('codesign', ['--force', '--sign', '-', program]);
  }
  writeFileSync(join(output, 'SOURCE.txt'), `${ORT_RELEASE.url}\nMIT; Microsoft Corporation\n${ORT_RELEASE.bytes} bytes\nSHA-256 ${ORT_RELEASE.sha256}\n`);
  return program;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : `${process.platform}-${process.arch}`;
  const output = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
  await fetchIndic(target, output);
}
