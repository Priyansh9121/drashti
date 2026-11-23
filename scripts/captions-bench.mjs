// The captions bench (CAP-CI-1; the owner, 24 Nov 2026: "Yes, all three"): caption AI's routes on CI's Windows
// runner held to two cores, through the app's own engines (src/main/speech/captions-bench.run.ts, its parts in
// captions-bench.ts), for the Performance workflow's `captions` input. Never part of the unit suite or an installer.
//   node scripts/captions-bench.mjs run     the bench, now (the input's "alone")
//   node scripts/captions-bench.mjs start   the bench in the background, left running for the steps after it (the
//                                           input's "alongside": the Performance check runs meanwhile)
//   node scripts/captions-bench.mjs stop    tells a started bench the Performance check is over, waits for it to finish
//                                           its round, prints its table; its exit code is the bench's
// DRASHTI_CAPTIONS_BENCH is the input (alone | alongside [:candidates]); DRASHTI_CAPTIONS_BENCH_OUT the folder for
// compare.md, results.json and bench.log (numbers only, never a word heard).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The files a bench leaves in its folder. */
export function benchFiles(out) {
  return {
    stop: join(out, 'stop'),
    exit: join(out, 'exit-code'),
    log: join(out, 'bench.log'),
    table: join(out, 'compare.md'),
  };
}

/** The command that runs the bench: Vitest inside Electron's Node, on its own config (never the unit suite's). */
export function benchCommand() {
  return [
    process.execPath,
    [join(root, 'scripts', 'vitest-electron.mjs'), 'run', '-c', 'vitest.captions-bench.config.mjs'],
  ];
}

/** How long `stop` waits for a started bench to finish its round (a round of every candidate is about 12 min). */
export const STOP_WAIT_MS = 25 * 60_000;

function outDir() {
  const out = process.env['DRASHTI_CAPTIONS_BENCH_OUT'];
  if (!out) throw new Error('DRASHTI_CAPTIONS_BENCH_OUT is not set: the folder for the bench’s tables');
  mkdirSync(out, { recursive: true });
  return resolve(out);
}

function runNow(extraEnv = {}) {
  const [command, args] = benchCommand();
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

async function main(what) {
  if (what === 'run') process.exit(runNow());
  const out = outDir();
  const files = benchFiles(out);
  if (what === 'start') {
    if (existsSync(files.exit) || existsSync(files.stop)) throw new Error(`a bench already ran in ${out}`);
    const log = openSync(files.log, 'a');
    // Detached, so it keeps running after this step; it notes its exit code when done.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'started'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, DRASHTI_CAPTIONS_BENCH_STOP: files.stop },
      windowsHide: true,
    });
    child.unref();
    console.log(`The captions bench started (process ${String(child.pid)}); its log: ${files.log}`);
    return;
  }
  if (what === 'started') {
    writeFileSync(files.exit, String(runNow()));
    return;
  }
  if (what === 'stop') {
    writeFileSync(files.stop, 'the Performance check is over\n');
    const until = Date.now() + STOP_WAIT_MS;
    while (!existsSync(files.exit) && Date.now() < until) await sleep(5_000);
    if (existsSync(files.log)) process.stdout.write(readFileSync(files.log, 'utf8'));
    if (!existsSync(files.exit)) {
      console.error(`The captions bench did not finish within ${String(STOP_WAIT_MS / 60_000)} minutes.`);
      process.exit(1);
    }
    process.exit(Number(readFileSync(files.exit, 'utf8').trim()) || 0);
  }
  throw new Error('usage: node scripts/captions-bench.mjs run | start | stop');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv[2] ?? '').catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
