// Build only against an already verified ONNX Runtime 1.23.2 extraction. Never downloads or installs anything.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vcvars } from './fetch-video-out.mjs';

export function buildIndic({ ort, output, target = `${process.platform}-${process.arch}` }) {
  if (!ort || !output) throw new Error('Give the verified ORT extraction and a private output directory');
  const rid = { 'darwin-arm64': 'osx-arm64', 'darwin-x64': 'osx-x64', 'win32-x64': 'win-x64' }[target];
  if (!rid) throw new Error(`Unsupported native target ${target}`);
  const include = join(ort, 'build', 'native', 'include');
  const lib = join(ort, 'runtimes', rid, 'native');
  const binary = join(resolve(output), target.startsWith('win32') ? 'ic-ctc.exe' : 'ic-ctc');
  if (!existsSync(join(include, 'onnxruntime_c_api.h'))) throw new Error('ORT headers missing');
  mkdirSync(output, { recursive: true });
  const source = fileURLToPath(new URL('../tools/indic-conformer/ic_ctc.c', import.meta.url));
  let command, args;
  if (target.startsWith('darwin') && process.platform === 'darwin') {
    command = 'clang';
    args = [
      '-O2',
      '-std=c11',
      '-mmacosx-version-min=13.4',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-arch',
      target.endsWith('arm64') ? 'arm64' : 'x86_64',
      '-I',
      include,
      source,
      '-L',
      lib,
      '-lonnxruntime',
      `-Wl,-rpath,${resolve(lib)}`,
      '-Wl,-rpath,@executable_path',
      '-o',
      binary,
    ];
  } else if (target === 'win32-x64' && process.platform === 'win32') {
    command = 'cl.exe';
    args = [
      '/nologo',
      '/O2',
      '/std:c11',
      '/MT',
      '/D_CRT_SECURE_NO_WARNINGS',
      `/I${include}`,
      source,
      `/Fe:${binary}`,
      `/Fo:${join(resolve(output), 'ic_ctc.obj')}`,
      '/link',
      `/LIBPATH:${lib}`,
      'onnxruntime.lib',
    ];
  } else throw new Error('Build each helper on its own system');
  let result;
  if (process.platform === 'win32') {
    // Same Visual Studio discovery as the existing native helper. All paths are locally generated, never model text.
    const quote = (value) => {
      if (/[\r\n"%]/u.test(value)) throw new Error('Unsafe build path');
      return `"${value}"`;
    };
    const script = join(resolve(output), 'build-indic.cmd');
    writeFileSync(
      script,
      `@echo off\r\ncall ${quote(vcvars())} >nul || exit /b 1\r\n${[command, ...args].map(quote).join(' ')}\r\n`,
    );
    result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', script], { stdio: 'inherit' });
  } else result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('IndicConformer native build failed');
  if (target.startsWith('darwin')) {
    const patched = spawnSync(
      'install_name_tool',
      ['-change', '@rpath/libonnxruntime.1.23.2.dylib', join(resolve(lib), 'libonnxruntime.dylib'), binary],
      { stdio: 'inherit' },
    );
    if (patched.status !== 0) throw new Error('Native library path could not be set');
    const signed = spawnSync('codesign', ['--force', '--sign', '-', binary], { stdio: 'inherit' });
    if (signed.status !== 0) throw new Error('Native helper could not be signed');
  }
  return binary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    buildIndic({
      ort: process.env.DRASHTI_ORT_ROOT,
      output: process.env.DRASHTI_INDIC_OUT,
      target: process.argv[2],
    }),
  );
}
