// Video out (x30, prompt 11; the owner's "Go, all A", 19 Nov 2026): Drashti's small programs that send the stream's
// picture to other apps on this computer, built here from pinned sources, for one platform:
//   node scripts/fetch-video-out.mjs                      this computer's platform
//   node scripts/fetch-video-out.mjs --target darwin-x64  (a Mac target is built on a Mac, Windows' on Windows)
// - macOS (Apple silicon and Intel): drashti-video-out, a Syphon server (Syphon-Framework, BSD 3-clause), from
//   tools/video-out/drashti-video-out-mac.m with Syphon's own sources compiled in by the Mac's clang.
// - Windows x64: drashti-video-out.exe, a Spout sender (Spout2's SpoutDX, BSD 2-clause), from
//   tools/video-out/drashti-video-out-win.cpp with SpoutDX's sources compiled in by Visual Studio's compiler.
// Beside each, drashti-video-out-receiver: the end-to-end tests' receiver (a Syphon client, a Spout receiver), never
// packaged (electron-builder.yml takes the sender alone).
// Every source file is downloaded at its pinned commit and checked against its own SHA-256 before anything is
// compiled; one that does not match stops the build. They are kept in ~/.cache/drashti/video-out/, never committed; the
// programs go in vendor/video-out/<platform>-<arch>/ (never committed either), from where the installers take the
// sender. Licences: LICENSES/syphon/ and LICENSES/spout/, the pinned commits' own licence files.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestLine } from './tree-digest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(homedir(), '.cache', 'drashti', 'video-out');

/** Syphon-Framework at one commit (21 Sep 2026): its licence, the prefix header, the sources compiled and every header. */
export const SYPHON = {
  repo: 'Syphon/Syphon-Framework',
  commit: 'f4761677a45b8034a3c2069ec0f3d2553da81fba',
  licence: 'License.txt',
  sources: [
    'SyphonServerBase.m',
    'SyphonServerConnectionManager.m',
    'SyphonPrivate.m',
    'SyphonMessaging.m',
    'SyphonMessageSender.m',
    'SyphonMessageReceiver.m',
    'SyphonCFMessageSender.m',
    'SyphonCFMessageReceiver.m',
    'SyphonMessageQueue.m',
    'SyphonDispatch.c',
    'SyphonServerDirectory.m',
    'SyphonClientBase.m',
    'SyphonClientConnectionManager.m',
  ],
  files: {
    'License.txt': '4c1c8c6b54732b990dd6cc549672c9b17dd541b4f2be0b3d4233f9d0f014ac49',
    'Syphon_Prefix.pch': 'aca907eda598147f59e14596095199bdcdfe6409f1b266b8cf0a2b335ff54655',
    'SyphonServerBase.m': 'd6b1a12a3bf8ffb1b9faf56f589948f5bf4d60b612cf2c4e81e54ba5fd16938a',
    'SyphonServerConnectionManager.m': 'ded4895d10106d22ef56adf3303eb300c2428ac2e3f6b10dd3af969e85274113',
    'SyphonPrivate.m': 'a2bc9e289acf03bc9479724156d8614995735ddd0a8562d05de828c3ceaab473',
    'SyphonMessaging.m': 'b0893cd72cded9e5bbc5969dc8f6cd9d3750342fe01890e0fbdd14f7f8c51e7f',
    'SyphonMessageSender.m': 'ef6ba8797bc54b566ff5d0ac97c8b642fe6af1944d9a0a2b8b894a9f97d0506b',
    'SyphonMessageReceiver.m': 'f1514ceaf83ecc00fd4f67e73d655e802d06444c3451476cb95b39fb5e55f24a',
    'SyphonCFMessageSender.m': 'bf1bfcf66b99d17f21c7458d2d9d8e5899a175f93a7625fa56fad4b0acb9d590',
    'SyphonCFMessageReceiver.m': '8500624d438ba33f0eeb1d396aec17163119765e966fd2f22173f310da1c395f',
    'SyphonMessageQueue.m': '06168e60fb279b9dcf1b9cec2f43bbabadbbc4fe4d95fd8970bb2981a5676b72',
    'SyphonDispatch.c': '115694f45910847b585a95e39a0dbf49a72a89a1b49bc1b04fa9388cc1d13955',
    'SyphonServerDirectory.m': '2308bd7caeb4a8aaaa795918596e14723fca9b352df11e9fab908c3f4fbad3e9',
    'SyphonClientBase.m': '78ff560f3893050d3ebb02608f3c6cd9b5cc3eb250ab81cd4817086bce9666eb',
    'SyphonClientConnectionManager.m': 'bc8bcbf075af0452287501bbd7fdc76ba76cd8bd43a3fcd41d8c8d7cd40ce87c',
    'Syphon.h': 'badf119b6cf4cc659c1ef07f87c4c68beedbe9e740181f525640559c6f0975d6',
    'SyphonCFMessageReceiver.h': '49a9aea0303dd291d8e85d20204f5272d95f856b31bf77e7e5564465497473a3',
    'SyphonCFMessageSender.h': '4353f0606c5de5458deef881021a28358b8a89c3fbce77429e72ab3e9402a47f',
    'SyphonCGL.h': 'e67bd6fc98accfe004175ba84dfd9c190d5909dfb99232399c8ec43474e6e350',
    'SyphonClient.h': '264f1c4932836370d909da6f231ff57a0d118251fbfe79b968247f5975df7118',
    'SyphonClientBase.h': 'cd02d465eef873a24ef718c1897fb1b8751a81ea1f6be6e35f698d5e16f21968',
    'SyphonClientConnectionManager.h': 'd537b7db45eec8696200e32c15df51e4394c2a838e9fa45cde04487e7ecf221b',
    'SyphonDispatch.h': '72a55615f88620c1ba4a3b30315963c384df1c353a29eb970d0f886c2788b23a',
    'SyphonGLShader.h': 'b6f6707c119c8676ed7d41e3b6cbd05e694724b0eeb4d6a4ad38322af818823e',
    'SyphonGLVertices.h': 'bf7220de2302f1351fd99a40a3741e240bd63184a493281560fe387a45a422e2',
    'SyphonIOSurfaceImageCore.h': '4d2850b6dd662b5e5ef5d54b3c03473016c318f1e6dde710a727d3fe2265570e',
    'SyphonIOSurfaceImageLegacy.h': '0556840b01eaf2569b19caf0623892448da854d6c70d356006108b07adefc559',
    'SyphonImage.h': '55fbf1a5b8c3c219bec5537d4abbd059af54341c324cd21f2aa8d527420b5263',
    'SyphonImageBase.h': '198fc99fada2b911e990ee9ef00febb160897d29ba68c59dd342b89b278c6413',
    'SyphonMessageQueue.h': '1861c52a4fea35f5e9c087ecfa4c422b559592ee9baa2ecd6329893d8da6e382',
    'SyphonMessageReceiver.h': '5456a5a989905b7cfd6f86a44492a4cacd971966eee969c4d571031b52fa05a3',
    'SyphonMessageSender.h': '6d4ca486766e450b8a1e72752f2318c49b732e567d3fca8ffcbaf706942323e1',
    'SyphonMessaging.h': 'b431ec14abd8f2c542d06b30e5dd86d3fa67beabe11c9c7805061d27bae17167',
    'SyphonMetalClient.h': '2a4f45dedc6f3d052b044ab22768697e1487d4afc926a993cba3db0e20afed26',
    'SyphonMetalServer.h': '2d06b90b7116cbcc7430b9e34d4958d5adb9afaf868567b1f5999675002be2b4',
    'SyphonOpenGLClient.h': '63d613d14a607509e019df3c0b7907674d29277bfa2aa3ec604ae1a71f996750',
    'SyphonOpenGLFunctions.h': '8f805cd15776099ac21e58546b35806ec6c7880b9e053fc3a04bd0911767e821',
    'SyphonOpenGLImage.h': 'ac5c8b839b052751523ce5acac0d6882d26cac1089c6c5bdc58300fecc144a7a',
    'SyphonOpenGLServer.h': 'dfb5e25433d0f90fdf393bf47223e7f544aa133957487181b88b76382b4ba80d',
    'SyphonPrivate.h': 'b04d3bd4d75e50ec249c1a37d229421c5dc99ed53c1985f2dafba9cf20132310',
    'SyphonServer.h': '6e74d907583167344e73d23adbfea8ac5a292a9cd92d6b930cf5cf84c243043f',
    'SyphonServerBase.h': 'e081678221d32c2f695213362cfcb8f31be3887a9d6423c7a6a9747e6139c7a3',
    'SyphonServerConnectionManager.h': 'ee53fb067ec11a5825151f06376db7e0465dece5a4bc405c367258852faf9282',
    'SyphonServerDirectory.h': 'e4d83273244066707e502147863f6b8136cb27d1178e317f5bec46703d2fbc8f',
    'SyphonServerGLShader.h': '64ee295dbc8bd0afc39a68b587d312b200d031ee628a77bd660261a96381e33c',
    'SyphonServerGLVertices.h': '792c067f3f457ebfa81bf2fbb5e95e07ba2a01f77a64d9532247b0233825381b',
    'SyphonServerMetalTypes.h': 'c04dccaf2b4ceaf251c0901de56b253b5fb6accaf514421ec0abb5d1c73d6c61',
    'SyphonServerRendererCoreGL.h': 'a9cede357f9c5ed94ec2afdd3e3fad64b9082e4eb8a51e4e4678276dad7f6d60',
    'SyphonServerRendererGL.h': '0458e6f17cb8ecad9196734b7a1075b38377c0173fe66a0fd6d1a36313bf3fb9',
    'SyphonServerRendererLegacyGL.h': '55233250308c2215a17c97abf3ca9f2c875aadb60f3bc0d99b1c223a4100b8d1',
    'SyphonServerRendererMetal.h': '023a01455e0c94a0c9135f95727b662ad0974421cbe5cbc757c644eea4179cf3',
    'SyphonSubclassing.h': '0b9c6ef88f1e0991fc44272151798a3a1c62c479f6d126b50979ad151982ab07',
  },
};

/** Spout2 at its release 2.007.018 (10 Oct 2026): its licence, and SpoutDX with the parts of SpoutGL it is built with. */
export const SPOUT = {
  repo: 'leadedge/Spout2',
  commit: '6b68a5b4fdeca6130b851e5f9366467a844860e5',
  licence: 'LICENSE',
  sources: [
    'SPOUTSDK/SpoutDirectX/SpoutDX/SpoutDX.cpp',
    'SPOUTSDK/SpoutGL/SpoutCopy.cpp',
    'SPOUTSDK/SpoutGL/SpoutDirectX.cpp',
    'SPOUTSDK/SpoutGL/SpoutFrameCount.cpp',
    'SPOUTSDK/SpoutGL/SpoutSenderNames.cpp',
    'SPOUTSDK/SpoutGL/SpoutSharedMemory.cpp',
    'SPOUTSDK/SpoutGL/SpoutUtils.cpp',
  ],
  files: {
    LICENSE: '124f739384955b3b87ca556f486be770299bf2dda7d5a7281347f035f511a8f4',
    'SPOUTSDK/SpoutDirectX/SpoutDX/SpoutDX.cpp':
      '2613c5285b46963f7715923b3ffc0b85df616ac6e621c49f885658cb4f88684f',
    'SPOUTSDK/SpoutDirectX/SpoutDX/SpoutDX.h':
      '7980c73ce81cae1ebd8736881e42a1b2c48aeb74aa81e5b90b8dad1e90d145b6',
    'SPOUTSDK/SpoutGL/SpoutCommon.h': '8f754d98f33ebf8da869c91c6818303a8c8ba03f956164f249ddcfcbb34f50a0',
    'SPOUTSDK/SpoutGL/SpoutCopy.cpp': 'e83684d1890002095a9d17cd1007f8ff0d29298e87bbb152a179847232890c95',
    'SPOUTSDK/SpoutGL/SpoutCopy.h': '7ff811e5d4414cb3ec290eece991a530001658f72c1854363a38af7ac05deb44',
    'SPOUTSDK/SpoutGL/SpoutDirectX.cpp': '014c6af04ea0870e9fdedcb6815be9470d5c93fefe94f320805fc461c3228e84',
    'SPOUTSDK/SpoutGL/SpoutDirectX.h': '15e0a64f6ddfc0f01644d20e9f6db139d5d2c9f7dc0684310d6a51ab48264bbd',
    'SPOUTSDK/SpoutGL/SpoutFrameCount.cpp':
      '3f6d1278461f8def8bfec647bf07d7e750e6adbbd67b3ea8d1ee9cf2745b7bf4',
    'SPOUTSDK/SpoutGL/SpoutFrameCount.h': '11222877fa02f0201d25e008f868ab6d106435ffbf8ec764045a0d10c12c3639',
    'SPOUTSDK/SpoutGL/SpoutSenderNames.cpp':
      '1c07cd5121f06813898f9f73183df65ba274b975d5b23c4bd5b2b871de45c7d2',
    'SPOUTSDK/SpoutGL/SpoutSenderNames.h': '13d2e70ee589ea1c651bbf4d7b18047b6f5ded7344ef9fc007dc1cd68bb22508',
    'SPOUTSDK/SpoutGL/SpoutSharedMemory.cpp':
      'b6f0cbae6967f78751659c38555d978954addd91587cb5bd0f443d7a2064a6b8',
    'SPOUTSDK/SpoutGL/SpoutSharedMemory.h':
      '8dd2871eccac7fbbd148791bbc30a29880f9eb334bce9b3ed639d1730e6a2807',
    'SPOUTSDK/SpoutGL/SpoutUtils.cpp': '70a1b02a38e2b39fa17a83e2dc653c05a82907fd57859ca78003cf55cea9f4ef',
    'SPOUTSDK/SpoutGL/SpoutUtils.h': 'efd0a3e835034c18ecfcb3d92a4c850a9fb1345c3791696d12206893aac4f66d',
  },
};

/** Drashti's own sources for the programs (never anything fetched). */
export const OWN_SOURCES = {
  darwin: [
    'tools/video-out/frame-input.h',
    'tools/video-out/drashti-video-out-mac.m',
    'tools/video-out/drashti-video-out-receiver-mac.m',
  ],
  win32: [
    'tools/video-out/frame-input.h',
    'tools/video-out/drashti-video-out-win.cpp',
    'tools/video-out/drashti-video-out-receiver-win.cpp',
  ],
};

/** The programs' names on each platform: the sender (packaged) and the tests' receiver (never packaged). */
export const PROGRAMS = {
  darwin: { sender: 'drashti-video-out', receiver: 'drashti-video-out-receiver' },
  win32: { sender: 'drashti-video-out.exe', receiver: 'drashti-video-out-receiver.exe' },
};

const TARGETS = { 'darwin-arm64': 'arm64', 'darwin-x64': 'x86_64', 'win32-x64': 'x64' };

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${String(r.status)})`);
};

async function download(url) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`${String(response.status)} ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`Download failed: ${last instanceof Error ? last.message : String(last)}`);
}

/** Every pinned file of one source, each checked against its SHA-256; returns the folder holding them. */
async function fetchPinned(source) {
  const dir = join(cacheDir, `${source.repo.replace('/', '-')}-${source.commit}`);
  for (const [path, sha256] of Object.entries(source.files)) {
    const file = join(dir, path);
    if (existsSync(file) && sha256Of(file) === sha256) continue;
    const bytes = await download(`https://raw.githubusercontent.com/${source.repo}/${source.commit}/${path}`);
    const got = createHash('sha256').update(bytes).digest('hex');
    if (got !== sha256)
      throw new Error(
        `${source.repo}'s ${path} at ${source.commit} failed its check: sha256 ${got}, expected ${sha256}`,
      );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  return dir;
}

/** What the folder's SOURCE.txt records: every pinned file and own source by its SHA-256 (then the folder's digest). */
function stampFor(target, source) {
  const own = OWN_SOURCES[target.split('-')[0]].map((f) => `${f} ${sha256Of(join(root, f))}`);
  return [
    `Drashti's video out programs for ${target}, built here`,
    `from ${source.repo} at ${source.commit} (https://github.com/${source.repo}), each file checked:`,
    ...Object.entries(source.files).map(([path, sha256]) => `  ${path} ${sha256}`),
    "and Drashti's own:",
    ...own.map((line) => `  ${line}`),
  ].join('\n');
}

function buildMac(target, from, outDir) {
  if (process.platform !== 'darwin')
    throw new Error(`The Mac programs are compiled on a Mac (asked for ${target}).`);
  const arch = TARGETS[target];
  const work = join(cacheDir, `${target}-build`);
  rmSync(work, { recursive: true, force: true });
  // Syphon's headers as a framework's: <Syphon/...>.
  mkdirSync(join(work, 'include', 'Syphon'), { recursive: true });
  for (const path of Object.keys(SYPHON.files))
    if (path.endsWith('.h')) copyFileSync(join(from, path), join(work, 'include', 'Syphon', path));
  const flags = [
    '-fobjc-arc',
    '-O2',
    '-arch',
    arch,
    '-mmacosx-version-min=13.0',
    '-Wno-deprecated-declarations',
    '-I',
    join(work, 'include'),
    '-I',
    from,
    '-I',
    join(root, 'tools', 'video-out'),
    '-include',
    join(from, 'Syphon_Prefix.pch'),
  ];
  const syphon = SYPHON.sources.map((f) => join(from, f));
  const frameworks = ['Foundation', 'Cocoa', 'IOSurface', 'Accelerate'].flatMap((f) => ['-framework', f]);
  const { sender, receiver } = PROGRAMS.darwin;
  run('clang', [
    ...flags,
    ...syphon,
    join(root, 'tools', 'video-out', 'drashti-video-out-mac.m'),
    ...frameworks,
    '-o',
    join(outDir, sender),
  ]);
  run('clang', [
    ...flags,
    ...syphon,
    join(root, 'tools', 'video-out', 'drashti-video-out-receiver-mac.m'),
    ...frameworks,
    '-o',
    join(outDir, receiver),
  ]);
  rmSync(work, { recursive: true, force: true });
}

/** Visual Studio's x64 build environment (vcvars64.bat), found by vswhere. */
export function vcvars() {
  const vswhere = join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  const found = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
      '-utf8',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const installation = found.status === 0 ? found.stdout.trim() : '';
  const bat = installation ? join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat') : '';
  if (!bat || !existsSync(bat))
    throw new Error("Building video out on Windows needs Visual Studio's C++ x64 tools.");
  return bat;
}

function buildWindows(target, from, outDir) {
  if (process.platform !== 'win32')
    throw new Error(`The Windows programs are compiled on Windows (asked for ${target}).`);
  const work = join(cacheDir, `${target}-build`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const includes = [
    join(from, 'SPOUTSDK', 'SpoutDirectX', 'SpoutDX'),
    join(from, 'SPOUTSDK', 'SpoutGL'),
    join(root, 'tools', 'video-out'),
  ];
  const cl = [
    'cl',
    '/nologo',
    '/O2',
    '/MT',
    '/EHsc',
    '/std:c++17',
    '/DNDEBUG',
    '/D_CRT_SECURE_NO_WARNINGS',
    ...includes.map((i) => `/I"${i}"`),
  ].join(' ');
  const libs =
    'd3d11.lib dxgi.lib winmm.lib psapi.lib shell32.lib advapi32.lib version.lib comctl32.lib user32.lib gdi32.lib ole32.lib opengl32.lib';
  const spout = SPOUT.sources.map((f) => `"${join(from, ...f.split('/'))}"`).join(' ');
  const { sender, receiver } = PROGRAMS.win32;
  const program = (name, own) =>
    `${cl} /Fo"${work}\\\\" ${spout} "${join(root, 'tools', 'video-out', own)}" /Fe"${join(outDir, name)}" /link ${libs} || exit /b 1`;
  const script = join(work, 'build.cmd');
  writeFileSync(
    script,
    [
      '@echo off',
      `call "${vcvars()}" >nul || exit /b 1`,
      program(sender, 'drashti-video-out-win.cpp'),
      program(receiver, 'drashti-video-out-receiver-win.cpp'),
      '',
    ].join('\r\n'),
  );
  run(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/c', script]);
  rmSync(work, { recursive: true, force: true });
}

/** Build (or reuse) one target's programs in vendor/video-out/<target>/; returns the sender's path. */
export async function fetchVideoOut(target) {
  if (!TARGETS[target]) throw new Error(`No video out is built for ${target}`);
  const platform = target.split('-')[0];
  const source = platform === 'darwin' ? SYPHON : SPOUT;
  const outDir = join(root, 'vendor', 'video-out', target);
  const out = join(outDir, PROGRAMS[platform].sender);
  const stampFile = join(outDir, 'SOURCE.txt');
  const stamp = stampFor(target, source);
  // Reused only while it is still what was built, from today's pins and sources.
  const recorded = existsSync(stampFile) ? readFileSync(stampFile, 'utf8') : '';
  if (existsSync(out) && recorded.startsWith(stamp) && recorded.includes(digestLine(outDir))) return out;
  const from = await fetchPinned(source);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (platform === 'darwin') buildMac(target, from, outDir);
  else buildWindows(target, from, outDir);
  writeFileSync(
    stampFile,
    `${stamp}\n${digestLine(outDir)}\nSee LICENSES/${platform === 'darwin' ? 'syphon' : 'spout'}/ in Drashti's repository.\n`,
  );
  console.log(`Video out for ${target}: ${out}`);
  return out;
}

const thisTarget = `${process.platform}-${process.arch}`;

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--target');
  await fetchVideoOut(at >= 0 ? args[at + 1] : thisTarget);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
