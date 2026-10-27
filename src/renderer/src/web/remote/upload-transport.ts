import type { UploadStatus } from '../../../../shared/phone-files';
import { api, current, toPairing } from '../device';
import type { Answer, Transport } from './upload-client';

/*
 * How this page sends a file to Drashti (Session 54, D4; docs/api.md "Files"): the requests that begin one, ask how
 * it stands and cancel it go as every request does (device.ts); each piece goes with XMLHttpRequest, which says how
 * much of it has gone as it goes (a progress bar that moves within a piece), and stops at once when cancelled.
 */

const UNREACHABLE = 'Drashti cannot be reached. Check this phone is on the same Wi-Fi.';

/** A piece's own wait for its answer: a slow Wi-Fi gets smaller pieces after one that runs out. */
const PIECE_WITHIN_MS = 60_000;

function sendPiece(
  id: string,
  offset: number,
  bytes: Blob,
  sent: (bytes: number) => void,
  signal: AbortSignal,
): Promise<Answer<{ upload: UploadStatus }>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/uploads/${encodeURIComponent(id)}/piece?offset=${String(offset)}`);
    const token = current()?.token;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.timeout = PIECE_WITHIN_MS;
    xhr.upload.onprogress = (e) => {
      sent(e.loaded);
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        // An answer without JSON.
      }
      // A pairing Drashti no longer knows goes back to pairing, as every other request does.
      if (xhr.status === 401 && token) toPairing();
      if (xhr.status >= 200 && xhr.status < 300 && body['ok'] === true) {
        resolve({ ok: true, upload: body['upload'] as UploadStatus });
        return;
      }
      resolve({
        ok: false,
        status: xhr.status,
        message:
          typeof body['message'] === 'string' ? body['message'] : `Drashti said no (${String(xhr.status)}).`,
        ...(body['upload'] ? { upload: body['upload'] as UploadStatus } : {}),
      });
    };
    const unreached = () => {
      resolve({ ok: false, status: 0, message: UNREACHABLE });
    };
    xhr.onerror = unreached;
    xhr.ontimeout = unreached;
    xhr.onabort = unreached;
    if (signal.aborted) {
      unreached();
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        xhr.abort();
      },
      { once: true },
    );
    xhr.send(bytes);
  });
}

export const deviceTransport: Transport = {
  begin: (name, size) =>
    api<{ upload: UploadStatus; pieces: { first: number; max: number } }>('/api/v1/uploads', {
      method: 'POST',
      body: { name, size },
    }),
  piece: sendPiece,
  status: (id) => api<{ upload: UploadStatus }>(`/api/v1/uploads/${encodeURIComponent(id)}`),
  cancel: (id) =>
    api<{ upload: UploadStatus }>(`/api/v1/uploads/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
};
