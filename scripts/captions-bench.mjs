// The captions bench (CAP-CI-1; the owner, 24 Nov 2026: "Yes, all three"): caption AI's routes on CI's Windows
// runner held to two cores, through the app's own engines (src/main/speech/captions-bench.run.ts, its parts in
// captions-bench.ts), for the Performance workflow's `captions` input. Never part of the unit suite or an installer.
//   node scripts/captions-bench.mjs check   refuses a mistyped input (the workflow's first step)
//   node scripts/captions-bench.mjs run     the bench, now (the input's "alone")
//   node scripts/captions-bench.mjs start   the bench in the background, left running for the steps after it (the
//                                           input's "alongside": the Performance check runs meanwhile)
//   node scripts/captions-bench.mjs stop    tells a started bench the Performance check is over, waits for it to finish
//                                           its round, prints its table; its exit code is the bench's
// CAPTIONS_BENCH is the input (alone | alongside [:candidates]); CAPTIONS_BENCH_OUT the folder for
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

/** The candidates, as src/main/speech/captions-bench.ts's BENCH_CANDIDATES (a unit test keeps the two in step). */
const CANDIDATES = ['rc-gu', 'rc-hi', 'small-gu', 'small-hi', 'small-en'];

/**
 * Why a captions input is refused, as the bench's parseCaptionsInput refuses it, or null when it is good (review S2:
 * the workflow's first step, so a mistyped one never becomes an ordinary run after 842 MB of downloads). The input is
 * quoted as JSON, so it can never start a line of the log.
 */
export function checkCaptionsInput(input) {
  const text = input.trim();
  if (text === '') return null;
  const m = /^(alone|alongside)(?::(.*))?$/u.exec(text);
  if (!m)
    return `captions: ${JSON.stringify(text)} is not alone or alongside (then, after a colon, the candidates)`;
  if (m[2] === undefined) return null;
  const seen = new Set();
  for (const name of m[2].split(',').map((n) => n.trim())) {
    if (!CANDIDATES.includes(name))
      return `captions: unknown candidate ${JSON.stringify(name)} (known: ${CANDIDATES.join(', ')})`;
    if (seen.has(name)) return `captions: ${JSON.stringify(name)} is named twice`;
    seen.add(name);
  }
  return null;
}

/** How long `stop` waits for a started bench to finish its round (a round of every candidate is about 12 min). */
export const STOP_WAIT_MS = 25 * 60_000;

function outDir() {
  const out = process.env['CAPTIONS_BENCH_OUT'];
  if (!out) throw new Error('CAPTIONS_BENCH_OUT is not set: the folder for the bench’s tables');
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
  if (what === 'check') {
    const why = checkCaptionsInput(process.env['CAPTIONS_BENCH'] ?? '');
    if (why) throw new Error(`${why}. Nothing was installed or downloaded.`);
    console.log('The captions input is good.');
    return;
  }
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
      env: { ...process.env, CAPTIONS_BENCH_STOP: files.stop },
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
  throw new Error('usage: node scripts/captions-bench.mjs check | run | start | stop');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv[2] ?? '').catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
