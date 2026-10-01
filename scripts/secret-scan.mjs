// Secret scan with gitleaks over the whole git history, every ref, findings redacted.
// The repository is public, so this runs before each push from this computer
// (.githooks/pre-push: a pushed secret is public before CI sees it) and as a CI job.
//
//   node scripts/secret-scan.mjs               scan this repository; exit 1 on any finding
//   node scripts/secret-scan.mjs --self-check  plant a made-up token in a throwaway repository
//                                              and check it is found and never printed
//
// gitleaks is downloaded once per computer, from one pinned release, and only used if its
// sha256 matches the one written below (from the release's checksums file).
import { spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '8.30.1';
/** sha256 of each release archive, from gitleaks_8.30.1_checksums.txt. */
const ARCHIVES = {
  'darwin-arm64': ['darwin_arm64.tar.gz', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
  'darwin-x64': ['darwin_x64.tar.gz', 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709'],
  'linux-arm64': ['linux_arm64.tar.gz', 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080'],
  'linux-x64': ['linux_x64.tar.gz', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
  'win32-arm64': ['windows_arm64.zip', 'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f'],
  'win32-x64': ['windows_x64.zip', 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'],
};

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';

function cacheDir() {
  const base =
    process.platform === 'win32'
      ? (process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'))
      : (process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'));
  return join(base, 'drashti', `gitleaks-${VERSION}`);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The pinned gitleaks, downloaded and checked the first time. */
async function gitleaks() {
  const archive = ARCHIVES[`${process.platform}-${process.arch}`];
  if (!archive) throw new Error(`No pinned gitleaks for ${process.platform}-${process.arch}.`);
  const [suffix, expected] = archive;
  const dir = cacheDir();
  const binary = join(dir, exe);
  const stamp = join(dir, 'archive.sha256');
  // The stamp records the checked archive the binary came from.
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === expected)
    return binary;
  const name = `gitleaks_${VERSION}_${suffix}`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${name}`;
  process.stderr.write(`Downloading gitleaks ${VERSION} (${suffix})…\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download gitleaks: HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected)
    throw new Error(`gitleaks download has the wrong checksum (${actual}); not using it.`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, bytes);
  // bsdtar (macOS, Windows 10+) and GNU tar both unpack these; Windows tar also reads .zip.
  const tar = spawnSync('tar', [suffix.endsWith('.zip') ? '-xf' : '-xzf', file, '-C', dir, exe], {
    stdio: 'inherit',
  });
  if (tar.status !== 0) throw new Error('Could not unpack gitleaks.');
  rmSync(file);
  if (process.platform !== 'win32') chmodSync(binary, 0o755);
  writeFileSync(stamp, `${expected}\n`);
  return binary;
}

/** Scan a repository's whole history (every branch and tag); gitleaks prints findings redacted. */
function scan(binary, dir, extra = {}) {
  const config = join(dir, '.gitleaks.toml');
  const args = ['git', '--redact', '--no-banner', '--exit-code', '1', '--log-opts=--all'];
  if (existsSync(config)) args.push('--config', config);
  args.push(dir);
  return spawnSync(binary, args, { encoding: 'utf8', ...extra });
}

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

/** A throwaway repository with a made-up GitHub token in one commit: it must be found, and never printed. */
function selfCheck(binary) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-secret-scan-'));
  try {
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    // Made up here, so no token-shaped text is ever written into this repository.
    const token = `ghp_${Array.from({ length: 36 }, () => letters[randomInt(letters.length)]).join('')}`;
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'self-check@example.invalid');
    git(dir, 'config', 'user.name', 'Self check');
    writeFileSync(join(dir, 'settings.env'), `GITHUB_TOKEN=${token}\n`);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'planted token');
    const r = scan(binary, dir);
    const output = `${r.stdout}${r.stderr}`;
    if (r.status !== 1) throw new Error(`The planted token was not found (gitleaks exit ${r.status}).`);
    if (output.includes(token.slice(4))) throw new Error('The finding was printed without redaction.');
    process.stdout.write('Self-check passed: the planted token was found, and printed redacted.\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const binary = await gitleaks();
  if (process.argv.includes('--self-check')) {
    selfCheck(binary);
  } else {
    const r = scan(binary, repo, { stdio: 'inherit' });
    if (r.status !== 0) {
      process.stderr.write(
        '\nSecret scan FAILED: gitleaks found something that looks like a secret (shown redacted above).\n' +
          'Remove it from the history before pushing; the repository is public.\n',
      );
      process.exit(1);
    }
  }
} catch (error) {
  process.stderr.write(
    `Secret scan could not run: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
