// The hall's video playback, judged (alpha.23, a22-intelplay; the owner's QA23-INTELPLAY-1, "Yes, add it (Rec.)"):
// tests/intel-playback/intel-playback.spec.ts plays generated test videos through the hall's own playback path (a
// playlist row clicked, the audience screen's background video, Drashti's first-frame watch) and reads, for each,
// what the hall did. This judges a reading, and writes the job's summary from them all:
//   node scripts/playback-check.mjs summary <readings.json>     prints the summary (and adds it to the job's)
// Run by performance.yml's intel_playback job on GitHub's Intel Mac runner, only when asked; never in the release gate.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** How long a video has to show its first frame on the hall (Drashti's own watch takes one off after 10 s). */
export const FIRST_FRAME_MS = 30_000;
/** How long each video is watched once its first frame is in. */
export const WATCH_MS = 8_000;
/** How much of the watched time it must have played on, at least. */
export const MIN_PLAYED = 0.5;

const MEDIA_ERRORS = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

/** What is wrong with one video's playback on the hall (empty when it played). */
export function judgePlayback(r) {
  const problems = [];
  if (r.firstFrameMs === null)
    problems.push(`no first frame on the hall within ${String(FIRST_FRAME_MS / 1000)} s`);
  if (r.errorCode !== null)
    problems.push(
      `the hall’s video raised an error: ${MEDIA_ERRORS[r.errorCode] ?? 'MEDIA_ERR'} (${String(r.errorCode)})`,
    );
  if (r.off) problems.push(`Drashti took it off the hall${r.logged ? `: ${r.logged}` : ''}`);
  else if (r.logged) problems.push(`Drashti logged that it could not play: ${r.logged}`);
  if (r.black > 0) problems.push(`the hall drew black ${String(r.black)} times while it was up`);
  if (r.firstFrameMs !== null && !r.off) {
    if (r.advancedS < (MIN_PLAYED * r.watchedMs) / 1000)
      problems.push(
        `it did not play on: ${r.advancedS.toFixed(1)} s in ${(r.watchedMs / 1000).toFixed(1)} s`,
      );
    if (r.decodedFrames === 0) problems.push('the hall’s video decoded no frames');
  }
  return problems;
}

/**
 * The job's summary: the verdict, then one row a video. `expectFail` marks the check's own proof (a video the hall
 * cannot play, which it must fail); the run is green when that one fails and every other plays.
 */
export function summaryLines(readings) {
  const rows = readings.map((r) => ({ r, problems: judgePlayback(r) }));
  const wrong = rows.filter(({ r, problems }) =>
    r.expectFail ? problems.length === 0 : problems.length > 0,
  );
  const proof = rows.filter(({ r }) => r.expectFail);
  const green = wrong.length === 0 && proof.length > 0 && rows.length > proof.length;
  const ms = (n) => (n === null ? 'none' : `${String(Math.round(n))} ms`);
  return [
    '## Video playback on the hall, on an Intel Mac (generated test videos only)',
    '',
    green
      ? `**GREEN**: the hall played all ${String(rows.length - proof.length)} test videos (a first frame, playing on, never off, never black), and the check failed the video it cannot play.`
      : `**RED**: ${
          wrong.length > 0
            ? wrong
                .map(({ r, problems }) =>
                  r.expectFail
                    ? `${r.name}: the check passed a video the hall cannot play`
                    : `${r.name}: ${problems.join('; ')}`,
                )
                .join(' · ')
            : 'not every reading came (see the job’s log)'
        }`,
    '',
    '| Video | Kind | First frame | Played | Frames decoded (dropped) | Verdict |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      ({ r, problems }) =>
        `| ${r.name} | ${r.kind} | ${ms(r.firstFrameMs)} | ${r.advancedS.toFixed(1)} s in ${(r.watchedMs / 1000).toFixed(1)} s | ${String(r.decodedFrames)} (${String(r.droppedFrames)}) | ${
          r.expectFail
            ? problems.length > 0
              ? `the check fails it, as it must: ${problems.join('; ')}`
              : 'PASSED, but the hall cannot play it: the check is blind'
            : problems.length > 0
              ? `FAILED: ${problems.join('; ')}`
              : 'played'
        } |`,
    ),
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, file] = process.argv.slice(2);
  if (command !== 'summary' || !file) {
    console.error('Usage: playback-check.mjs summary <readings.json>');
    process.exit(2);
  }
  const readings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const text = `${summaryLines(readings).join('\n')}\n`;
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
