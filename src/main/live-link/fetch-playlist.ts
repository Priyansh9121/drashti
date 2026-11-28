import { bounded, authorize, OutboundPolicy, type Authority, type Resolve } from '../network/outbound-policy';
import { openChecked, type PinnedRequest } from '../network/pinned-request';

export type PlaylistFetch =
  | { ok: true; text: string; url: string; authority?: Authority }
  | { ok: false; reason: 'status'; status: number }
  | { ok: false; reason: 'network' | 'too-big' | 'redirects' | 'not-web' | 'guard' };

const authorities = new WeakMap<AbortSignal, Authority>();
/** A URL supplied by public content (including yt-dlp's result) has no operator-authorized LAN origin. */
export function requirePublicPlaylist(signal: AbortSignal): void {
  authorities.set(signal, { origin: 'null', addresses: [] });
}

/** Test fixtures stay on loopback. Production LAN authorization belongs only to the operator's original origin. */
export const guardAllows = (url: URL): boolean =>
  url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';

export async function fetchPlaylist(
  link: string,
  options: {
    guard: boolean;
    signal: AbortSignal;
    userAgent?: string | null;
    resolve?: Resolve;
    request?: PinnedRequest;
  },
): Promise<PlaylistFetch> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]);
  try {
    const url = new URL(link);
    if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'not-web' };
    if (options.guard && !guardAllows(url)) return { ok: false, reason: 'guard' };
    const authority =
      authorities.get(options.signal) ?? (await bounded(authorize(link, options.resolve), signal));
    authorities.set(options.signal, authority);
    const policy = new OutboundPolicy(authority, options.guard, options.resolve);
    const got = await openChecked(
      link,
      (raw) => policy.target(raw),
      signal,
      options.userAgent ? { 'User-Agent': options.userAgent } : {},
      options.request,
    );
    const res = got.response;
    if (res.statusCode !== 200) {
      res.destroy();
      return { ok: false, reason: 'status', status: res.statusCode ?? 0 };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
      const b = chunk as Buffer;
      size += b.length;
      if (size > 1024 * 1024) {
        res.destroy();
        return { ok: false, reason: 'too-big' };
      }
      chunks.push(b);
    }
    return { ok: true, text: Buffer.concat(chunks).toString('utf8'), url: got.url, authority };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
