import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { UpdateManifest } from '../../src/shared/updates';

/* A release server on this computer for the update tests and screenshots: made-up files, never a real installer. */

export interface Release {
  base: string;
  served: () => number;
  close: () => void;
}

/** GitHub Releases' paths: the newest at /latest/download/, a version at /download/v<version>/. */
export async function releaseServer(versions: Record<string, Buffer>, latest: string): Promise<Release> {
  let served = 0;
  const kind = process.platform === 'win32' ? 'nsis' : 'zip';
  const nameOf = (v: string) => (kind === 'nsis' ? `Drashti-${v}-setup-x64.exe` : `Drashti-${v}-mac.zip`);
  const manifestOf = (base: string, v: string): UpdateManifest => {
    const body = versions[v] ?? Buffer.alloc(0);
    return {
      app: 'drashti',
      version: v,
      releasedAt: '2026-10-06T00:00:00Z',
      notes: `Placeholder notes for ${v}.`,
      source: `${base}/tag/v${v}`,
      files: [
        {
          platform: process.platform === 'win32' ? 'win32' : 'darwin',
          arch: process.arch === 'arm64' ? 'arm64' : 'x64',
          kind,
          name: nameOf(v),
          url: `${base}/download/v${v}/${nameOf(v)}`,
          size: body.length,
          sha512: createHash('sha512').update(body).digest('base64'),
        },
      ],
    };
  };
  const server: Server = createServer((req, res) => {
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const url = req.url ?? '';
    const manifest = /^\/(?:latest\/download|download\/v([^/]+))\/drashti-update\.json$/u.exec(url);
    if (manifest) {
      const v = manifest[1] ?? latest;
      if (!versions[v]) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(manifestOf(base, v)));
      return;
    }
    const file = /^\/download\/v([^/]+)\/([^/]+)$/u.exec(url);
    const body = file ? versions[file[1] ?? ''] : undefined;
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    const range = /bytes=(\d+)-/u.exec(req.headers.range ?? '');
    const from = range ? Number(range[1]) : 0;
    res.writeHead(range ? 206 : 200, { 'content-length': body.length - from });
    served += body.length - from;
    res.end(body.subarray(from));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    served: () => served,
    close: () => {
      server.close();
    },
  };
}
