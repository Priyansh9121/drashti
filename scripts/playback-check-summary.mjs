// The Intel playback job's summary, one row a video (alpha.23, a22-intelplay; the owner's QA23-INTELPLAY-1):
//   PLAY_OUTCOME=<the Playwright step's outcome> node scripts/playback-check-summary.mjs <readings.json>
// It prints the summary and adds it to the job's ($GITHUB_STEP_SUMMARY). The judging is scripts/playback-check.mjs's.
// This command is a file of its own because tests/intel-playback's spec imports the judge, and Playwright loads it as
// CommonJS, where import.meta is a syntax error and the spec has no tests (a23-intelfix): nothing imports this file.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { summaryLines } from './playback-check.mjs';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('Usage: PLAY_OUTCOME=<outcome> node scripts/playback-check-summary.mjs <readings.json>');
  process.exit(2);
}
// No readings file: the test stopped before it read the hall; every expected video then says NO READING (RED).
const readings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const text = `${summaryLines(readings, { outcome: process.env.PLAY_OUTCOME || null }).join('\n')}\n`;
process.stdout.write(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
