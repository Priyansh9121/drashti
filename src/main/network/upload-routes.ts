import type { IncomingMessage } from 'node:http';
import type { DeviceAuth, DeviceOp } from '../../shared/network-api';
import { UPLOAD_ID_PATTERN } from '../../shared/phone-files';
import type { ServerHost } from './server';
import { type UploadAnswer, Uploads } from './uploads';
import { apiQuery } from './web-files';

/*
 * The API's requests for files between Drashti and a phone (Session 54, D3 and D4; docs/api.md "Files"), as the
 * network server takes them. A shared playlist and its items are read by the main process, as a playlist's are;
 * a file a phone adds is taken here, in the network's own process (uploads.ts), its bytes never passing through
 * the main process. Remote devices only (shared/network-api.ts DEVICE_OPS).
 */

interface UploadRoute {
  method: 'GET' | 'POST';
  path: string;
  op: DeviceOp;
  args?: (body: Record<string, unknown>, params: Record<string, string>) => unknown;
  param?: RegExp;
}

export const UPLOAD_ROUTES: readonly UploadRoute[] = [
  { method: 'GET', path: '/api/v1/shared', op: 'shared' },
  {
    method: 'GET',
    path: '/api/v1/shared/:id/items',
    op: 'shared.items',
    args: (_b, p) => ({ playlistId: p['id'] }),
  },
  { method: 'GET', path: '/api/v1/uploads', op: 'uploads' },
  { method: 'POST', path: '/api/v1/uploads', op: 'upload' },
  { method: 'GET', path: '/api/v1/uploads/:id', op: 'upload.status', param: UPLOAD_ID_PATTERN },
  { method: 'POST', path: '/api/v1/uploads/:id/piece', op: 'upload.piece', param: UPLOAD_ID_PATTERN },
  { method: 'POST', path: '/api/v1/uploads/:id/cancel', op: 'upload.cancel', param: UPLOAD_ID_PATTERN },
];

/** A piece of a file (POST /api/v1/uploads/{id}/piece), which counts apart from every other request. */
export const isPiece = (method: string | undefined, segments: readonly string[]): boolean =>
  method === 'POST' &&
  segments.length === 5 &&
  segments[0] === 'api' &&
  segments[1] === 'v1' &&
  segments[2] === 'uploads' &&
  segments[4] === 'piece';

/** The uploads the server takes, in the uploads folder of the media folder; none without one. */
export function uploadsAt(
  where: { dir: string; mediaDir: string } | undefined,
  host: Pick<ServerHost, 'arrived' | 'log'>,
): Uploads | null {
  if (!where) return null;
  const uploads = new Uploads({
    dir: where.dir,
    mediaDir: where.mediaDir,
    arrived: (file) => {
      host.arrived?.(file);
    },
    log: (level, message) => {
      host.log(level, message);
    },
  });
  void uploads.start();
  return uploads;
}

const UPLOAD_OPS = new Set<DeviceOp>(['uploads', 'upload', 'upload.status', 'upload.piece', 'upload.cancel']);

/** What an upload's request gets, answered here; null for every other request (the main process answers those). */
export async function uploadAnswer(
  uploads: Uploads | null,
  op: DeviceOp,
  req: IncomingMessage,
  device: DeviceAuth,
  params: Record<string, string>,
  readBody: () => Promise<Record<string, unknown>>,
): Promise<UploadAnswer | null> {
  if (!UPLOAD_OPS.has(op)) return null;
  if (!uploads) {
    req.resume();
    return op === 'uploads'
      ? { status: 200, body: { ok: true, adding: { on: false, maxBytes: 0 }, uploads: [] } }
      : { status: 503, body: { ok: false, message: 'Drashti cannot take files from phones here.' } };
  }
  const id = params['id'] ?? '';
  switch (op) {
    case 'uploads':
      return { status: 200, body: { ok: true, adding: uploads.adding(), uploads: uploads.list(device) } };
    case 'upload':
      return uploads.begin(device, await readBody());
    case 'upload.status':
      return uploads.status(device, id);
    case 'upload.cancel':
      req.resume();
      return uploads.cancel(device, id);
    case 'upload.piece': {
      const declared = req.headers['content-length'];
      if (declared === undefined || !/^\d{1,15}$/u.test(declared)) {
        req.resume();
        return { status: 411, body: { ok: false, message: 'Send each piece with its length.' } };
      }
      return uploads.piece(device, id, apiQuery(req.url ?? '')['offset'], {
        length: Number(declared),
        stream: req,
      });
    }
    default:
      return null;
  }
}
