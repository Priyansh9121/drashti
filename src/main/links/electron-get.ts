import { net } from 'electron';
import type { Get } from './http';

/*
 * One request through Electron's network stack (in the download process):
 * the computer's proxy settings and certificate store, as the update check
 * uses. Redirects are handed back, never followed here (http.ts checks each
 * address first), and no cookies are sent or kept.
 */

const first = (value: string | string[] | undefined): string | null =>
  value === undefined ? null : Array.isArray(value) ? (value[0] ?? null) : value;

export const electronGet: Get = (url, headers, signal) =>
  new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'manual', useSessionCookies: false, credentials: 'omit' });
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
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
    request.on('redirect', (status, _method, redirectUrl, responseHeaders) => {
      if (settled) return;
      settled = true;
      cancel();
      const lower = Object.fromEntries(Object.entries(responseHeaders).map(([k, v]) => [k.toLowerCase(), v]));
      resolve({
        status,
        header: (name) =>
          name.toLowerCase() === 'location' ? redirectUrl : first(lower[name.toLowerCase()]),
        body: () => [],
        cancel,
      });
    });
    request.on('response', (response) => {
      if (settled) return;
      settled = true;
      resolve({
        status: response.statusCode,
        header: (name) => first(response.headers[name.toLowerCase()]),
        body: () => response as unknown as AsyncIterable<Uint8Array>,
        cancel,
      });
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.end();
  });
