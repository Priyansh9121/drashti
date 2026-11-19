import { net } from 'electron';
import type { GoogleTransport } from './google-transport';

/*
 * Drashti's requests to Google through Electron's network stack (x31): the computer's proxy settings and certificate
 * store, as the access list's and the update check's. A redirect is an answer in itself, never followed (Google's
 * token and API endpoints answer without one), and no cookies are sent or kept.
 *
 * In a session of their own that lives in memory only (a partition without "persist:"), and never stored in any
 * cache: an answer can carry a stream key (liveStreams' cdn.ingestionInfo) or a token, and Chromium's disk cache
 * would otherwise keep a GET's answer in the data folder.
 */

/** In memory only: no disk cache, no cookies, nothing of it written to the data folder. */
const PARTITION = 'drashti-google';

export const electronGoogleTransport: GoogleTransport = ({ method, url, headers, body, signal }) =>
  new Promise((resolve, reject) => {
    const request = net.request({
      method,
      url,
      partition: PARTITION,
      cache: 'no-store',
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
    request.on('redirect', (status) => {
      if (settled) return;
      settled = true;
      cancel();
      resolve({ status, text: () => Promise.resolve('') });
    });
    request.on('response', (response) => {
      if (settled) return;
      settled = true;
      resolve({
        status: response.statusCode,
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
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
    if (body !== null) request.write(body);
    request.end();
  });
