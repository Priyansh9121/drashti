// One source archive downloaded for a release (Session 47), for scripts/release-assets.mjs. alpha.9's first
// publish run stopped when ffmpeg.org did not answer within 10 s (PLAN §6), so each download is tried up to
// three times, with a pause before the second try and a longer one before the third. release-assets.mjs checks
// the file against its pinned SHA-256 afterwards, as before.
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** The pauses before the second and the third try, in milliseconds. */
export const PAUSES_MS = [5000, 15000];

/** Why a try failed, in a few words: Node's fetch says only "fetch failed", and why in its cause. */
function why(error) {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/**
 * Downloads `source.url` into `file`, trying up to three times. `fetch` and `pause` are passed in, so the unit
 * test needs neither the network nor the wait. After the third failure it stops with the plain message
 * "<name> could not be downloaded (<the status, or why>)".
 */
export async function downloadSource(source, file, fetch, pause) {
  const tries = PAUSES_MS.length + 1;
  let failed = '';
  for (let tried = 0; tried < tries; tried += 1) {
    if (tried > 0) {
      const ms = PAUSES_MS[tried - 1];
      console.log(
        `${source.name}: try ${tried} of ${tries} failed (${failed}); trying again in ${ms / 1000} s`,
      );
      await pause(ms);
    }
    try {
      const response = await fetch(source.url);
      if (response.ok && response.body) {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
        return;
      }
      failed = String(response.status);
    } catch (error) {
      failed = why(error);
    }
  }
  throw new Error(`${source.name} could not be downloaded (${failed})`);
}
