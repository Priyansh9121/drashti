import { bounded } from '../network/outbound-policy';
export interface UpdateFetchInit {
  headers: Record<string, string>;
  redirect: 'manual';
  credentials: 'omit';
  signal: AbortSignal;
}
export type UpdateFetch = (url: string, init: UpdateFetchInit) => Promise<Response>;

// release.yml publishes GitHub Releases; release-assets.mjs writes github.com download URLs.
// GitHub's asset CDN hosts are exact names, never a githubusercontent.com wildcard.
const RELEASE_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
export function updateHopAllowed(raw: string, testOrigin: string | null = null): boolean {
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.hash) return false;
    if (u.protocol === 'https:' && u.port === '' && RELEASE_HOSTS.has(u.hostname)) return true;
    // An unpackaged fixture may use only its configured test origin, never any other local service.
    return (
      testOrigin !== null &&
      u.origin === testOrigin &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}

/** Bound the whole redirect exchange. Check before each connection, retaining Range on approved hops. */
export async function checkedUpdateFetch(
  fetch: UpdateFetch,
  raw: string,
  options: {
    headers: Record<string, string>;
    packaged: boolean;
    base: string;
    signal: AbortSignal;
  },
): Promise<Response> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10_000);
  const signal = AbortSignal.any([timeout.signal, options.signal]);
  const testOrigin = options.packaged ? null : new URL(options.base).origin;
  let url = raw;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      signal.throwIfAborted();
      if (!updateHopAllowed(url, testOrigin)) throw new Error('Refused update destination');
      const response = await bounded(
        fetch(url, { headers: options.headers, redirect: 'manual', credentials: 'omit', signal }),
        signal,
      );
      signal.throwIfAborted();
      if (response.redirected) {
        if (response.body)
          await bounded(
            response.body.cancel().catch(() => undefined),
            signal,
          );
        throw new Error('Automatic update redirect refused');
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      if (response.body)
        await bounded(
          response.body.cancel().catch(() => undefined),
          signal,
        );
      if (!location || hop === 5) throw new Error('Too many or invalid update redirects');
      url = new URL(location, url).href;
    }
    throw new Error('Too many update redirects');
  } finally {
    clearTimeout(timer);
  }
}
