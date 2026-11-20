import { MAX_DISPLAY_SOURCE_BYTES } from '../../shared/pictures';
import { handleMediaRequest, mediaRequestOf, type MediaProtocolDeps } from './media-protocol';

/** Only the granted original, streamed in this worker's own Session with the producer's byte bound. */
export async function handleDisplaySourceRequest(
  request: Request,
  deps: Pick<MediaProtocolDeps, 'mediaDir' | 'lookup'> & {
    fetchFile?: (url: string, init: RequestInit) => Promise<Response>;
  },
): Promise<Response> {
  const refused = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (mediaRequestOf(request.url)?.what !== 'media') return refused();
  const response = await handleMediaRequest(request, deps);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  if (response.ok) {
    const range = headers.get('Content-Range');
    const total =
      range === null ? Number(headers.get('Content-Length')) : Number(/\/(\d+)$/u.exec(range)?.[1]);
    const length = Number(headers.get('Content-Length'));
    if (
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      total > MAX_DISPLAY_SOURCE_BYTES ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_DISPLAY_SOURCE_BYTES
    ) {
      await response.body?.cancel().catch(() => undefined);
      return refused();
    }
  }
  return new Response(response.body, { status: response.status, headers });
}
