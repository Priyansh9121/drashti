import { downloadHostAllowed } from '../../shared/links';

/*
 * The download process's requests (Session 25b). Redirects are never
 * followed blindly: each address Dropbox sends a download on to is checked
 * (https, Dropbox's own) before anything is asked of it.
 *
 * Tests only: every request goes to a local stand-in instead (its address
 * given by the main process, never in a packaged Drashti), with the address
 * it stands for in a header; and a guard refuses any request to anywhere but
 * 127.0.0.1, so no test can reach the internet.
 */

/** One answer, its body not read yet. */
export interface Reply {
  status: number;
  header(name: string): string | null;
  body(): AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  /** Close the connection without reading on. */
  cancel(): void;
}

/** One request that never follows a redirect (it is handed back). */
export type Get = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<Reply>;

export type LinkErrorCode =
  | 'host'
  | 'guard'
  | 'redirects'
  | 'gone'
  | 'refused'
  | 'busy'
  | 'http'
  | 'network'
  | 'page'
  | 'short'
  | 'space'
  | 'stopped';

/** Messages people see (plain, with what to do; never a status number or the system's text). */
const MESSAGES: Record<LinkErrorCode, string> = {
  host: 'Dropbox sent the download on to an address that is not Dropbox’s, so Drashti stopped. Nothing was kept.',
  guard: 'Test guard: a download was sent somewhere other than 127.0.0.1, so it was stopped.',
  redirects: 'Dropbox kept sending the download on elsewhere, so Drashti stopped. Try again later.',
  gone: 'Dropbox says that link is no longer there (it may have been deleted, or its sharing turned off). Ask for a new link.',
  refused:
    'Dropbox did not allow the download. The owner may have turned off downloads for this link, or it needs a password. Ask for a link anyone can download.',
  busy: 'Dropbox is busy or limiting downloads just now. Try again later.',
  http: 'Dropbox did not send the file. Try again later; if it happens again, ask for a new link.',
  network: 'Drashti could not reach Dropbox. Check this computer’s internet connection, then try again.',
  page: 'Dropbox showed a web page instead of the file: the link may need signing in or a password. Ask for a link anyone can download.',
  short: 'The download stopped before the end. Try again.',
  space:
    'The disk is nearly full: Drashti keeps 2 GB free for the show. Free up some space, or choose another drive, then try again.',
  stopped: 'Stopped. Nothing was kept.',
};

export class LinkError extends Error {
  constructor(readonly code: LinkErrorCode) {
    super(MESSAGES[code]);
    this.name = 'LinkError';
  }
}

export const linkMessage = (code: LinkErrorCode): string => MESSAGES[code];

/** Where a request really goes (see above). Throws the guard's error in the tests. */
export function routeFor(
  url: string,
  testOrigin: string | null,
  guard: boolean,
): { url: string; headers: Record<string, string> } {
  let routed = { url, headers: {} as Record<string, string> };
  if (testOrigin !== null) {
    const real = new URL(url);
    const origin = new URL(testOrigin);
    routed = {
      url: `${origin.origin}${real.pathname}${real.search}`,
      headers: { 'x-drashti-test-host': real.host },
    };
  }
  if (guard && new URL(routed.url).hostname !== '127.0.0.1') throw new LinkError('guard');
  return routed;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_HOPS = 6;

/** The error for an answer that is not the file. */
export function statusError(status: number): LinkError {
  if (status === 404 || status === 410) return new LinkError('gone');
  if (status === 401 || status === 403) return new LinkError('refused');
  if (status === 429 || status >= 500) return new LinkError('busy');
  return new LinkError('http');
}

export interface OpenOptions {
  testOrigin: string | null;
  guard: boolean;
  signal: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Ask for a link, following Dropbox's redirects one by one (each checked),
 * and hand back the final answer (200 or 206), its body unread.
 */
export async function openLink(link: string, get: Get, options: OpenOptions): Promise<Reply> {
  let current = link;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!downloadHostAllowed(current)) throw new LinkError('host');
    const routed = routeFor(current, options.testOrigin, options.guard);
    let reply: Reply;
    try {
      reply = await get(routed.url, { ...routed.headers, ...options.headers }, options.signal);
    } catch {
      throw new LinkError(options.signal.aborted ? 'stopped' : 'network');
    }
    if (REDIRECTS.has(reply.status)) {
      const location = reply.header('location');
      reply.cancel();
      if (!location) throw new LinkError('http');
      current = new URL(location, current).toString();
      continue;
    }
    if (reply.status !== 200 && reply.status !== 206) {
      reply.cancel();
      throw statusError(reply.status);
    }
    return reply;
  }
  throw new LinkError('redirects');
}

/** Node's own fetch, one request at a time with redirects handed back (the unit tests use it). */
export const nodeGet: Get = async (url, headers, signal) => {
  const response = await fetch(url, { headers, signal, redirect: 'manual' });
  return {
    status: response.status,
    header: (name) => response.headers.get(name),
    body: () => response.body ?? [],
    cancel: () => {
      void response.body?.cancel().catch(() => undefined);
    },
  };
};
