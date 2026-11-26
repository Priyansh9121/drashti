import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWorkflow } from '../../../scripts/check-workflows.mjs';
import type { PlaybackReading } from '../../../scripts/playback-check.mjs';
import {
  CONTROLS,
  FIRST_FRAME_MS,
  MIN_MOVES,
  VIDEOS,
  WATCH_MS,
  judgePlayback,
  readPlaybackGpu,
  summaryLines,
} from '../../../scripts/playback-check.mjs';

/*
 * The hall's video playback on an Intel Mac (alpha.23, a22-intelplay; the owner's QA23-INTELPLAY-1, "Yes, add it
 * (Rec.)": run only when asked, never in the release gate). One hand-started job on GitHub's Intel Mac runner builds
 * Drashti there and plays generated test videos through the hall's own playback path, failing on no first frame, a
 * decoder error, a video Drashti takes off, black (in its pixels or in any frame of its markup), a video whose own clock
 * does not move on, too few frames shown in the watch, or a picture that does not move (its bar, a frozen hall). Its
 * first tests prove the check fails a video the hall cannot play, a black picture and a still one (a22-review-intelplay).
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const good: PlaybackReading = {
  name: 'Placeholder H.264.mp4',
  kind: 'H.264 320x180',
  fps: 30,
  firstFrameMs: 900,
  watchedMs: WATCH_MS,
  advancedS: 7.6,
  presentedInWatch: 236,
  droppedInWatch: 4,
  moves: 18,
  errorCode: null,
  off: false,
  black: 0,
  blackFrames: 0,
  logged: null,
  looks: [],
};
const all = (over: Record<string, Partial<PlaybackReading>> = {}): PlaybackReading[] => [
  ...CONTROLS.map((c) => ({
    ...good,
    name: c.name,
    ...(c.mustSay === 'took it off'
      ? { firstFrameMs: null, off: true }
      : c.mustSay === 'black'
        ? { firstFrameMs: null, black: 40 }
        : { moves: 1 }),
    ...over[c.name],
  })),
  ...VIDEOS.map((name) => ({ ...good, name, ...over[name] })),
];

describe('the hall’s playback, judged', () => {
  it('passes a video with a first frame that plays on, shows its frames and moves, never off and never black', () => {
    expect(judgePlayback(good)).toEqual([]);
  });

  it('fails no first frame, a decoder error, a video taken off, black, one that does not play on', () => {
    expect(
      judgePlayback({ ...good, firstFrameMs: null, advancedS: 0, presentedInWatch: 0, moves: 0 }),
    ).toEqual([`no first frame on the hall within ${String(FIRST_FRAME_MS / 1000)} s`]);
    expect(judgePlayback({ ...good, errorCode: 3 })).toEqual([
      'the hall’s video raised an error: MEDIA_ERR_DECODE (3)',
    ]);
    expect(judgePlayback({ ...good, errorCode: 4 })).toEqual([
      'the hall’s video raised an error: MEDIA_ERR_SRC_NOT_SUPPORTED (4)',
    ]);
    const line = 'A video could not play on “Placeholder hall” (decode): abc; taken off (now)';
    expect(judgePlayback({ ...good, off: true, logged: line })).toEqual([`Drashti took it off: ${line}`]);
    expect(judgePlayback({ ...good, off: true })).toEqual(['Drashti took it off']);
    expect(judgePlayback({ ...good, logged: line })).toEqual([
      `Drashti logged that it could not play: ${line}`,
    ]);
    expect(judgePlayback({ ...good, black: 2 })).toEqual([
      'the hall’s picture was black in 2 looks while it was up',
    ]);
    // A flash between the picture and the video, seen by the page's own frame-by-frame look (a22-review-intelplay S2).
    expect(judgePlayback({ ...good, blackFrames: 3 })).toEqual([
      'the hall drew black for 3 frames while it was up',
    ]);
    expect(judgePlayback({ ...good, advancedS: 1.2 })).toEqual([
      `it did not play on: 1.2 s in ${(WATCH_MS / 1000).toFixed(1)} s`,
    ]);
  });

  it('fails a hall that froze after its first frame: its clock running, its frames dropped, its picture still (a22-review-intelplay M2)', () => {
    // The stand-in: the element's clock runs 8 s, 240 frames counted but 238 dropped, the bar in one place.
    const frozen = { ...good, presentedInWatch: 2, droppedInWatch: 238, moves: 1 };
    expect(judgePlayback(frozen)).toEqual([
      'the hall showed 2 frames in 8.0 s (fewer than 60; 238 dropped)',
      'the picture did not move: its bar in 1 places in 8.0 s (a frozen hall)',
    ]);
    // Each alone fails it.
    expect(judgePlayback({ ...good, presentedInWatch: 59 })).toHaveLength(1);
    expect(judgePlayback({ ...good, moves: MIN_MOVES - 1 })).toHaveLength(1);
    // Lenient: a choppy VM showing a quarter of its frames, the bar moving, passes.
    expect(judgePlayback({ ...good, presentedInWatch: 60, droppedInWatch: 180, moves: MIN_MOVES })).toEqual(
      [],
    );
  });

  it('says GREEN only when the Playwright step succeeded, every expected reading came, each control failed for its own reason and every video played (a22-review-intelplay M1)', () => {
    const lines = summaryLines(all(), { outcome: 'success' });
    expect(lines[0]).toMatch(/^## /u);
    expect(lines.join('\n')).toContain('**GREEN**');
    expect(lines.join('\n')).toContain('| Placeholder H.264.mp4 |');
    expect(lines.join('\n')).toContain('the check fails it, as it must');
    // A step that failed, whatever the readings say.
    expect(summaryLines(all(), { outcome: 'failure' }).join('\n')).toMatch(
      /^\*\*RED\*\*: the Playwright step's outcome: failure/mu,
    );
    expect(summaryLines(all()).join('\n')).toContain('**RED**');
    // The proofs and one of five videos: the rest never read (a test stopped before it read the hall).
    const some = all().slice(0, CONTROLS.length + 1);
    const red = summaryLines(some, { outcome: 'success' }).join('\n');
    expect(red).toContain('**RED**');
    expect(red).toContain(`${VIDEOS[1] ?? ''}: NO READING`);
    // A video that failed, and a control that passed or failed only for another reason.
    expect(
      summaryLines(all({ [VIDEOS[0] ?? '']: { firstFrameMs: null } }), { outcome: 'success' }).join('\n'),
    ).toContain('**RED**');
    expect(
      summaryLines(all({ [CONTROLS[2]?.name ?? '']: { moves: 18 } }), { outcome: 'success' }).join('\n'),
    ).toContain('the check is blind here');
    expect(
      summaryLines(all({ [CONTROLS[0]?.name ?? '']: { off: false } }), { outcome: 'success' }).join('\n'),
    ).toContain('**RED**');
  });

  it('keeps feature status when Chromium refuses GPU details, without aborting playback', async () => {
    const gpu = await readPlaybackGpu({
      getGPUFeatureStatus: () => ({ video_decode: 'disabled_software', gpu_compositing: 'disabled_software' }),
      getGPUInfo: () => Promise.reject(new Error('GPU access is disabled due to frequent crashes.')),
    });
    expect(gpu).toEqual({
      videoDecode: 'disabled_software',
      gpuCompositing: 'disabled_software',
      devices: [],
      problem: 'off: GPU access is disabled due to frequent crashes.',
    });
    const lines = summaryLines(all().map((r) => ({ ...r, gpu })), { outcome: 'success' }).join('\n');
    expect(lines).toContain('SOFTWARE-ONLY');
    expect(lines).toContain('no working GPU');
    expect(lines).toContain(gpu.problem);
    expect(lines).not.toContain('**GREEN**');
    expect(lines).toContain('| played |');
  });

  it('records successful GPU details and tolerates a failed feature-status read', async () => {
    expect(await readPlaybackGpu({
      getGPUFeatureStatus: () => ({ video_decode: 'enabled', gpu_compositing: 'enabled' }),
      getGPUInfo: () => Promise.resolve({ gpuDevice: [{ vendorId: 0x106b, deviceId: 0xeeee, active: true }] }),
    })).toEqual({ videoDecode: 'enabled', gpuCompositing: 'enabled', devices: ['106b:eeee (active)'] });
    const gpu = await readPlaybackGpu({
      getGPUFeatureStatus: () => { throw new Error('status unavailable'); },
      getGPUInfo: () => Promise.resolve({}),
    });
    expect(gpu.problem).toContain('status unavailable');
    expect(summaryLines(all().map((r) => ({ ...r, gpu })), { outcome: 'success' }).join('\n')).not.toContain('**GREEN**');
    const software = { videoDecode: 'disabled_software', gpuCompositing: 'disabled_software', devices: [] };
    expect(summaryLines(all().map((r) => ({ ...r, gpu: software })), { outcome: 'success' }).join('\n')).toContain('SOFTWARE-ONLY');
  });

  it('prints the runner and its graphics as Chromium reports them (a22-review-intelplay S3)', () => {
    const lines = summaryLines(
      all().map((r) => ({
        ...r,
        runner: 'macOS 15.7 (x64)',
        gpu: { videoDecode: 'unavailable_software', gpuCompositing: 'enabled', devices: ['15ad:405'] },
      })),
      { outcome: 'success' },
    ).join('\n');
    expect(lines).toContain('Runner: macOS 15.7 (x64)');
    expect(lines).toContain('video decode unavailable_software, GPU compositing enabled, devices 15ad:405');
  });
});

describe('the one hand-started Intel playback job, never in the release gate', () => {
  const workflow = read('.github/workflows/performance.yml');
  const job = workflow.split('\n  intel-playback:\n')[1]?.split(/\n\n|\n {2}[\w-]+:\n/u)[0] ?? '';

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
    // The summary knows whether the Playwright step passed (a22-review-intelplay M1).
    expect(job).toMatch(
      /\n {8}id: play\n[^]*run: pnpm exec playwright test -c playwright\.intel\.config\.ts\n/u,
    );
    expect(job).toContain('PLAY_OUTCOME: ${{ steps.play.outcome }}');
    // The summary is its own command, so the judge the spec imports holds no import.meta (Playwright loads it as
    // CommonJS: the job's first run found no tests; a23-intelfix, playwright-imports.test.ts).
    expect(job).toContain('run: node scripts/playback-check-summary.mjs "$DRASHTI_PLAYBACK_READINGS"\n');
    expect(read('scripts/playback-check-summary.mjs')).toMatch(
      /^import \{ summaryLines \} from '\.\/playback-check\.mjs';$/mu,
    );
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

  it('proves in each run, first, that it fails its controls, then judges the real ones in the expected order', () => {
    const spec = read('tests/intel-playback/intel-playback.spec.ts');
    // The spec's first test (a line starting test(...), not a regular expression's .test()).
    const first = spec.indexOf("\ntest('");
    expect(first).toBeGreaterThan(0);
    expect(spec.slice(first, first + 200)).toContain('cannot play');
    expect(first).toBeLessThan(spec.indexOf('for (const video of RECIPES)'));
    expect(spec).toContain("judgePlayback(reading).some((p) => p.includes(c?.mustSay ?? '?'))");
    expect(spec).toContain('expect(reading.off, JSON.stringify(reading)).toBe(true)');
    expect(spec).toContain('expect(judgePlayback(reading), JSON.stringify(reading)).toEqual([])');
    // The spec's videos are the summary's: a missing reading is RED.
    expect(spec).toContain('expect(RECIPES.map((r) => r.name)).toEqual(VIDEOS)');
    // The log across the runner's midnight (a22-review-intelplay S4).
    expect(spec).toContain("from '../e2e/log-lines'");
  });
});
