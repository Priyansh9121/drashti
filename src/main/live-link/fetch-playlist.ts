import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

/*
 * A stream link's playlist, asked for by the main process before its FFmpeg starts receiving (alpha.20, slice 8): one
 * GET, by http or https only, straight to the link's server (never through a proxy of the system's or the user's),
 * following at most a few redirects (each to http or https only), and read to at most 1 MB within 10 seconds. A test
 * run (`guard`) asks nothing of any address but this computer's own (127.0.0.1): no test reaches the internet.
 */

export type PlaylistFetch =
  | { ok: true; text: string; url: string }
  | { ok: false; reason: 'status'; status: number }
  | { ok: false; reason: 'network' | 'too-big' | 'redirects' | 'not-web' | 'guard' };

const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;

/** Whether a test run may ask this address: only this computer's own. */
export const guardAllows = (url: URL): boolean =>
  url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';

function once(
  url: URL,
  signal: AbortSignal,
  userAgent: string | null,
): Promise<{ res: IncomingMessage } | { error: true }> {
  return new Promise((resolve) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        method: 'GET',
        signal,
        timeout: TIMEOUT_MS,
        agent: false,
        headers: { Accept: '*/*', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
      },
      (res) => {
        resolve({ res });
      },
    );
    req.on('timeout', () => {
      req.destroy();
    });
    req.on('error', () => {
      resolve({ error: true });
    });
    req.end();
  });
}

/** Ask for a playlist (see above). */
export async function fetchPlaylist(
  link: string,
  options: { guard: boolean; signal: AbortSignal; userAgent?: string | null },
): Promise<PlaylistFetch> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { ok: false, reason: 'not-web' };
  }
  const timer = AbortSignal.timeout(TIMEOUT_MS);
  const signal = AbortSignal.any([options.signal, timer]);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'not-web' };
    if (options.guard && !guardAllows(url)) return { ok: false, reason: 'guard' };
    const got = await once(url, signal, options.userAgent ?? null);
    if ('error' in got) return { ok: false, reason: 'network' };
    const { res } = got;
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      try {
        url = new URL(res.headers.location, url);
      } catch {
        return { ok: false, reason: 'not-web' };
      }
      continue;
    }
    if (status !== 200) {
      res.resume();
      return { ok: false, reason: 'status', status };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of res) {
        const b = chunk as Buffer;
        size += b.length;
        if (size > MAX_BYTES) {
          res.destroy();
          return { ok: false, reason: 'too-big' };
        }
        chunks.push(b);
      }
    } catch {
      return { ok: false, reason: 'network' };
    }
    return { ok: true, text: Buffer.concat(chunks).toString('utf8'), url: url.toString() };
  }
  return { ok: false, reason: 'redirects' };
}
