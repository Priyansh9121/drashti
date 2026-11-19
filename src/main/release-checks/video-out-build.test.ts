import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OWN_SOURCES,
  PROGRAMS,
  SPOUT,
  SYPHON,
  stampFor,
  WINDOWS_LINK,
} from '../../../scripts/fetch-video-out.mjs';

/*
 * Video out's programs (x30; the owner's "Go, all A"): built from Syphon's and Spout's sources at one pinned commit,
 * every file by its own SHA-256 (scripts/fetch-video-out.mjs); their licences in LICENSES/ exactly as at that commit;
 * the sender alone in each installer, never the tests' receiver; built in every CI job that runs the end-to-end tests
 * (and checked there, a picture read back on the runner) and in the release build, never from a cache.
 * x39: each Windows program carries its manifest inside it (the installer takes the sender alone), and a change to how
 * they are built builds them again, as a change to their sources does.
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const sha256 = (path: string) =>
  createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');

describe('video out’s pinned sources (x30)', () => {
  it('names one commit and each file by its own SHA-256, with every source compiled and the licence among them', () => {
    for (const source of [SYPHON, SPOUT]) {
      expect(source.commit, source.repo).toMatch(/^[0-9a-f]{40}$/u);
      for (const [path, hash] of Object.entries(source.files)) expect(hash, path).toMatch(/^[0-9a-f]{64}$/u);
      for (const path of [...source.sources, source.licence])
        expect(source.files, path).toHaveProperty([path]);
    }
  });

  it('keeps each licence in LICENSES/ exactly as at the pinned commit, with a notice beside it', () => {
    expect(sha256('LICENSES/syphon/License.txt')).toBe(SYPHON.files['License.txt']);
    expect(sha256('LICENSES/spout/LICENSE')).toBe(SPOUT.files['LICENSE']);
    expect(read('LICENSES/syphon/README.md')).toContain(SYPHON.commit);
    expect(read('LICENSES/spout/README.md')).toContain(SPOUT.commit);
  });

  it('builds from Drashti’s own sources, all in the repository', () => {
    for (const path of [...OWN_SOURCES.darwin, ...OWN_SOURCES.win32])
      expect(read(path).length, path).toBeGreaterThan(0);
  });

  it('builds the programs again when their build changes, not only when their sources do (x39)', () => {
    // What a build already in vendor/video-out/ is reused by (its SOURCE.txt) names the build script by its SHA-256,
    // so a changed compiler or linker option never leaves an old program to be packaged.
    const script = `scripts/fetch-video-out.mjs ${sha256('scripts/fetch-video-out.mjs')}`;
    for (const [target, source] of [
      ['darwin-arm64', SYPHON],
      ['darwin-x64', SYPHON],
      ['win32-x64', SPOUT],
    ] as const)
      expect(stampFor(target, source), target).toContain(script);
  });
});

describe('video out in the installers and on CI (x30)', () => {
  it('puts the sender alone in each installer, never the tests’ receiver', () => {
    const builder = read('electron-builder.yml');
    expect(builder).toContain(
      `    - from: vendor/video-out/darwin-\${arch}\n      to: video-out\n      filter: [${PROGRAMS.darwin.sender}]\n`,
    );
    expect(builder).toContain(
      `    - from: vendor/video-out/win32-\${arch}\n      to: video-out\n      filter: [${PROGRAMS.win32.sender}]\n`,
    );
    expect(builder).not.toContain(PROGRAMS.darwin.receiver);
  });

  it('links each Windows program with its manifest inside it, so the sender is whole alone in the installer (x39)', () => {
    // Spout's sources ask for Common Controls 6 (their message box). Left as a file beside the program (the linker's
    // default), it stayed behind when the installer took the sender alone, and Windows stopped the packaged sender
    // before it ran (0xC0000138, an ordinal not found; phase1 126a31c0's full run 44560355574).
    expect(WINDOWS_LINK).toContain('/MANIFEST:EMBED');
  });

  it('builds and checks it in every CI job that runs the end-to-end tests, before they run', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobs = ci
      .split(/\n(?= {2}[\w-]+:\n)/u)
      .filter((job) => /playwright (test|install)|test:e2e/u.test(job));
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    for (const job of jobs) {
      const name = /^ {2}([\w-]+):/mu.exec(job)?.[1] ?? '?';
      const build = job.indexOf('run: node scripts/fetch-video-out.mjs\n');
      const check = job.indexOf('run: node scripts/check-video-out.mjs\n');
      const tests = job.search(/pnpm test:e2e|pnpm exec playwright test|quiet-check\.mjs/u);
      expect(build, `${name} builds video out`).toBeGreaterThan(0);
      expect(check, `${name} checks it`).toBeGreaterThan(build);
      expect(tests, `${name} runs its end-to-end tests after`).toBeGreaterThan(check);
    }
    // The job that packages both Mac builds builds Intel's too.
    expect(ci).toContain('run: node scripts/fetch-video-out.mjs --target darwin-x64\n');
  });

  it('builds it in the release build for Apple silicon, Intel and Windows, before packaging, with no cache', () => {
    const release = read('.github/workflows/release.yml');
    const build = release.indexOf('run: node scripts/fetch-video-out.mjs\n');
    const intel = release.indexOf('run: node scripts/fetch-video-out.mjs --target darwin-x64\n');
    const pack = release.indexOf('run: node scripts/package-release.mjs');
    expect(build).toBeGreaterThan(0);
    expect(intel).toBeGreaterThan(build);
    expect(pack).toBeGreaterThan(intel);
    expect(release.slice(0, pack)).not.toMatch(/actions\/cache/u);
  });
});
