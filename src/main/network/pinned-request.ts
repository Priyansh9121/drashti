import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { bounded, type PinnedTarget } from './outbound-policy';

export type PinnedRequest = (
  target: PinnedTarget,
  signal: AbortSignal,
  headers?: Record<string, string>,
) => Promise<IncomingMessage>;

/** No proxy or second DNS lookup; retain the original hostname for Host, SNI and certificate verification. */
export const pinnedRequest: PinnedRequest = (target, signal, headers = {}) =>
  new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_host, options, cb) => {
      if (options.all) cb(null, target.addresses);
      else cb(null, target.ip, target.family);
    };
    const secure = target.url.protocol === 'https:';
    const host = target.url.hostname.replace(/^\[|\]$/gu, '');
    const request = (secure ? httpsRequest : httpRequest)(
      target.url,
      {
        method: 'GET',
        lookup,
        autoSelectFamily: true,
        agent: false,
        signal,
        headers: { Accept: '*/*', ...headers },
        ...(secure && !isIP(host) ? { servername: host } : {}),
      },
      resolve,
    );
    request.on('error', reject);
    request.setTimeout(10_000, () => request.destroy(new Error('Read timed out')));
    request.end();
  });

/** Check every redirect before issuing its request; returned bytes still share the overall abort signal. */
export async function openChecked(
  raw: string,
  target: (url: string) => Promise<PinnedTarget>,
  signal: AbortSignal,
  headers: Record<string, string> = {},
  request: PinnedRequest = pinnedRequest,
): Promise<{ response: IncomingMessage; url: string }> {
  let url = raw;
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted();
    const checked = await bounded(target(url), signal);
    signal.throwIfAborted();
    const response = await request(checked, signal, headers);
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || hop === 5) throw new Error('Too many or invalid redirects');
      url = new URL(location, checked.url).href;
      continue;
    }
    return { response, url: checked.url.href };
  }
  throw new Error('Too many redirects');
}
