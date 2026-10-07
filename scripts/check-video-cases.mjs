// The performance check's video cases from a packaged Drashti (Session 16), as a volunteer runs them
// from an installed one (docs/parallel-run.md, section 11): DRASHTI_SELFTEST=performance with
// DRASHTI_PERF_SCENARIO naming the case, one line of result each.
//
//   node scripts/check-video-cases.mjs                     the unpacked app electron-builder left in release/
//   node scripts/check-video-cases.mjs --app <path>        an installed one (Drashti.exe, or Drashti.app/Contents/MacOS/Drashti)
//   node scripts/check-video-cases.mjs --cases video-1080p30,dissolves-video
//   node scripts/check-video-cases.mjs --songs 2000         a bigger import (400 files unless asked), to try
//                                                           the rules with a slower import (Session 17)
//
// It fails only when a case did not run or gave no result: CI's machines have no real graphics chip,
// so whether they keep a video's frames says little (the mandir's computers answer that).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const CASES = (arg('--cases') ?? 'video-1080p30,dissolves-video').split(',').filter(Boolean);
const SONGS = arg('--songs');
const TIMEOUT_MS = 6 * 60_000;

/** The unpacked app electron-builder left in release/<version>/. */
function packagedBinary() {
  const release = join(root, 'release');
  for (const version of existsSync(release) ? readdirSync(release) : []) {
    for (const candidate of [
      join(release, version, 'mac-arm64', 'Drashti.app', 'Contents', 'MacOS', 'Drashti'),
      join(release, version, 'mac', 'Drashti.app', 'Contents', 'MacOS', 'Drashti'),
      join(release, version, 'win-unpacked', 'Drashti.exe'),
    ])
      if (existsSync(candidate)) return candidate;
  }
  throw new Error('No unpacked app in release/: run pnpm package:dir first, or pass --app <path>.');
}

const binary = arg('--app') ?? packagedBinary();

function runCase(scenario) {
  return new Promise((resolve) => {
    const env = { ...process.env, DRASHTI_SELFTEST: 'performance', DRASHTI_PERF_SCENARIO: scenario };
    if (SONGS) env.DRASHTI_PERF_SONGS = SONGS;
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(binary, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', () => undefined);
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('DRASHTI_PERFTEST_RESULT '));
      resolve({
        scenario,
        code,
        result: line ? JSON.parse(line.slice('DRASHTI_PERFTEST_RESULT '.length)) : null,
      });
    });
  });
}

console.log(`The video cases from ${binary}`);
let ran = 0;
for (const scenario of CASES) {
  const { code, result } = await runCase(scenario);
  if (!result) {
    console.log(`${scenario}: NO RESULT (exit code ${String(code)})`);
    continue;
  }
  ran++;
  console.log(`${scenario}: ${result.passed ? 'passed' : 'did not pass'}`);
  // How long the import took, and the priority Drashti ran at, from the summary.
  const parts = String(result.summary ?? '').split('; ');
  const told = [
    parts.find((p) => p.startsWith('import of ')),
    parts.find((p) => p.startsWith('main process priority')),
  ];
  if (told.some(Boolean)) console.log(`  (${told.filter(Boolean).join('; ')})`);
  for (const c of result.checks)
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
}
if (ran < CASES.length) {
  console.error(`${String(CASES.length - ran)} of ${String(CASES.length)} case(s) gave no result.`);
  process.exit(1);
}
