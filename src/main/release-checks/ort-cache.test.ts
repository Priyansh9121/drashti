import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fetchIndic from '../../../scripts/fetch-indic.mjs';

/*
 * ONNX Runtime's release in CI's cache (alpha.23; the owner's QA23-ORTCACHE-1: "Yes, cache it (Rec.)"). Route C's
 * helper is built on Microsoft's ONNX Runtime 1.23.2 package (123 MB, scripts/fetch-indic.mjs), which every CI job
 * running the end-to-end tests downloaded each time. Now CI keeps that one file in its cache, keyed by the exact
 * version, the runner's platform and the SHA-256 the script pins. Whatever the cache gives is checked by size and
 * SHA-256 before use, as a download is; a miss downloads it as before, from a clean start (whatever a restore that
 * failed part-way left is removed first: cap-review-ortcache S2). Pushes to main and phase1 keep it (a quick
 * check's scratch branch never runs again); every run restores what main's or its own branch's runs kept. The
 * release build still downloads it fresh (Session 30: no cache before its installers are kept).
 * A stand-in fetch and a placeholder package here: nothing is downloaded.
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const PINNED_SHA256 = '25fe172f7fcdf34f2b5b02c8b997f6b88abc282956849d4af4335af23d0c4e4a';
const PINNED_PATH = '.scratch/onnxruntime-1.23.2/microsoft.ml.onnxruntime.1.23.2.nupkg';
/** The cache action the repository already uses (CI's Linux FFmpeg), by the same commit: no new action. */
const CACHE_ACTION = '55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0';
/** A miss starts clean: only when the restore ran and gave no exact hit. */
const CLEAR_IF = "steps.ort-cache.outcome == 'success' && steps.ort-cache.outputs.cache-hit != 'true'";
const SAVE_IF =
  "steps.indic.outcome == 'success' && steps.ort-cache.outputs.cache-hit != 'true' && " +
  "github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/phase1')";

describe('ONNX Runtime’s cache key (scripts/fetch-indic.mjs --cache-key)', () => {
  it('is the exact version, the runner’s platform and the pinned SHA-256', () => {
    expect(fetchIndic.ORT_RELEASE.sha256).toBe(PINNED_SHA256);
    expect(fetchIndic.ortCacheKey('win32', 'x64')).toBe(`onnxruntime-1.23.2-win32-x64-${PINNED_SHA256}`);
    expect(fetchIndic.ortCacheKey('darwin', 'arm64')).toBe(
      `onnxruntime-1.23.2-darwin-arm64-${PINNED_SHA256}`,
    );
    expect(fetchIndic.ortCacheKey()).toBe(
      `onnxruntime-1.23.2-${process.platform}-${process.arch}-${PINNED_SHA256}`,
    );
    // Made from the pins, never written out again: another release is another key.
    expect(fetchIndic.ortCacheKey('win32', 'x64', { version: '9.9.9', sha256: 'a'.repeat(64) })).toBe(
      `onnxruntime-9.9.9-win32-x64-${'a'.repeat(64)}`,
    );
  });

  it('keeps the one file the script downloads, where it has always kept it', () => {
    expect(fetchIndic.ORT_ARCHIVE).toBe(PINNED_PATH);
    expect(basename(fetchIndic.ORT_ARCHIVE)).toBe(fetchIndic.ORT_RELEASE.url.split('/').pop());
    expect(read('scripts/fetch-indic.mjs')).toContain('await ensureOrtArchive(resolve(ORT_ARCHIVE))');
  });

  it('is printed with the path for $GITHUB_OUTPUT, and nothing is fetched', async () => {
    expect(fetchIndic.ortCacheOutputs('win32', 'x64')).toBe(
      `key=onnxruntime-1.23.2-win32-x64-${PINNED_SHA256}\npath=${PINNED_PATH}\n`,
    );
    let written = '';
    const build = vi.fn(() => Promise.reject(new Error('it fetched')));
    const write = (text: string) => {
      written += text;
    };
    await fetchIndic.main(['--cache-key'], { write, build });
    expect(written).toBe(fetchIndic.ortCacheOutputs());
    expect(build).not.toHaveBeenCalled();
  });

  it('leaves the build as it was: this computer’s target, or --target and --out', async () => {
    const build = vi.fn(() => Promise.resolve('ic-ctc'));
    await fetchIndic.main([], { build });
    expect(build).toHaveBeenLastCalledWith(`${process.platform}-${process.arch}`, undefined);
    await fetchIndic.main(['--target', 'darwin-x64'], { build });
    expect(build).toHaveBeenLastCalledWith('darwin-x64', undefined);
    await fetchIndic.main(['--target', 'win32-x64', '--out', 'staged'], { build });
    expect(build).toHaveBeenLastCalledWith('win32-x64', 'staged');
  });
});

const PACKAGE = 'Placeholder ONNX Runtime package';
const RELEASE = {
  version: '0.0.0',
  url: 'https://example.invalid/placeholder.nupkg',
  bytes: Buffer.byteLength(PACKAGE),
  sha256: createHash('sha256').update(PACKAGE).digest('hex'),
};

describe('the package from CI’s cache is checked as a download is', () => {
  let dir = '';
  let archive = '';
  let lines: string[] = [];
  const log = (line: string) => lines.push(line);
  /** A stand-in fetch giving one answer, or failing the test if it is asked at all. */
  const fetchGiving = (body?: string) =>
    vi.fn((_url: string, _init: { redirect: 'error' }) =>
      body === undefined ? Promise.reject(new Error('fetched')) : Promise.resolve(new Response(body)),
    );
  const ensure = (fetch: ReturnType<typeof fetchGiving>) =>
    fetchIndic.ensureOrtArchive(archive, { release: RELEASE, fetch, log });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-ort-cache-'));
    archive = join(dir, 'onnxruntime-0.0.0', 'placeholder.nupkg');
    lines = [];
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const keep = (body: string) => {
    mkdirSync(dirname(archive), { recursive: true });
    writeFileSync(archive, body);
  };

  it('a miss downloads it as before, from the pinned address, checks it and keeps it', async () => {
    const fetch = fetchGiving(PACKAGE);
    expect(await ensure(fetch)).toBe(archive);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(RELEASE.url, { redirect: 'error' });
    expect(readFileSync(archive, 'utf8')).toBe(PACKAGE);
    expect(readdirSync(dirname(archive))).toEqual([basename(archive)]);
    expect(lines.join('\n')).toMatch(/downloaded .*checked/u);
  });

  it('a hit is used without the network, after its check', async () => {
    keep(PACKAGE);
    const fetch = fetchGiving();
    expect(await ensure(fetch)).toBe(archive);
    expect(fetch).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(/already here \(CI's cache, or an earlier build\), checked/u);
  });

  it('a hit that is not the pinned package fails its check and is never used', async () => {
    keep(PACKAGE.replace('Placeholder', 'placeholder'));
    const fetch = fetchGiving(PACKAGE);
    await expect(ensure(fetch)).rejects.toThrow('ONNX Runtime archive SHA-256 mismatch');
    keep(`${PACKAGE}.`);
    await expect(ensure(fetch)).rejects.toThrow('ONNX Runtime archive size mismatch');
    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('a download that fails its check is removed, so nothing unchecked is left for the cache to keep', async () => {
    await expect(ensure(fetchGiving('Something else'))).rejects.toThrow('ONNX Runtime archive size mismatch');
    expect(existsSync(archive)).toBe(false);
    expect(readdirSync(dirname(archive))).toEqual([]);
  });
});

/** A workflow's jobs that build Route C's helper: each job's name and its steps' texts (from "- " to the next). */
function fetchingJobs(file: string) {
  const text = read(`.github/workflows/${file}`);
  return text
    .substring(text.indexOf('\njobs:\n'))
    .split(/\n(?= {2}[\w-]+:\n)/u)
    .filter((job) => job.includes('run: node scripts/fetch-indic.mjs\n'))
    .map((job) => ({
      name: /^ {2}([\w-]+):/mu.exec(job)?.[1] ?? '?',
      steps: job.split(/\n(?= {6}- )/u).filter((step) => step.startsWith('      - ')),
    }));
}
/**
 * A step's setting (`- key:` on its first line, `key:` under it, or under its `with:` or `env:`), or undefined. A
 * folded value (`>-`) is read whole, its lines joined by a space, as GitHub reads it (cap-review-ortcache S1).
 */
function field(step: string, key: string): string | undefined {
  const m = new RegExp(`(?:^ {6}- |\\n( {8}| {10}))${key}: ([^\\n]*)`, 'u').exec(step);
  if (!m) return undefined;
  const value = m[2] ?? '';
  if (value !== '>-' && value !== '>') return value;
  const indent = (m[1] ?? ' '.repeat(8)).length;
  const lines: string[] = [];
  for (const line of step
    .substring(m.index + m[0].length)
    .split('\n')
    .slice(1)) {
    if (!line.trim() || line.length - line.trimStart().length <= indent) break;
    lines.push(line.trim());
  }
  return lines.join(' ');
}

describe('CI’s jobs that build Route C’s helper', () => {
  it('are read with their folded conditions whole', () => {
    const step = [
      '      - name: A step',
      '        if: >-',
      "          env.QUICK != 'true' ||",
      "          contains(inputs.specs, 'x')",
      '        id: x',
      '        env:',
      '          ORT_PATH: here',
      '        run: node x.mjs',
    ].join('\n');
    expect(field(step, 'if')).toBe("env.QUICK != 'true' || contains(inputs.specs, 'x')");
    expect([field(step, 'id'), field(step, 'ORT_PATH'), field(step, 'run'), field(step, 'shell')]).toEqual([
      'x',
      'here',
      'node x.mjs',
      undefined,
    ]);
  });

  it.each([
    ['ci.yml', ['app', 'app-parts', 'app-black']],
    ['performance.yml', ['performance']],
  ])('%s restores ONNX Runtime by its key before the build, which checks it, hit or miss', (file, names) => {
    const jobs = fetchingJobs(file);
    expect(jobs.map((j) => j.name)).toEqual(names);
    for (const { name, steps } of jobs) {
      const at = (test: (step: string) => boolean) => steps.findIndex(test);
      const pin = at(
        (s) => field(s, 'run') === 'node scripts/fetch-indic.mjs --cache-key >> "$GITHUB_OUTPUT"',
      );
      const restore = at((s) => field(s, 'uses') === `actions/cache/restore@${CACHE_ACTION}`);
      const clear = at((s) => field(s, 'run') === 'rm -f "$ORT_PATH"');
      const build = at((s) => field(s, 'run') === 'node scripts/fetch-indic.mjs');
      expect(pin, `${name}: the key's step`).toBeGreaterThan(-1);
      expect(restore, `${name}: the restore after it`).toBeGreaterThan(pin);
      expect(clear, `${name}: a miss's clean start after the restore`).toBeGreaterThan(restore);
      expect(build, `${name}: the build after them`).toBeGreaterThan(clear);
      // Nothing builds the helper before the restore (the Intel Mac's build comes after, on the checked package).
      expect(
        at((s) => /run: node scripts\/fetch-indic\.mjs(?! --cache-key)/u.test(s)),
        name,
      ).toBe(build);
      const [p, r, b] = [steps[pin] ?? '', steps[restore] ?? '', steps[build] ?? ''];
      expect([field(p, 'id'), field(p, 'shell')], name).toEqual(['ort', 'bash']);
      expect([field(r, 'id'), field(r, 'path'), field(r, 'key')], name).toEqual([
        'ort-cache',
        '${{ steps.ort.outputs.path }}',
        '${{ steps.ort.outputs.key }}',
      ]);
      // Only the exact key: never an older package by a prefix.
      expect(r, name).not.toContain('restore-keys');
      expect(field(b, 'id'), name).toBe('indic');
      // A miss downloads exactly as before: whatever a restore that failed part-way left is removed first. A hit
      // (the exact key, restored whole) is kept, and checked by the build.
      const c = steps[clear] ?? '';
      expect([field(c, 'if'), field(c, 'shell'), field(c, 'ORT_PATH')], name).toEqual([
        CLEAR_IF,
        'bash',
        '${{ steps.ort.outputs.path }}',
      ]);
      // The three run together, and the build (with its check) runs whatever the cache gave.
      expect([field(r, 'if'), field(b, 'if')], name).toEqual([field(p, 'if'), field(p, 'if')]);
      expect(b, name).not.toContain('cache-hit');
      for (const s of [p, r, c, b]) expect(s, name).not.toContain('working-directory');
    }
  });

  it('ci.yml keeps the package after a miss, once checked, from pushes to main and phase1 only', () => {
    for (const { name, steps } of fetchingJobs('ci.yml')) {
      const build = steps.findIndex((s) => field(s, 'run') === 'node scripts/fetch-indic.mjs');
      const saves = steps.filter((s) => field(s, 'uses') === `actions/cache/save@${CACHE_ACTION}`);
      const save = saves.find((s) => s.includes('steps.ort.outputs'));
      expect(save, `${name} keeps it`).toBeDefined();
      expect(steps.indexOf(save ?? ''), name).toBeGreaterThan(build);
      expect([field(save ?? '', 'if'), field(save ?? '', 'path'), field(save ?? '', 'key')], name).toEqual([
        SAVE_IF,
        '${{ steps.ort.outputs.path }}',
        '${{ steps.ort.outputs.key }}',
      ]);
    }
  });

  it('performance.yml only restores it (run by hand: ci.yml’s pushes keep it)', () => {
    for (const { name, steps } of fetchingJobs('performance.yml')) {
      expect(
        steps.filter(
          (s) => s.includes('actions/cache/save@') && /steps\.ort\.|\.scratch\/onnxruntime/u.test(s),
        ),
        name,
      ).toEqual([]);
    }
  });

  it('the release build still downloads it fresh, checked by its SHA-256 (no cache before its installers)', () => {
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('run: node scripts/fetch-indic.mjs\n');
    expect(release).not.toContain('--cache-key');
    expect(release).not.toContain('steps.ort.');
    expect(release).not.toContain('.scratch/onnxruntime');
  });
});
