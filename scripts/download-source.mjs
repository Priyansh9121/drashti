// One source archive downloaded for a release (Session 47), for scripts/release-assets.mjs. alpha.9's first
// publish run stopped when ffmpeg.org did not answer within 10 s (PLAN §6), so each download is tried up to
// three times, with a pause before the second try and a longer one before the third. release-assets.mjs checks
// the file against its pinned SHA-256 afterwards, as before. alpha.14's publish stopped the same way (4 Nov
// 2026), so a source may name a backup, an identical copy elsewhere: tried likewise once its own server has
// failed three tries, and kept only if it matches the source's pinned SHA-256.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** The pauses before the second and the third try, in milliseconds. */
export const PAUSES_MS = [5000, 15000];
const TRIES = PAUSES_MS.length + 1;

/** Why a try failed, in a few words: Node's fetch says only "fetch failed", and why in its cause. */
function why(error) {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/** Downloads `url` into `file`, trying up to three times: null once a try works, or why the last one failed. */
async function tryThrice(label, url, file, fetch, pause) {
  let failed = '';
  for (let tried = 0; tried < TRIES; tried += 1) {
    if (tried > 0) {
      const ms = PAUSES_MS[tried - 1];
      console.log(`${label}: try ${tried} of ${TRIES} failed (${failed}); trying again in ${ms / 1000} s`);
      await pause(ms);
    }
    try {
      const response = await fetch(url);
      if (response.ok && response.body) {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
        return null;
      }
      failed = String(response.status);
    } catch (error) {
      failed = why(error);
    }
  }
  return failed;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Downloads `source.url` into `file`, trying up to three times; then, if the source has a backup, the backup
 * likewise, refused (and removed) unless it matches `source.sha256`. `fetch` and `pause` are passed in, so the
 * unit test needs neither the network nor the wait. When nothing works it stops with the plain message
 * "<name> could not be downloaded (<the status, or why>)".
 */
export async function downloadSource(source, file, fetch, pause) {
  const failed = await tryThrice(source.name, source.url, file, fetch, pause);
  if (failed === null) return;
  if (!source.backup) throw new Error(`${source.name} could not be downloaded (${failed})`);
  console.log(
    `${source.name}: try ${TRIES} of ${TRIES} failed (${failed}); trying its backup, ${source.backup}`,
  );
  const backupFailed = await tryThrice(`${source.name} (backup)`, source.backup, file, fetch, pause);
  if (backupFailed !== null)
    throw new Error(`${source.name} could not be downloaded (${failed}; its backup: ${backupFailed})`);
  if ((await sha256(file)) !== source.sha256) {
    rmSync(file, { force: true });
    throw new Error(`${source.name} from its backup did not match its pinned SHA-256`);
  }
}
