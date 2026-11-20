import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_DISPLAY_SOURCE_BYTES } from '../../shared/pictures';
import { realPlaceAsync } from './contained';
import { contentTypeOf, handleMediaRequest, mediaRequestOf, type MediaProtocolDeps } from './media-protocol';

type DisplaySourceDeps = Pick<MediaProtocolDeps, 'mediaDir' | 'lookup'> & {
  /** The private Session's native file fetch; its exact response is relayed without a Main byte pump. */
  fetchFile?: (url: string, init: RequestInit) => Promise<Response>;
};

const refused = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** Only the granted original, streamed in this worker's own Session with the producer's byte bound. */
export async function handleDisplaySourceRequest(
  request: Request,
  deps: DisplaySourceDeps,
): Promise<Response> {
  const asked = mediaRequestOf(request.url);
  if (asked?.what !== 'media') return refused();
  if (deps.fetchFile && request.method === 'GET' && !request.headers.has('Range')) {
    const granted = deps.lookup(asked.mediaId);
    if (!granted || granted.missing || !granted.path || isAbsolute(granted.path)) return refused();
    const current = () => {
      const found = deps.lookup(asked.mediaId);
      return (
        found !== null && !found.missing && found.path === granted.path && found.sha256 === granted.sha256
      );
    };
    const place = await realPlaceAsync(deps.mediaDir, join(deps.mediaDir, granted.path));
    if (!place?.inside) return refused();
    const file = await stat(place.path).catch(() => null);
    if (
      !file?.isFile() ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      file.size > MAX_DISPLAY_SOURCE_BYTES ||
      !current()
    ) {
      return refused();
    }
    let response: Response;
    try {
      response = await deps.fetchFile(pathToFileURL(place.path).href, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      return refused();
    }
    const advertised = response.headers.get('Content-Length');
    if (
      !current() ||
      response.status !== 200 ||
      !response.body ||
      response.bodyUsed ||
      response.body.locked ||
      (advertised !== null && (!/^\d+$/u.test(advertised) || Number(advertised) !== file.size))
    ) {
      await response.body?.cancel().catch(() => undefined);
      return refused();
    }
    response.headers.set('Content-Length', String(file.size));
    response.headers.set('Content-Type', contentTypeOf(place.path));
    response.headers.set('Accept-Ranges', 'bytes');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'no-store');
    // Electron's protocol.handle can relay an untouched Session.fetch response natively.
    // Replacing, cloning, reading or locking this body would restore the Main-process byte pump.
    return response;
  }
  const response = await handleMediaRequest(request, deps);
  response.headers.set('Cache-Control', 'no-store');
  if (response.ok) {
    const range = response.headers.get('Content-Range');
    const total =
      range === null ? Number(response.headers.get('Content-Length')) : Number(/\/(\d+)$/u.exec(range)?.[1]);
    const length = Number(response.headers.get('Content-Length'));
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
  return response;
}
