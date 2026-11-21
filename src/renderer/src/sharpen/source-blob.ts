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
  const transfer: { bytes: number; complete: boolean; failure: { reason: unknown } | null } = {
    bytes: 0,
    complete: false,
    failure: null,
  };
  try {
    // Feed the native Blob consumer as bytes arrive, with only the current chunk kept by this reader.
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              if (transfer.bytes !== expected)
                throw new Error('The picture source ended before its advertised length.');
              transfer.complete = true;
              controller.close();
              return;
            }
            const value: unknown = chunk.value;
            if (!(value instanceof Uint8Array)) throw new Error('The picture source did not supply bytes.');
            transfer.bytes += value.byteLength;
            if (transfer.bytes > maxBytes || transfer.bytes > expected)
              throw new Error('The picture source exceeds its byte limit.');
            // Snapshot a producer's view before its next read can reuse the buffer.
            controller.enqueue(new Uint8Array(value));
          } catch (reason) {
            transfer.failure = { reason };
            throw reason;
          }
        },
      },
      { highWaterMark: 0 },
    );
    // No Content-Type keeps the existing empty Blob MIME and Chromium's source-format sniffing.
    return await new Response(body).blob();
  } catch (error) {
    if (transfer.failure) throw transfer.failure.reason;
    throw error;
  } finally {
    if (!transfer.complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
