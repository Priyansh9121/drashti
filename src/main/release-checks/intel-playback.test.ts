import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWorkflow } from '../../../scripts/check-workflows.mjs';
import { FIRST_FRAME_MS, WATCH_MS, judgePlayback, summaryLines } from '../../../scripts/playback-check.mjs';

/*
 * The hall's video playback on an Intel Mac (alpha.23, a22-intelplay; the owner's QA23-INTELPLAY-1, "Yes, add it
 * (Rec.)": run only when asked, never in the release gate). One hand-started job on GitHub's Intel Mac runner builds
 * Drashti there and plays generated test videos through the hall's own playback path, failing on no first frame, a
 * decoder error, a video Drashti takes off, black, or a video that does not play on. Its first test proves the check
 * fails a video the hall cannot play (a generated placeholder copy cut before its movie box).
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const good = {
  name: 'Placeholder H.264.mp4',
  kind: 'H.264 320x180',
  firstFrameMs: 900,
  watchedMs: WATCH_MS,
  advancedS: 7.6,
  decodedFrames: 240,
  droppedFrames: 0,
  errorCode: null,
  off: false,
  black: 0,
  logged: null,
};

describe('the hall’s playback, judged', () => {
  it('passes a video with a first frame that plays on, decoding, never off and never black', () => {
    expect(judgePlayback(good)).toEqual([]);
  });

  it('fails no first frame, a decoder error, a video taken off, black, one that does not play on, nothing decoded', () => {
    expect(judgePlayback({ ...good, firstFrameMs: null, advancedS: 0, decodedFrames: 0 })).toEqual([
      `no first frame on the hall within ${String(FIRST_FRAME_MS / 1000)} s`,
    ]);
    expect(judgePlayback({ ...good, errorCode: 3 })).toEqual([
      'the hall’s video raised an error: MEDIA_ERR_DECODE (3)',
    ]);
    expect(judgePlayback({ ...good, errorCode: 4 })).toEqual([
      'the hall’s video raised an error: MEDIA_ERR_SRC_NOT_SUPPORTED (4)',
    ]);
    const line = 'A video could not play on “Placeholder hall” (decode): abc; taken off (now)';
    expect(judgePlayback({ ...good, off: true, logged: line })).toEqual([
      `Drashti took it off the hall: ${line}`,
    ]);
    expect(judgePlayback({ ...good, off: true })).toEqual(['Drashti took it off the hall']);
    expect(judgePlayback({ ...good, logged: line })).toEqual([
      `Drashti logged that it could not play: ${line}`,
    ]);
    expect(judgePlayback({ ...good, black: 2 })).toEqual(['the hall drew black 2 times while it was up']);
    expect(judgePlayback({ ...good, advancedS: 1.2 })).toEqual([
      `it did not play on: 1.2 s in ${(WATCH_MS / 1000).toFixed(1)} s`,
    ]);
    expect(judgePlayback({ ...good, decodedFrames: 0 })).toEqual(['the hall’s video decoded no frames']);
  });

  it('writes one row a video for the job’s summary, the verdict first', () => {
    const lines = summaryLines([
      { ...good, expectFail: false },
      { ...good, name: 'Placeholder cut copy.mp4', firstFrameMs: null, expectFail: true },
    ]);
    expect(lines[0]).toMatch(/^## /u);
    expect(lines.join('\n')).toContain('**GREEN**');
    expect(lines.join('\n')).toContain('| Placeholder H.264.mp4 |');
    expect(lines.join('\n')).toContain('the check fails it, as it must');
    expect(summaryLines([{ ...good, firstFrameMs: null, expectFail: false }]).join('\n')).toContain(
      '**RED**',
    );
    expect(summaryLines([{ ...good, expectFail: true }]).join('\n')).toContain('**RED**');
  });
});

describe('the one hand-started Intel playback job, never in the release gate', () => {
  const workflow = read('.github/workflows/performance.yml');
  const job = workflow.split('\n  intel-playback:\n')[1]?.split(/\n {2}[\w-]+:\n/u)[0] ?? '';

  it('is an input of the performance workflow, off unless asked, and the ordinary check skips when it is set', () => {
    expect(workflow).toMatch(
      /\n {6}intel_playback:\n {8}description: [^\n]+\n {8}type: boolean\n {8}default: false\n/u,
    );
    expect(job).toContain('    if: inputs.intel_playback\n');
    expect(workflow).toMatch(
      /\n {2}performance:\n {4}name: [^\n]+\n {4}if: \$\{\{ !inputs\.translate_intel && !inputs\.intel_playback \}\}\n/u,
    );
    expect(checkWorkflow(workflow, 'performance.yml')).toEqual([]);
  });

  it('runs on GitHub’s free Intel Mac runner: builds Drashti there and plays the videos through the hall', () => {
    expect(job).toContain('    runs-on: macos-15-intel\n');
    expect(job).toContain('run: pnpm install --frozen-lockfile\n');
    expect(job).toContain('run: node scripts/fetch-ffmpeg.mjs\n');
    expect(job).toContain('run: pnpm exec electron-vite build\n');
    expect(job).toContain('run: pnpm exec playwright test -c playwright.intel.config.ts\n');
    expect(read('playwright.intel.config.ts')).toContain("testDir: 'tests/intel-playback'");
  });

  it('is never in CI’s runs, the release or its gate', () => {
    for (const file of [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      'scripts/release-gate.mjs',
    ])
      for (const word of [
        'intel-playback',
        'intel_playback',
        'playwright.intel.config',
        'tests/intel-playback',
      ])
        expect(read(file), `${file}: ${word}`).not.toContain(word);
    // The end-to-end suite (CI's parts and the gate) reads tests/e2e only.
    expect(read('playwright.config.ts')).toContain("testDir: 'tests/e2e'");
  });

  it('proves in each run that it fails a video the hall cannot play, before it judges the real ones', () => {
    const spec = read('tests/intel-playback/intel-playback.spec.ts');
    // The spec's first test (a line starting test(...), not a regular expression's .test()).
    const first = spec.indexOf("\ntest('");
    expect(first).toBeGreaterThan(0);
    expect(spec.slice(first, first + 200)).toContain('cannot play');
    expect(spec).toContain('expect(judgePlayback(reading)).not.toEqual([])');
    expect(spec).toContain('expect(judgePlayback(reading), JSON.stringify(reading)).toEqual([])');
  });
});
