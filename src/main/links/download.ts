import { createWriteStream, existsSync, statSync } from 'node:fs';
import { truncate } from 'node:fs/promises';
import { once } from 'node:events';
import { type Get, LinkError, openLink, type OpenOptions, type Reply } from './http';
import { nameFromDisposition } from './names';

/*
 * Downloading a Dropbox link to a part-file (Session 25b), in the download
 * process. While the stream is on air or recording the download is held: the
 * request is let go, and it carries on afterwards from where it was (by
 * range, or from the start when Dropbox will not send a range: a folder's zip
 * is made afresh). It stops when told, when it would leave less than the
 * space Drashti keeps free, and at the most it may take.
 */

/** What the link holds, as Dropbox describes it. */
export interface Looked {
  name: string | null;
  size: number | null;
  zip: boolean;
}

function describe(reply: Reply): Looked {
  const type = reply.header('content-type')?.toLowerCase() ?? '';
  if (type.startsWith('text/html')) throw new LinkError('page');
  const name = nameFromDisposition(reply.header('content-disposition'));
  const length = Number(reply.header('content-length'));
  const size = reply.status === 200 && Number.isFinite(length) && length > 0 ? length : null;
  const zip = type.includes('zip') || (name?.toLowerCase().endsWith('.zip') ?? false);
  return { name, size, zip };
}

/** Ask for the link, read what Dropbox says it is, and let the rest go. */
export async function lookAt(link: string, get: Get, options: OpenOptions): Promise<Looked> {
  const reply = await openLink(link, get, options);
  try {
    return describe(reply);
  } finally {
    reply.cancel();
  }
}

export interface FetchOptions extends Omit<OpenOptions, 'headers'> {
  /** The part-file (in the folder chosen, under a hidden name). */
  part: string;
  /** True while the download must wait (the stream on air or recording). */
  held(): boolean;
  /** How often to look whether it may go on (ms). */
  holdPollMs?: number;
  /** Free bytes on the part-file's disk. */
  freeBytes(): number;
  keepFree: number;
  maxBytes: number;
  progress(done: number, total: number | null): void;
}

/** The whole size from "bytes 1000-4999/5000". */
const rangeTotal = (header: string | null): number | null => {
  const m = /\/(\d+)\s*$/u.exec(header ?? '');
  return m ? Number(m[1]) : null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asked afresh each time (it changes while a download runs). */
const stoppedNow = (signal: AbortSignal): boolean => signal.aborted;

/** Download the link into `part` (carrying on from what is there). Throws LinkError. */
export async function fetchToFile(
  link: string,
  get: Get,
  o: FetchOptions,
): Promise<{ name: string | null; zip: boolean; bytes: number }> {
  const SPACE_EVERY = 8 * 1024 * 1024;
  for (;;) {
    // Held: nothing is asked of Dropbox until the stream is off.
    while (o.held() && !o.signal.aborted) await sleep(o.holdPollMs ?? 1000);
    if (o.signal.aborted) throw new LinkError('stopped');
    if (o.freeBytes() < o.keepFree) throw new LinkError('space');
    let have = existsSync(o.part) ? statSync(o.part).size : 0;
    const reply = await openLink(link, get, {
      testOrigin: o.testOrigin,
      guard: o.guard,
      signal: o.signal,
      headers: have > 0 ? { Range: `bytes=${String(have)}-` } : {},
    });
    let looked: Looked;
    try {
      looked = describe(reply);
    } catch (error) {
      reply.cancel();
      throw error;
    }
    if (reply.status === 200 && have > 0) {
      // No range: start again.
      await truncate(o.part, 0);
      have = 0;
    }
    const total = reply.status === 206 ? rangeTotal(reply.header('content-range')) : looked.size;
    const out = createWriteStream(o.part, { flags: have > 0 ? 'a' : 'w', mode: 0o644 });
    let done = have;
    let lastProgress = 0;
    let lastSpace = done;
    let wasHeld = false;
    o.progress(done, total);
    try {
      for await (const chunk of reply.body()) {
        if (stoppedNow(o.signal)) throw new LinkError('stopped');
        if (o.held()) {
          wasHeld = true;
          break;
        }
        done += chunk.byteLength;
        if (done > o.maxBytes) throw new LinkError('space');
        if (done - lastSpace >= SPACE_EVERY) {
          lastSpace = done;
          if (o.freeBytes() < o.keepFree) throw new LinkError('space');
        }
        if (!out.write(chunk)) await once(out, 'drain');
        const now = Date.now();
        if (now - lastProgress >= 200) {
          lastProgress = now;
          o.progress(done, total);
        }
      }
    } catch (error) {
      if (error instanceof LinkError) throw error;
      throw new LinkError(stoppedNow(o.signal) ? 'stopped' : 'short');
    } finally {
      reply.cancel();
      out.end();
      await once(out, 'close');
    }
    if (wasHeld) continue;
    if (total !== null && done !== total) throw new LinkError('short');
    o.progress(done, total);
    return { name: looked.name, zip: looked.zip, bytes: done };
  }
}
