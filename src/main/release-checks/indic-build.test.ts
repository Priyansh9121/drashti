import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Route C's helper (alpha.22, ic-ctc on Microsoft ONNX Runtime 1.23.2): tests/e2e/indic-captions.spec.ts runs the real
 * helper, so every CI job that runs end-to-end tests builds it first (scripts/fetch-indic.mjs, the pinned package by
 * its SHA-256). Playwright's shards put the spec in whichever part it falls in, and the Black jobs run every part.
 * The release build makes it for Apple silicon, Intel and Windows before packaging.
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Route C’s native helper in CI and the release build', () => {
  it('is built in every CI job that runs the end-to-end tests, before they run', () => {
    const jobs = read('.github/workflows/ci.yml')
      .split(/\n(?= {2}[\w-]+:\n)/u)
      .filter((job) => /playwright (test|install)|test:e2e/u.test(job));
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    for (const job of jobs) {
      const name = /^ {2}([\w-]+):/mu.exec(job)?.[1] ?? '?';
      const build = job.indexOf('run: node scripts/fetch-indic.mjs\n');
      const tests = job.search(/pnpm test:e2e|pnpm exec playwright test|quiet-check\.mjs/u);
      expect(build, `${name} builds Route C's helper`).toBeGreaterThan(0);
      expect(tests, `${name} runs its end-to-end tests after`).toBeGreaterThan(build);
    }
  });

  it('is built for Apple silicon, Intel and Windows in the release build, before packaging', () => {
    const release = read('.github/workflows/release.yml');
    const build = release.indexOf('run: node scripts/fetch-indic.mjs\n');
    const intel = release.indexOf('run: node scripts/fetch-indic.mjs --target darwin-x64\n');
    const pack = release.indexOf('run: node scripts/package-release.mjs');
    expect(build).toBeGreaterThan(0);
    expect(intel).toBeGreaterThan(build);
    expect(pack).toBeGreaterThan(intel);
  });
});
