import { MEDIA_ID_PATTERN, MEDIA_SCHEME } from '../../../shared/media';
import { MAX_DISPLAY_SOURCE_BYTES } from '../../../shared/pictures';

/** Stream a private source into the below-normal worker, never a whole-source reply on Main. */
export async function readDisplaySource(
  url: string,
  maxBytes: number,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<Blob> {
  const source = new URL(url);
  if (
    source.protocol !== `${MEDIA_SCHEME}:` ||
    source.hostname !== 'media' ||
    source.port ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    !MEDIA_ID_PATTERN.test(source.pathname.slice(1))
  )
    throw new Error('The picture source is not private media.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_DISPLAY_SOURCE_BYTES)
    throw new Error('The picture byte limit is not valid.');
  const response = await fetcher(url, { cache: 'no-store', credentials: 'omit' });
  const reject = async (message: string): Promise<never> => {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(message);
  };
  if (response.status !== 200 || !response.body) return reject('The picture source could not be read.');
  const stated = response.headers.get('Content-Length');
  const expected = Number(stated);
  if (
    !stated ||
    !/^\d+$/u.test(stated) ||
    !Number.isSafeInteger(expected) ||
    expected <= 0 ||
    expected > maxBytes
  )
    return reject('The picture source exceeds its byte limit.');
  const reader = response.body.getReader();
  const parts: BlobPart[] = [];
  let bytes = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes || bytes > expected) throw new Error('The picture source exceeds its byte limit.');
      parts.push(new Uint8Array(value));
    }
    if (bytes !== expected) throw new Error('The picture source ended before its advertised length.');
    complete = true;
    // Empty MIME preserves Chromium's source-format sniffing, independently of the output encoding.
    return new Blob(parts);
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
