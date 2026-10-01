// The restart after Restore Library…, for real, on this OS. Starts Drashti with
// DRASHTI_SELFTEST=restore-relaunch (src/main/relaunch-selftest.ts) in a throwaway data
// folder: it backs up, asks for a restore and restarts with app.relaunch(); this script
// waits for the copy that starts again to write its result. Playwright cannot do this
// (a relaunched copy waits for Playwright forever).
//
//   node scripts/check-relaunch.mjs             the built app in out/ (pnpm build first)
//   node scripts/check-relaunch.mjs --packaged  the unpacked app electron-builder made in release/
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, removeTempRoot } from './temp-root.mjs';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const TIMEOUT_MS = 120_000;

/** The unpacked app electron-builder left in release/<version>/. */
function packagedBinary() {
  const release = join(app, 'release');
  for (const version of existsSync(release) ? readdirSync(release) : []) {
    for (const candidate of [
      join(release, version, 'mac-arm64', 'Drashti.app', 'Contents', 'MacOS', 'Drashti'),
      join(release, version, 'mac', 'Drashti.app', 'Contents', 'MacOS', 'Drashti'),
      join(release, version, 'win-unpacked', 'Drashti.exe'),
      join(release, version, 'win-arm64-unpacked', 'Drashti.exe'),
    ])
      if (existsSync(candidate)) return candidate;
  }
  throw new Error('No unpacked app in release/: run pnpm package (or package:dir) first.');
}

// Both copies carry this argument (app.relaunch() reuses the arguments), so a copy that
// never finishes can be found and stopped.
const token = `--drashti-relaunch-check=${randomUUID()}`;
const [binary, args] = packaged
  ? [packagedBinary(), [token]]
  : [createRequire(import.meta.url)('electron'), ['.', token]];

function stopLeftovers() {
  if (process.platform === 'win32') {
    spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${token}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    ]);
  } else {
    spawnSync('pkill', ['-f', token]);
  }
}

const root = makeTempRoot();
const userData = join(root, 'data');
const workDir = join(root, 'work');
mkdirSync(workDir);
const env = { ...process.env };
delete env['ELECTRON_RUN_AS_NODE'];
Object.assign(env, {
  DRASHTI_USER_DATA_DIR: userData,
  DRASHTI_SELFTEST: 'restore-relaunch',
  DRASHTI_SELFTEST_DIR: workDir,
});

const resultFile = join(workDir, 'result.json');
let code = 1;
try {
  process.stdout.write(`Starting ${packaged ? 'the packaged app' : 'the built app (out/)'}…\n`);
  const first = spawn(binary, args, { cwd: app, env, stdio: 'inherit' });
  const firstExit = await new Promise((resolve) => {
    first.once('exit', (exitCode, signal) => {
      resolve(exitCode ?? signal);
    });
  });
  process.stdout.write(
    `The first copy quit (${String(firstExit)}); waiting for the one app.relaunch() starts…\n`,
  );
  const deadline = Date.now() + TIMEOUT_MS;
  while (!existsSync(resultFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  if (!existsSync(resultFile)) {
    process.stdout.write(
      `FAIL  no result within ${TIMEOUT_MS / 1000} s: Drashti did not start again, or did not finish\n`,
    );
  } else {
    // Written in one go, but give the copy a moment to finish writing and quit.
    await new Promise((r) => setTimeout(r, 500));
    const result = JSON.parse(readFileSync(resultFile, 'utf8'));
    for (const c of result.checks)
      process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} (${c.detail})\n`);
    process.stdout.write(
      result.passed ? 'Restart after a restore: passed\n' : 'Restart after a restore: FAILED\n',
    );
    if (result.passed) code = 0;
  }
} finally {
  stopLeftovers();
  // A copy that is just quitting can hold its files for a moment (Windows).
  await new Promise((r) => setTimeout(r, 1000));
  removeTempRoot(root);
}
process.exit(code);
