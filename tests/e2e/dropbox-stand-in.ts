import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/*
 * A local stand-in for Dropbox (Session 25b), so no test contacts the
 * internet (PLAN §6). Drashti, started with DRASHTI_TEST_LINK_ORIGIN, sends
 * every request here instead, with the address it stands for in the
 * x-drashti-test-host header. Links and files are made up:
 *
 * - /scl/fi/<id>/… (a file link): sent on, as Dropbox does, to
 *   https://uc<id>.dl.dropboxusercontent.com/cd/0/get/<id>/file, which serves
 *   the file with its name;
 * - /scl/fo/<id>/… (a folder link): the folder as one zip, with no size up
 *   front, as Dropbox sends one.
 */

export interface StandInFile {
  name: string;
  body: Buffer;
  type: string;
  /** Send it slowly, 64 KB this often (ms): a download still going when a test acts. */
  slowMs?: number;
}

export interface StandIn {
  origin: string;
  /** Every request, in order: its path and the address it stood for. */
  requests: { path: string; host: string }[];
  close(): Promise<void>;
}

export const fileLink = (id: string, name: string): string =>
  `https://www.dropbox.com/scl/fi/${id}/${encodeURIComponent(name)}?rlkey=placeholderkey${id}&dl=0`;
export const folderLink = (id: string): string =>
  `https://www.dropbox.com/scl/fo/${id}/placeholder${id}?rlkey=placeholderkey${id}&dl=0`;

/** Serve these files (by link id) and folders (by link id, each a zip and its name). */
export async function dropboxStandIn(
  files: Record<string, StandInFile>,
  folders: Record<string, StandInFile>,
): Promise<StandIn> {
  const requests: StandIn['requests'] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? '';
    requests.push({ path, host: String(req.headers['x-drashti-test-host'] ?? '') });
    const parts = path.split('?')[0]?.split('/') ?? [];
    const id = parts[3] ?? parts[4] ?? '';
    if (parts[1] === 'scl' && parts[2] === 'fi' && files[id]) {
      res.writeHead(302, { Location: `https://uc${id}.dl.dropboxusercontent.com/cd/0/get/${id}/file` });
      res.end();
      return;
    }
    const fileId = parts[4] ?? '';
    const file = files[fileId];
    if (parts[1] === 'cd' && file) {
      const range = /^bytes=(\d+)-$/u.exec(req.headers.range ?? '');
      const from = range ? Number(range[1]) : 0;
      res.writeHead(range ? 206 : 200, {
        'Content-Type': file.type,
        'Content-Length': String(file.body.length - from),
        'Content-Disposition': `attachment; filename="${file.name}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        ...(range
          ? {
              'Content-Range': `bytes ${String(from)}-${String(file.body.length - 1)}/${String(file.body.length)}`,
            }
          : {}),
      });
      const body = file.body.subarray(from);
      if (!file.slowMs) {
        res.end(body);
        return;
      }
      let at = 0;
      const timer = setInterval(() => {
        if (res.destroyed || at >= body.length) {
          clearInterval(timer);
          res.end();
          return;
        }
        res.write(body.subarray(at, at + 64 * 1024));
        at += 64 * 1024;
      }, file.slowMs);
      res.on('close', () => {
        clearInterval(timer);
      });
      return;
    }
    const folder = folders[id];
    if (parts[1] === 'scl' && parts[2] === 'fo' && folder) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${folder.name}"`,
      });
      res.end(folder.body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
