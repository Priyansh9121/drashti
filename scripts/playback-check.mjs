// The hall's video playback, judged (alpha.23, a22-intelplay; the owner's QA23-INTELPLAY-1, "Yes, add it (Rec.)"):
// tests/intel-playback/intel-playback.spec.ts plays generated test videos through the hall's own playback path (a
// playlist row clicked, the audience screen's background video, Drashti's first-frame watch) and reads, for each,
// what the hall did. This judges a reading, and writes the job's summary from them all:
//   PLAY_OUTCOME=<the Playwright step's outcome> node scripts/playback-check.mjs summary <readings.json>
// Run by performance.yml's intel_playback job on GitHub's Intel Mac runner, only when asked; never in the release gate.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** How long a video has to show its first frame on the hall (Drashti's own watch takes one off after 10 s). */
export const FIRST_FRAME_MS = 30_000;
/** How long each video is watched once its first frame is in. */
export const WATCH_MS = 8_000;
/** The share of the watched time its own clock must have moved on, at least. */
export const MIN_PLAYED = 0.5;
/** The share of its frames the hall must have shown in the watch, at least (lenient: a slow VM drops some). */
export const MIN_SHOWN = 0.25;
/** The test pictures' moving bar: how many different places the hall must have shown it in, at least. */
export const MIN_MOVES = 3;

/**
 * Every reading the run must give, in the spec's order. The controls are the check's own proof: videos the hall cannot
 * play or show as it should, which the check must fail, each for its own reason (`mustSay`).
 */
export const CONTROLS = [
  { name: 'Placeholder cut copy (cannot play).mp4', mustSay: 'took it off' },
  { name: 'Placeholder black picture.mp4', mustSay: 'black' },
  { name: 'Placeholder still picture.mp4', mustSay: 'did not move' },
];
export const VIDEOS = [
  'Placeholder H.264.mp4',
  'Placeholder H.264 box at the end.mp4',
  'Placeholder 1080p30 17.8 Mbps.mp4',
  'Placeholder VP8.webm',
  'Placeholder HEVC.mp4',
];

const MEDIA_ERRORS = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

const seconds = (ms) => (ms / 1000).toFixed(1);

/** What is wrong with one video's playback on the hall (empty when it played). */
export function judgePlayback(r) {
  const problems = [];
  if (r.firstFrameMs === null)
    problems.push(`no first frame on the hall within ${String(FIRST_FRAME_MS / 1000)} s`);
  if (r.errorCode !== null)
    problems.push(
      `the hall’s video raised an error: ${MEDIA_ERRORS[r.errorCode] ?? 'MEDIA_ERR'} (${String(r.errorCode)})`,
    );
  if (r.off) problems.push(`Drashti took it off${r.logged ? `: ${r.logged}` : ''}`);
  else if (r.logged) problems.push(`Drashti logged that it could not play: ${r.logged}`);
  if (r.black > 0) problems.push(`the hall’s picture was black in ${String(r.black)} looks while it was up`);
  if (r.blackFrames > 0)
    problems.push(`the hall drew black for ${String(r.blackFrames)} frames while it was up`);
  if (r.firstFrameMs !== null && !r.off) {
    const watched = r.watchedMs / 1000;
    if (r.advancedS < MIN_PLAYED * watched)
      problems.push(`it did not play on: ${r.advancedS.toFixed(1)} s in ${seconds(r.watchedMs)} s`);
    const least = Math.ceil(MIN_SHOWN * r.fps * watched);
    if (r.presentedInWatch < least)
      problems.push(
        `the hall showed ${String(r.presentedInWatch)} frames in ${seconds(r.watchedMs)} s (fewer than ${String(least)}; ${String(r.droppedInWatch)} dropped)`,
      );
    if (r.moves < MIN_MOVES)
      problems.push(
        `the picture did not move: its bar in ${String(r.moves)} places in ${seconds(r.watchedMs)} s (a frozen hall)`,
      );
  }
  return problems;
}

/**
 * The job's summary: the verdict, then one row a video. Green only when the Playwright step succeeded (`outcome`),
 * every expected reading came, each control failed for its own reason, and every other video played.
 */
export function summaryLines(readings, { outcome = null } = {}) {
  const byName = new Map(readings.map((r) => [r.name, r]));
  const expected = [
    ...CONTROLS.map((c) => ({ name: c.name, mustSay: c.mustSay })),
    ...VIDEOS.map((name) => ({ name, mustSay: null })),
  ];
  const rows = expected.map(({ name, mustSay }) => {
    const r = byName.get(name) ?? null;
    const problems = r ? judgePlayback(r) : [];
    const ok = r !== null && (mustSay ? problems.some((p) => p.includes(mustSay)) : problems.length === 0);
    const verdict =
      r === null
        ? 'NO READING: the test stopped before it read the hall (see the job’s log)'
        : mustSay
          ? ok
            ? `the check fails it, as it must: ${problems.join('; ')}`
            : `PASSED or failed for another reason (it must say "${mustSay}"): the check is blind here${problems.length ? `: ${problems.join('; ')}` : ''}`
          : ok
            ? 'played'
            : `FAILED: ${problems.join('; ')}`;
    return { name, r, ok, verdict };
  });
  const wrong = rows.filter((row) => !row.ok);
  const green = outcome === 'success' && wrong.length === 0;
  const ms = (n) => (n === null ? 'none' : `${String(Math.round(n))} ms`);
  const first = readings.find((r) => r.runner);
  return [
    '## Video playback on the hall, on an Intel Mac (generated test videos only)',
    '',
    green
      ? `**GREEN**: the hall played all ${String(VIDEOS.length)} test videos (a first frame, playing on, frames shown, the picture moving, never off, never black), and the check failed each of its ${String(CONTROLS.length)} controls for its own reason.`
      : `**RED**: ${[
          ...(outcome === 'success'
            ? []
            : [`the Playwright step's outcome: ${String(outcome ?? 'unknown')}`]),
          ...wrong.map((row) => `${row.name}: ${row.verdict}`),
        ].join(' · ')}`,
    '',
    first?.runner ? `Runner: ${first.runner}` : 'Runner: not read',
    first?.gpu
      ? `Graphics (Chromium's own words): video decode ${first.gpu.videoDecode}, GPU compositing ${first.gpu.gpuCompositing}, devices ${first.gpu.devices.join(', ') || 'none'}`
      : 'Graphics: not read',
    '',
    '| Video | Kind | First frame | Played | Frames shown in the watch (dropped) | Bar places | Verdict |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(({ name, r, verdict }) =>
      r
        ? `| ${name} | ${r.kind} | ${ms(r.firstFrameMs)} | ${r.advancedS.toFixed(1)} s in ${seconds(r.watchedMs)} s | ${String(r.presentedInWatch)} (${String(r.droppedInWatch)}) | ${String(r.moves)} | ${verdict} |`
        : `| ${name} | | | | | | ${verdict} |`,
    ),
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, file] = process.argv.slice(2);
  if (command !== 'summary' || !file) {
    console.error('Usage: PLAY_OUTCOME=<outcome> playback-check.mjs summary <readings.json>');
    process.exit(2);
  }
  const readings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const text = `${summaryLines(readings, { outcome: process.env.PLAY_OUTCOME || null }).join('\n')}\n`;
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
