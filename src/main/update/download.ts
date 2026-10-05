import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { rename, rm, truncate } from 'node:fs/promises';
import { once } from 'node:events';
import type { RateGate } from '../rate-gate';

/*
 * Downloading an update (Session 14): by range, so a download cut off (or
 * paused while the stream is on air) carries on from where it stopped; at
 * the speed allowed; and checked against the release's SHA-512 before it is
 * kept. A file that fails the check is thrown away.
 */

export class DownloadStopped extends Error {
  constructor(
    readonly code: 'cancelled' | 'checksum' | 'http' | 'size',
    message: string,
  ) {
    super(message);
  }
}

export interface DownloadOptions {
  url: string;
  /** Where the checked file goes (a ".part" beside it while it downloads). */
  dest: string;
  size: number;
  /** Base64. */
  sha512: string;
  fetch: (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
  rate: RateGate;
  /** Waits while the download must (the stream on air); resolves when it may go on. */
  gate(): Promise<void>;
  cancelled(): boolean;
  progress(done: number, total: number): void;
}

/** The SHA-512 of a file, in base64. */
export async function sha512Of(file: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 }))
    hash.update(chunk as Buffer);
  return hash.digest('base64');
}

/** Download `url` to `dest`, carrying on from a ".part" already there. */
export async function downloadFile(o: DownloadOptions): Promise<void> {
  const part = `${o.dest}.part`;
  // Already here and whole (an earlier run): only checked again.
  if (existsSync(o.dest) && statSync(o.dest).size === o.size && (await sha512Of(o.dest)) === o.sha512) return;
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have > o.size) {
    await truncate(part, 0);
    have = 0;
  }
  if (have < o.size) {
    await o.gate();
    if (o.cancelled()) throw new DownloadStopped('cancelled', 'The download was stopped.');
    const response = await o.fetch(o.url, { headers: have > 0 ? { Range: `bytes=${String(have)}-` } : {} });
    if (response.status === 200 && have > 0) {
      // The server sends it all again: start over.
      await truncate(part, 0);
      have = 0;
    } else if (response.status !== 200 && response.status !== 206)
      throw new DownloadStopped(
        'http',
        `The update could not be downloaded (the server said ${String(response.status)}).`,
      );
    if (!response.body)
      throw new DownloadStopped('http', 'The update could not be downloaded (no data came).');
    const out = createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
    let done = have;
    o.progress(done, o.size);
    try {
      const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      for (;;) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        await o.gate();
        if (o.cancelled()) {
          await reader.cancel();
          throw new DownloadStopped('cancelled', 'The download was stopped.');
        }
        const wait = o.rate.take(value.length);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        done += value.length;
        if (done > o.size) throw new DownloadStopped('size', 'The update is bigger than its release says.');
        if (!out.write(value)) await once(out, 'drain');
        o.progress(done, o.size);
      }
    } finally {
      out.end();
      await once(out, 'close');
    }
    if (done !== o.size)
      throw new DownloadStopped('size', 'The download stopped short; it carries on next time.');
  }
  if ((await sha512Of(part)) !== o.sha512) {
    await rm(part, { force: true });
    throw new DownloadStopped(
      'checksum',
      'The update did not match its release’s checksum, so it was thrown away.',
    );
  }
  await rename(part, o.dest);
}
