import type { Net } from 'electron';
import { Readable } from 'node:stream';
import type { UpdateFetch } from './checked-fetch';

/**
 * One Chromium request per checked hop. Electron 44 net.fetch cancels manual redirects instead of
 * returning a 3xx Response. Surface the request's redirect event, abort that transaction, and let
 * checkedUpdateFetch validate the next URL before it creates another request (including Range).
 */
export function electronUpdateFetch(net: Pick<Net, 'request'>): UpdateFetch {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      init.signal.throwIfAborted();
      const request = net.request({
        url,
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: init.headers,
      });
      let answered = false;
      let responseBody: Readable | null = null;
      const cleanup = () => init.signal.removeEventListener('abort', abort);
      const fail = (error: Error) => {
        cleanup();
        if (!answered) reject(error);
        responseBody?.destroy(error);
      };
      const abort = () => {
        fail(new Error('Update request aborted', { cause: init.signal.reason }));
        request.abort();
      };
      request.on('error', fail);
      // Electron 44 auto-closes its request Writable after end(), before the network response.
      // Keep cancellation until a network error/abort or the response's own completion instead.
      request.once('abort', () => fail(new Error('Update request aborted')));
      request.once('redirect', (status, _method, destination) => {
        try {
          const response = new Response(null, { status, headers: { Location: destination } });
          answered = true;
          cleanup();
          resolve(response);
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Invalid update redirect'));
        }
        // Do not follow here: the caller checks the URL and its remaining hop budget first.
        request.abort();
      });
      request.once('response', (response) => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            for (const part of Array.isArray(value) ? value : [value]) headers.append(name, part);
          }
          if ([204, 205, 304].includes(response.statusCode)) {
            const result = new Response(null, { status: response.statusCode, headers });
            answered = true;
            cleanup();
            resolve(result);
            request.abort();
            return;
          }
          // Electron documents IncomingMessage as a Readable, but its declarations omit that base.
          const readable = response as unknown as Readable;
          responseBody = readable;
          readable.once('end', cleanup);
          readable.once('close', cleanup);
          readable.once('error', cleanup);
          readable.once('aborted', () => readable.destroy(new Error('Update response aborted')));
          const reader = (Readable.toWeb(readable) as ReadableStream<Uint8Array>).getReader();
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const next = await reader.read();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
              } catch (error) {
                controller.error(error);
              }
            },
            async cancel(reason) {
              try {
                await reader.cancel(reason);
              } finally {
                request.abort();
              }
            },
          });
          const result = new Response(body, { status: response.statusCode, headers });
          answered = true;
          resolve(result);
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Invalid update response'));
          request.abort();
        }
      });
      init.signal.addEventListener('abort', abort, { once: true });
      if (init.signal.aborted) abort();
      else request.end();
    });
}
