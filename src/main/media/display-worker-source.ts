import { handleMediaRequest, type MediaProtocolDeps } from './media-protocol';

/** Private display-worker Session; the narrower source contract is established by its red tests. */
export function handleDisplaySourceRequest(
  request: Request,
  deps: Pick<MediaProtocolDeps, 'mediaDir' | 'lookup'>,
): Promise<Response> {
  return handleMediaRequest(request, deps);
}
