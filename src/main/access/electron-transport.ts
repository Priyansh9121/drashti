import { net } from 'electron';
import type { AccessTransport } from './client';

/*
 * The access list's requests through Electron's network stack (Session 54, E1): the computer's proxy
 * settings and certificate store, as the update check uses. A redirect is handed back, never followed here
 * (client.ts checks each address first), and no cookies are sent or kept.
 */

const first = (value: string | string[] | undefined): string | null =>
  value === undefined ? null : Array.isArray(value) ? (value[0] ?? null) : value;

export const electronTransport: AccessTransport = ({ method, url, body, signal }) =>
  new Promise((resolve, reject) => {
    const request = net.request({
      method,
      url,
      redirect: 'manual',
      useSessionCookies: false,
      credentials: 'omit',
    });
    let settled = false;
    const cancel = () => {
      try {
        request.abort();
      } catch {
        // Already finished.
      }
    };
    const onAbort = () => {
      cancel();
      if (!settled) {
        settled = true;
        reject(new Error('aborted'));
      }
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    request.on('redirect', (status, _method, redirectUrl) => {
      if (settled) return;
      settled = true;
      cancel();
      resolve({ status, location: redirectUrl, text: () => Promise.resolve(''), cancel });
    });
    request.on('response', (response) => {
      if (settled) return;
      settled = true;
      resolve({
        status: response.statusCode,
        location: first(response.headers['location']),
        cancel,
        text: (maxChars) =>
          new Promise((done, fail) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > maxChars) {
                cancel();
                fail(new Error('The answer is too long.'));
                return;
              }
              chunks.push(chunk);
            });
            response.on('end', () => {
              done(Buffer.concat(chunks).toString('utf8'));
            });
            response.on('error', fail);
            signal.addEventListener('abort', () => {
              fail(new Error('aborted'));
            });
          }),
      });
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    if (body !== null) {
      request.setHeader('content-type', 'application/json');
      request.write(body);
    }
    request.end();
  });
