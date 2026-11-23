// Build Prepare translations' engine (alpha.22, a22-mt): drashti-translate, tools/translate/drashti-translate.cc on
// CTranslate2 4.9.1 (MIT, OpenNMT) and SentencePiece 0.2.1 (Apache-2.0, Google), for one platform:
//   node scripts/fetch-translate.mjs                    this computer's platform
//   node scripts/fetch-translate.mjs --target darwin-x64
// Neither project publishes a C++ program or library for these computers, so it is built here from their official
// source releases, each checked against its SHA-256 before anything is unpacked (the owner's "Yes, bundle all
// three", 23 Nov 2026): CTranslate2's release and the four sources its v4.9.1 tag pins for a CPU build (ruy with
// cpuinfo, cpu_features, spdlog), and SentencePiece's release (0.2.1: the newest one that carries its own
// protobuf-lite and absl; 0.2.2 and later need Abseil and Protobuf from elsewhere). CPU only: int8 and float
// matrix products by ruy (and Apple's Accelerate on a Mac), no OpenMP, no MKL, no GPU. One program, nothing else:
// - macOS (Apple silicon and Intel): compiled by the Mac's own clang (no cmake), file lists read from CTranslate2's
//   own CMakeLists so the build follows the release.
// - Windows x64: CMake and Visual Studio's compiler (CI's runner has both), the C++ runtime linked in (/MT).
// Downloads are kept in ~/.cache/drashti/translate-4.9.1/; the program goes in vendor/translate/<platform>-<arch>/
// (never committed), from where the installers take it. The models are never bundled: an admin imports the offline
// model pack (Help › Caption and Translation Models…). Licences: LICENSES/translation/.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { digestLine, stillAsUnpacked } from './tree-digest.mjs';

export const CTRANSLATE2_VERSION = '4.9.1';
export const SENTENCEPIECE_VERSION = '0.2.1';

/** Every source, pinned: where it is unpacked (inside CTranslate2's tree, as its submodules are), url, SHA-256. */
export const SOURCES = [
  {
    name: 'CTranslate2-4.9.1.tar.gz',
    url: 'https://github.com/OpenNMT/CTranslate2/archive/refs/tags/v4.9.1.tar.gz',
    sha256: '91e4b3b6625fb5319e43f909680f697f1e59c5623e07f70d4e86bff0e41aef78',
    into: 'ctranslate2',
  },
  {
    name: 'ruy-363f2522.tar.gz',
    url: 'https://github.com/google/ruy/archive/363f252289fb7a1fba1703d99196524698cb884d.tar.gz',
    sha256: '3c2181c9134896784d5d0494e2638c43127de4da2ddf81b3a64c06311fb17432',
    into: 'ctranslate2/third_party/ruy',
  },
  {
    name: 'cpuinfo-082deffc.tar.gz',
    url: 'https://github.com/pytorch/cpuinfo/archive/082deffc80ce517f81dc2f3aebe6ba671fcd09c9.tar.gz',
    sha256: '4379348ec3127b37e854a0a66f85ea1d3c606e5f3a6dce235dc9c69ce663c026',
    into: 'ctranslate2/third_party/ruy/third_party/cpuinfo',
  },
  {
    name: 'cpu_features-8a494eb1.tar.gz',
    url: 'https://github.com/google/cpu_features/archive/8a494eb1e158ec2050e5f699a504fbc9b896a43b.tar.gz',
    sha256: '9b2019dae7608630ab985129a5c3263fc788e4f82e26965a8d8c33b8c035802e',
    into: 'ctranslate2/third_party/cpu_features',
  },
  {
    name: 'spdlog-76fb40d9.tar.gz',
    url: 'https://github.com/gabime/spdlog/archive/76fb40d95455f249bd70824ecfcae7a8f0930fa3.tar.gz',
    sha256: '4530d53b86d45228a5b8982a8f4fe7d95d3ba8e1944858d3f663732c7e949cb7',
    into: 'ctranslate2/third_party/spdlog',
  },
  {
    name: 'sentencepiece-0.2.1.tar.gz',
    url: 'https://github.com/google/sentencepiece/releases/download/v0.2.1/sentencepiece-0.2.1.tar.gz',
    sha256: '8138cec27c2f2282f4a34d9a016e3374cd40e5c6e9cb335063db66a0a3b71fad',
    // The release is SentencePiece's Python source, its C++ project in sentencepiece/.
    into: 'sentencepiece-release',
  },
];

export const TARGETS = {
  'darwin-arm64': { exe: 'drashti-translate', arch: 'arm64' },
  'darwin-x64': { exe: 'drashti-translate', arch: 'x86_64' },
  'win32-x64': { exe: 'drashti-translate.exe', arch: 'x64' },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(homedir(), '.cache', 'drashti', `translate-${CTRANSLATE2_VERSION}`);
const helperSource = join(root, 'tools', 'translate', 'drashti-translate.cc');
const windowsProject = join(root, 'tools', 'translate', 'CMakeLists.txt');

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};

async function download(url, to) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  const partial = `${to}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, to);
}

/** Each pinned archive, downloaded once and checked. */
async function fetchSources() {
  mkdirSync(cacheDir, { recursive: true });
  for (const s of SOURCES) {
    const file = join(cacheDir, s.name);
    if (!existsSync(file) || sha256Of(file) !== s.sha256) {
      console.log(`Downloading ${s.name}…`);
      rmSync(file, { force: true });
      await download(s.url, file);
    }
    const got = sha256Of(file);
    if (got !== s.sha256) {
      rmSync(file, { force: true });
      throw new Error(`${s.name} failed its check: sha256 ${got}, expected ${s.sha256}`);
    }
  }
}

/** The checked archives unpacked into a fresh tree: CTranslate2 with its pinned submodules, and SentencePiece. */
function unpack(tree) {
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(tree, { recursive: true });
  // Windows' own tar (bsdtar) reads .tar.gz; so does a Mac's.
  const tar =
    process.platform === 'win32'
      ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  for (const s of SOURCES) {
    const at = join(tree, ...s.into.split('/'));
    rmSync(at, { recursive: true, force: true });
    mkdirSync(at, { recursive: true });
    run(tar, ['-xzf', join(cacheDir, s.name), '-C', at, '--strip-components', '1']);
  }
  return {
    ct2: join(tree, 'ctranslate2'),
    spm: join(tree, 'sentencepiece-release', 'sentencepiece'),
  };
}

// ------------------------------------------------------------------------------------------------ macOS (clang)

async function compileAll(jobs, objDir, archFlags, parallel) {
  mkdirSync(objDir, { recursive: true });
  let next = 0;
  const failed = [];
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const cc = j.src.endsWith('.c') ? 'clang' : 'clang++';
      const obj = join(objDir, `${j.name}.o`);
      const code = await new Promise((resolve) => {
        const p = spawn(cc, [...archFlags, '-O3', '-DNDEBUG', ...j.flags, '-c', j.src, '-o', obj], {
          stdio: ['ignore', 'ignore', 'inherit'],
        });
        p.on('close', resolve);
      });
      if (code !== 0) failed.push(j.src);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  if (failed.length) throw new Error(`drashti-translate: ${String(failed.length)} file(s) failed to compile`);
  return jobs.map((j) => join(objDir, `${j.name}.o`));
}

function ct2Sources(ct2) {
  const block = readFileSync(join(ct2, 'CMakeLists.txt'), 'utf8').match(/set\(SOURCES\n([\s\S]*?)\n\)/);
  if (!block) throw new Error('CTranslate2 SOURCES list not found');
  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((f) => join(ct2, f));
}

async function buildMac(target, { ct2, spm }, work, parallel) {
  const x86 = TARGETS[target].arch === 'x86_64';
  const archFlags = ['-arch', TARGETS[target].arch, '-mmacosx-version-min=12.0'];
  const ruy = join(ct2, 'third_party', 'ruy');
  const cpuinfo = join(ruy, 'third_party', 'cpuinfo');
  const cpuFeatures = join(ct2, 'third_party', 'cpu_features');
  const gen = join(work, 'gen');
  mkdirSync(gen, { recursive: true });
  const jobs = [];
  // cpuinfo, as its CMakeLists builds it for macOS.
  const cpuinfoFiles = [
    'src/init.c',
    'src/api.c',
    'src/cache.c',
    'src/mach/topology.c',
    'deps/clog/src/clog.c',
  ];
  if (x86)
    cpuinfoFiles.push(
      ...['init', 'info', 'vendor', 'uarch', 'name', 'topology', 'isa'].map((f) => `src/x86/${f}.c`),
      'src/x86/cache/init.c',
      'src/x86/cache/descriptor.c',
      'src/x86/cache/deterministic.c',
      'src/x86/mach/init.c',
    );
  else cpuinfoFiles.push('src/arm/uarch.c', 'src/arm/cache.c', 'src/arm/mach/init.c');
  const cpuinfoFlags = [
    '-std=c99',
    `-I${join(cpuinfo, 'include')}`,
    `-I${join(cpuinfo, 'src')}`,
    `-I${join(cpuinfo, 'deps', 'clog', 'include')}`,
    '-DCPUINFO_LOG_LEVEL=2',
  ];
  for (const f of cpuinfoFiles)
    jobs.push({
      src: join(cpuinfo, ...f.split('/')),
      name: `cpuinfo_${f.replaceAll('/', '_')}`,
      flags: cpuinfoFlags,
    });
  // ruy, every library source (its x86 kernels with their instruction sets).
  for (const f of readdirSync(join(ruy, 'ruy')).filter(
    (n) => n.endsWith('.cc') && !/(_test|^test_|benchmark|_main)/u.test(n),
  )) {
    const extra =
      x86 && /avx512/u.test(f)
        ? ['-mavx512f', '-mavx512vl', '-mavx512cd', '-mavx512bw', '-mavx512dq']
        : x86 && /avx2_fma/u.test(f)
          ? ['-mavx2', '-mfma']
          : x86 && /avx\.cc$/u.test(f)
            ? ['-mavx']
            : [];
    jobs.push({
      src: join(ruy, 'ruy', f),
      name: `ruy_${f}`,
      flags: ['-std=c++17', `-I${ruy}`, `-I${join(cpuinfo, 'include')}`, '-DRUY_HAVE_CPUINFO', ...extra],
    });
  }
  // cpu_features (x86 only), as its CMakeLists builds it.
  if (x86) {
    const cfFlags = [
      '-std=c99',
      `-I${join(cpuFeatures, 'include')}`,
      `-I${join(cpuFeatures, 'include', 'internal')}`,
      '-DSTACK_LINE_READER_BUFFER_SIZE=1024',
    ];
    for (const f of readdirSync(join(cpuFeatures, 'src')).filter(
      (n) => /^impl_.*\.c$/u.test(n) || ['filesystem.c', 'stack_line_reader.c', 'string_view.c'].includes(n),
    ))
      jobs.push({ src: join(cpuFeatures, 'src', f), name: `cpu_features_${f}`, flags: cfFlags });
  }
  // CTranslate2: its own source list, and its CPU kernels once more per instruction set (its CMake's dispatch).
  const ct2Defines = [
    '-DCT2_WITH_CPU_DISPATCH',
    '-DCT2_WITH_RUY',
    '-DCT2_WITH_ACCELERATE',
    x86 ? '-DCT2_X86_BUILD' : '-DCT2_ARM64_BUILD',
  ];
  const ct2Flags = [
    '-std=c++17',
    ...ct2Defines,
    `-I${join(ct2, 'include')}`,
    `-I${join(ct2, 'src')}`,
    `-I${join(ct2, 'third_party')}`,
    `-I${join(ct2, 'third_party', 'spdlog', 'include')}`,
    `-I${ruy}`,
    ...(x86 ? [`-I${join(cpuFeatures, 'include')}`] : []),
    '-w',
  ];
  for (const src of ct2Sources(ct2))
    jobs.push({ src, name: `ct2_${src.slice(ct2.length + 1).replaceAll(/[\\/]/gu, '_')}`, flags: ct2Flags });
  const isas = x86
    ? {
        avx: ['-mavx'],
        avx2: ['-mavx2', '-mfma'],
        avx512: ['-mavx512f', '-mavx512cd', '-mavx512vl', '-mavx512bw', '-mavx512dq'],
      }
    : { neon: ['-DUSE_NEON'] };
  for (const [isa, flags] of Object.entries(isas)) {
    const copy = join(gen, `kernels_${isa}.cc`);
    copyFileSync(join(ct2, 'src', 'cpu', 'kernels.cc'), copy);
    jobs.push({ src: copy, name: `ct2_kernels_${isa}`, flags: [...ct2Flags, ...flags] });
  }
  // SentencePiece with its own protobuf-lite and absl, as its CMakeLists' "internal" providers build it.
  writeFileSync(
    join(gen, 'config.h'),
    `#ifndef CONFIG_H_\n#define CONFIG_H_\n#define VERSION "${SENTENCEPIECE_VERSION}"\n#define PACKAGE "sentencepiece"\n#define PACKAGE_STRING "sentencepiece"\n#define INSTALL_DATADIR ""\n#endif\n`,
  );
  const spmSrc = join(spm, 'src');
  const spmThird = join(spm, 'third_party');
  const spmFlags = [
    '-std=c++17',
    '-pthread',
    '-DHAVE_PTHREAD=1',
    '-D_USE_INTERNAL_STRING_VIEW',
    '-D_FREEBSD',
    `-I${gen}`,
    `-I${spmSrc}`,
    `-I${join(spmSrc, 'builtin_pb')}`,
    `-I${join(spmThird, 'protobuf-lite')}`,
    `-I${spmThird}`,
    '-w',
  ];
  const spmFiles = [
    ...readdirSync(join(spmThird, 'protobuf-lite'))
      .filter((n) => n.endsWith('.cc'))
      .map((n) => join(spmThird, 'protobuf-lite', n)),
    ...[
      'bpe_model.cc',
      'char_model.cc',
      'error.cc',
      'filesystem.cc',
      'model_factory.cc',
      'model_interface.cc',
      'normalizer.cc',
      'sentencepiece_processor.cc',
      'unigram_model.cc',
      'util.cc',
      'word_model.cc',
      'builtin_pb/sentencepiece.pb.cc',
      'builtin_pb/sentencepiece_model.pb.cc',
    ].map((f) => join(spmSrc, ...f.split('/'))),
    join(spmThird, 'absl', 'flags', 'flag.cc'),
  ];
  for (const f of spmFiles)
    jobs.push({ src: f, name: `spm_${f.slice(spm.length + 1).replaceAll(/[\\/]/gu, '_')}`, flags: spmFlags });
  // The helper itself.
  jobs.push({
    src: helperSource,
    name: 'drashti-translate',
    flags: [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      ...ct2Defines,
      `-I${join(ct2, 'include')}`,
      `-I${spmSrc}`,
      `-I${spmThird}`,
      `-I${join(spmSrc, 'builtin_pb')}`,
      `-I${join(spmThird, 'protobuf-lite')}`,
      '-D_USE_INTERNAL_STRING_VIEW',
    ],
  });
  const objects = await compileAll(jobs, join(work, 'obj'), archFlags, parallel);
  const exe = join(work, TARGETS[target].exe);
  run('clang++', [
    ...archFlags,
    '-o',
    exe,
    ...objects,
    '-framework',
    'Accelerate',
    '-pthread',
    '-dead_strip',
  ]);
  return exe;
}

// ------------------------------------------------------------------------------------------- Windows (CMake)

function buildWindows({ ct2, spm }, work) {
  const build = join(work, 'cmake');
  run('cmake', [
    '-S',
    dirname(windowsProject),
    '-B',
    build,
    '-A',
    'x64',
    `-DCT2_SOURCE=${ct2}`,
    `-DSPM_SOURCE=${spm}`,
    `-DHELPER_SOURCE=${helperSource}`,
  ]);
  run('cmake', ['--build', build, '--config', 'Release', '--parallel', String(availableParallelism())]);
  return join(build, 'Release', TARGETS['win32-x64'].exe);
}

// ----------------------------------------------------------------------------------------------------- the build

/** Build (or reuse) one target's helper and put it in vendor/; returns its program's path. */
export async function fetchTranslate(target, { jobs = availableParallelism() } = {}) {
  const t = TARGETS[target];
  if (!t) throw new Error(`No translation engine is pinned for ${target}`);
  if (target.startsWith('darwin') && process.platform !== 'darwin')
    throw new Error(`The Mac engine is compiled on a Mac (asked for ${target}).`);
  if (target === 'win32-x64' && process.platform !== 'win32')
    throw new Error('The Windows engine is compiled on Windows.');
  const outDir = join(root, 'vendor', 'translate', target);
  const out = join(outDir, t.exe);
  const stamp = join(outDir, 'SOURCE.txt');
  const pins = createHash('sha256')
    .update(SOURCES.map((s) => `${s.url} ${s.sha256}`).join('\n'))
    .update(readFileSync(helperSource))
    // A changed build (this script, the Windows project) builds it again, as changed sources do.
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .update(readFileSync(windowsProject))
    .digest('hex');
  const recorded = existsSync(stamp) ? readFileSync(stamp, 'utf8') : '';
  if (existsSync(out) && stillAsUnpacked(recorded, outDir, pins)) return out;
  await fetchSources();
  const work = join(cacheDir, `${target}-build`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const trees = unpack(join(work, 'src'));
  const built =
    target === 'win32-x64' ? buildWindows(trees, work) : await buildMac(target, trees, work, jobs);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyFileSync(built, out);
  rmSync(work, { recursive: true, force: true });
  writeFileSync(
    stamp,
    `drashti-translate for ${target}: CTranslate2 ${CTRANSLATE2_VERSION} (with ruy, cpuinfo, cpu_features, spdlog as its tag pins) and SentencePiece ${SENTENCEPIECE_VERSION}\n${SOURCES.map((s) => `${s.url}\n  sha256 ${s.sha256}`).join('\n')}\nbuilt here from tools/translate/ (pins and sources ${pins})\n${digestLine(outDir)}\nSee LICENSES/translation/ in Drashti's repository.\n`,
  );
  console.log(`drashti-translate for ${target}: ${out} (${String(statSync(out).size)} bytes)`);
  return out;
}

const thisTarget = `${process.platform}-${process.arch}`;

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--target');
  const jobsAt = args.indexOf('--jobs');
  await fetchTranslate(at >= 0 ? args[at + 1] : thisTarget, {
    jobs: jobsAt >= 0 ? Number(args[jobsAt + 1]) : availableParallelism(),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
