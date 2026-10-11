// Fetch the two programs YouTube in Import from a Link runs (Session 25c), for one platform or all:
//   node scripts/fetch-youtube-tools.mjs                 this computer's platform
//   node scripts/fetch-youtube-tools.mjs --target darwin-x64
//   node scripts/fetch-youtube-tools.mjs --all
// - yt-dlp, which downloads from YouTube (Drashti holds no YouTube downloading code of its own);
// - Deno, which yt-dlp starts to run YouTube's own player JavaScript, with no file, network,
//   environment or program access.
// One pinned release of each, from its publisher's GitHub releases, checked against the SHA-256 in the
// publisher's own list (yt-dlp's SHA2-256SUMS, whose GPG signature checks with yt-dlp's public.key;
// Deno's .sha256sum files) before anything is unpacked. Downloads are kept in ~/.cache/drashti/ and the
// programs are put in vendor/yt-dlp/<platform>-<arch>/ and vendor/deno/<platform>-<arch>/ (never
// committed). A newer yt-dlp or Deno comes with a Drashti release: Drashti never updates them itself.
// Licences: LICENSES/yt-dlp/ and LICENSES/deno/.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const YT_DLP_VERSION = '2026.08.19';
export const DENO_VERSION = '2.9.7';

const YT_DLP_RELEASE = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}`;
const DENO_RELEASE = `https://github.com/denoland/deno/releases/download/v${DENO_VERSION}`;

/**
 * yt-dlp as its unpacked build (a program and its _internal folder), not the one-file build: the one-file
 * build unpacks itself into the temporary folder at every start (8 to 10 s on a busy Mac) and leaves
 * that copy behind whenever it is stopped dead (Session 25c step 0). The Mac build is one universal
 * folder for Apple silicon and Intel.
 */
export const YT_DLP_BUILDS = {
  'darwin-arm64': {
    url: `${YT_DLP_RELEASE}/yt-dlp_macos.zip`,
    sha256: '07e54b0865303c864006925913bce2604f8ee8cc6f18699bac9c309f9328a6d8',
    exe: 'yt-dlp_macos',
  },
  'darwin-x64': {
    url: `${YT_DLP_RELEASE}/yt-dlp_macos.zip`,
    sha256: '07e54b0865303c864006925913bce2604f8ee8cc6f18699bac9c309f9328a6d8',
    exe: 'yt-dlp_macos',
  },
  'win32-x64': {
    url: `${YT_DLP_RELEASE}/yt-dlp_win.zip`,
    sha256: '30b4c14aafab6082becff7881e41b76df46dc43ea7633479410a91e29da492bf',
    exe: 'yt-dlp.exe',
  },
};

/** Deno, one program per platform; `binarySha256` is Deno's own sum of the program inside the zip. */
export const DENO_BUILDS = {
  'darwin-arm64': {
    url: `${DENO_RELEASE}/deno-aarch64-apple-darwin.zip`,
    sha256: '5cd46d6268f6f78f5d88bdc7159d20bd44cdaa4b3303474839f87ec6fe7ae25c',
    binarySha256: 'b73737579d5a84c160e3316487594783fa5c15f4e13252a6a07050b755317f1a',
    exe: 'deno',
  },
  'darwin-x64': {
    url: `${DENO_RELEASE}/deno-x86_64-apple-darwin.zip`,
    sha256: '95daaff11c116a52ad54785e7914c8e9c9cdcaba793c5ed929c74ca2d8e6259a',
    binarySha256: '325cf9c4b7156f4efd96ad22177a276a4bf4384147d4c9d9f40f9caee28e5719',
    exe: 'deno',
  },
  'win32-x64': {
    url: `${DENO_RELEASE}/deno-x86_64-pc-windows-msvc.zip`,
    sha256: 'a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238',
    binarySha256: 'e020f3e232bd16e33768dee528e5983349c962952051ced0a5d58ad42f5d9b33',
    exe: 'deno.exe',
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = join(homedir(), '.cache', 'drashti');

export const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** A file must be the one pinned: otherwise it is not used (and a test fails). */
export function verifyFile(file, sha256, what) {
  const got = sha256Of(file);
  if (got !== sha256) throw new Error(`${what} failed its check: sha256 ${got}, expected ${sha256}`);
}

async function download(url, to) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  const partial = `${to}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, to);
}

/** A pinned download, from the cache when it is there and still checks; checked either way. */
async function cached(dir, url, sha256, what) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, url.split('/').pop());
  if (!existsSync(file) || sha256Of(file) !== sha256) {
    console.log(`Downloading ${what}…`);
    rmSync(file, { force: true });
    await download(url, file);
  }
  try {
    verifyFile(file, sha256, what);
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  }
  return file;
}

/** Unpack a whole zip into a new folder (the system's own unzip or tar: nothing to install). */
function unpack(zip, into) {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const run = (command, args) => spawnSync(command, args, { stdio: 'inherit' }).status === 0;
  // Windows' own tar reads zip files (Git's GNU tar, often first on the PATH, does not).
  const windowsTar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
  const ok =
    process.platform === 'win32'
      ? run(windowsTar, ['-xf', zip, '-C', into])
      : run('unzip', ['-o', '-q', zip, '-d', into]);
  if (!ok) throw new Error(`Could not unpack ${zip}`);
}

/** Two files or folders hold the same bytes and names. */
function sameTree(a, b) {
  const sa = lstatSync(a);
  const sb = lstatSync(b);
  if (sa.isFile() && sb.isFile()) return sa.size === sb.size && readFileSync(a).equals(readFileSync(b));
  if (!sa.isDirectory() || !sb.isDirectory()) return false;
  const na = readdirSync(a).sort();
  const nb = readdirSync(b).sort();
  return na.length === nb.length && na.every((n, i) => n === nb[i] && sameTree(join(a, n), join(b, n)));
}

/**
 * The Mac zip holds yt-dlp's Python.framework without its symbolic links: Versions/Current, the
 * framework's own Python and Resources, and _internal/Python are each a full copy. macOS cannot sign a
 * framework like that ("bundle format is ambiguous"). Put the links back as PyInstaller makes them,
 * only after checking that each copy is byte for byte the same as the one it stands for. Returns
 * whether anything changed (false when the links are there already).
 */
export function restoreFrameworkLinks(internal) {
  const fw = join(internal, 'Python.framework');
  if (!existsSync(fw)) return false;
  const versions = join(fw, 'Versions');
  const current = join(versions, 'Current');
  if (lstatSync(current).isSymbolicLink()) return false;
  const named = readdirSync(versions).filter((v) => v !== 'Current');
  if (named.length !== 1)
    throw new Error(`Expected one Python version in ${versions}, found ${named.join(', ') || 'none'}`);
  const version = named[0];
  const real = join(versions, version);
  // [the copy, what it is a copy of, the link it becomes]
  const links = [
    [current, real, version],
    [join(fw, 'Python'), join(real, 'Python'), 'Versions/Current/Python'],
    [join(fw, 'Resources'), join(real, 'Resources'), 'Versions/Current/Resources'],
    [join(internal, 'Python'), join(real, 'Python'), `Python.framework/Versions/${version}/Python`],
  ];
  for (const [copy, original] of links)
    if (!existsSync(copy) || !sameTree(copy, original))
      throw new Error(`${copy} is not a copy of ${original}: not changing yt-dlp's folder`);
  for (const [copy, , link] of links) {
    rmSync(copy, { recursive: true, force: true });
    symlinkSync(link, copy);
  }
  return true;
}

/** Fetch (or reuse) one target's yt-dlp and put it in vendor/; returns the program's path. */
export async function fetchYtDlp(target) {
  const build = YT_DLP_BUILDS[target];
  if (!build) throw new Error(`No yt-dlp build is pinned for ${target}`);
  const outDir = join(root, 'vendor', 'yt-dlp', target);
  const out = join(outDir, build.exe);
  const stamp = join(outDir, 'SOURCE.txt');
  if (existsSync(out) && existsSync(stamp) && readFileSync(stamp, 'utf8').includes(build.sha256)) return out;
  const zip = await cached(
    join(cacheRoot, `yt-dlp-${YT_DLP_VERSION}`),
    build.url,
    build.sha256,
    `yt-dlp ${YT_DLP_VERSION} for ${target}`,
  );
  unpack(zip, outDir);
  if (!existsSync(out)) throw new Error(`yt-dlp's zip for ${target} holds no ${build.exe}`);
  if (target.startsWith('darwin')) {
    restoreFrameworkLinks(join(outDir, '_internal'));
    chmodSync(out, 0o755);
  }
  writeFileSync(
    stamp,
    `yt-dlp ${YT_DLP_VERSION} for ${target} (unpacked build)\nfrom ${build.url}\nsha256 of the download ${build.sha256}\nThe Unlicense; as built, GPL version 3 or later: see LICENSES/yt-dlp/ in Drashti's repository.\n`,
  );
  console.log(`yt-dlp ${YT_DLP_VERSION} for ${target}: ${out}`);
  return out;
}

/** Fetch (or reuse) one target's Deno and put it in vendor/; returns the program's path. */
export async function fetchDeno(target) {
  const build = DENO_BUILDS[target];
  if (!build) throw new Error(`No Deno build is pinned for ${target}`);
  const outDir = join(root, 'vendor', 'deno', target);
  const out = join(outDir, build.exe);
  const stamp = join(outDir, 'SOURCE.txt');
  if (existsSync(out) && existsSync(stamp) && readFileSync(stamp, 'utf8').includes(build.sha256)) return out;
  const zip = await cached(
    join(cacheRoot, `deno-${DENO_VERSION}`),
    build.url,
    build.sha256,
    `Deno ${DENO_VERSION} for ${target}`,
  );
  unpack(zip, outDir);
  verifyFile(out, build.binarySha256, `Deno ${DENO_VERSION}'s program for ${target}`);
  if (!build.exe.endsWith('.exe')) chmodSync(out, 0o755);
  writeFileSync(
    stamp,
    `Deno ${DENO_VERSION} for ${target}\nfrom ${build.url}\nsha256 of the download ${build.sha256}\nsha256 of the program ${build.binarySha256}\nMIT: see LICENSES/deno/ in Drashti's repository.\n`,
  );
  console.log(`Deno ${DENO_VERSION} for ${target}: ${out}`);
  return out;
}

const thisTarget = `${process.platform}-${process.arch}`;

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--target');
  const targets = args.includes('--all') ? Object.keys(YT_DLP_BUILDS) : [at >= 0 ? args[at + 1] : thisTarget];
  for (const target of targets) {
    await fetchYtDlp(target);
    await fetchDeno(target);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
