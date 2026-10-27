import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceAuth, DeviceRequest } from '../../shared/network-api';
import type { ArrivedFile, UploadStatus } from '../../shared/phone-files';
import { NetworkServer, type ServerHost } from './server';
import { hashToken } from './tokens';

/*
 * The API's requests for files between Drashti and a phone (Session 54, D3 and D4), through the real server on
 * this computer: a Remote sends a file in pieces and picks up again after a piece is cut short; a Stage or an
 * Announcements device can neither see what is shared nor add a file; nothing is taken while the switch is off.
 * Made-up tokens and placeholder bytes only.
 */

const REMOTE_TOKEN = 'test-made-up-remote-token-0000000000';
const STAGE_TOKEN = 'test-made-up-stage-token-00000000000';
const ANNOUNCE_TOKEN = 'test-made-up-announce-token-0000000';

const devices: DeviceAuth[] = [
  { id: 'd-remote', name: 'Placeholder phone', kind: 'remote', tokenHash: hashToken(REMOTE_TOKEN) },
  { id: 'd-stage', name: 'Placeholder tablet', kind: 'stage', tokenHash: hashToken(STAGE_TOKEN) },
  {
    id: 'd-announce',
    name: 'Placeholder poster',
    kind: 'announcements',
    tokenHash: hashToken(ANNOUNCE_TOKEN),
  },
];

const ON = { on: true, maxBytes: 2 * 1024 ** 3, reserveBytes: 0, slowed: false };

let dir = '';
let server: NetworkServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start(options: { policyFirst?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'drashti-upload-routes-'));
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'web', 'remote.html'), '<!doctype html><title>remote</title>');
  const mediaDir = join(dir, 'Media');
  mkdirSync(mediaDir);
  const requests: DeviceRequest[] = [];
  const arrived: ArrivedFile[] = [];
  const host: ServerHost = {
    request: (r) => {
      requests.push(r);
      return Promise.resolve({ status: 200, body: { ok: true, op: r.op } });
    },
    pair: () => Promise.resolve({ ok: false as const, status: 403, message: 'No.' }),
    mediaSource: () => Promise.resolve(null),
    connected: () => undefined,
    seen: () => undefined,
    resync: () => undefined,
    log: () => undefined,
    arrived: (file) => {
      arrived.push(file);
    },
  };
  server = new NetworkServer(host);
  // Let in (Session 54): the main process says so as it starts the server.
  server.setLetIn(true);
  // The main process tells the worker before it starts, as it does at each start (network-service.ts).
  if (options.policyFirst) server.setUploadPolicy(ON);
  const started = await server.start({
    port: 0,
    bind: '127.0.0.1',
    webDir: join(dir, 'web'),
    ffmpeg: null,
    previewDir: join(dir, 'previews'),
    localName: null,
    uploads: { dir: join(mediaDir, '.phone-uploads'), mediaDir },
  });
  if (!started.ok) throw new Error(started.message);
  server.setDevices(devices);
  if (!options.policyFirst) server.setUploadPolicy(ON);
  return { port: started.port, requests, arrived, uploadsDir: join(mediaDir, '.phone-uploads') };
}

/** A request; `cut` sends that many bytes of the body, then drops the connection. */
function call(
  port: number,
  path: string,
  options: { method?: string; token?: string; json?: unknown; bytes?: Buffer; cut?: number } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const body = options.json !== undefined ? Buffer.from(JSON.stringify(options.json)) : options.bytes;
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          Host: `127.0.0.1:${String(port)}`,
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.bytes ? { 'Content-Type': 'application/octet-stream' } : {}),
          ...(body ? { 'Content-Length': String(body.length) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          } catch {
            // Not JSON.
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', (error) => {
      if (options.cut !== undefined) resolve({ status: 0, body: {} });
      else reject(error);
    });
    if (body && options.cut !== undefined) {
      req.write(body.subarray(0, options.cut));
      setTimeout(() => {
        req.destroy();
      }, 100);
      return;
    }
    if (body) req.write(body);
    req.end();
  });
}

const picture = (bytes: number) => {
  const b = Buffer.alloc(bytes, 0x5a);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

describe('files between Drashti and a phone, over the API', () => {
  it('a Remote sends a file in pieces, picks up again after one is cut short, and it is handed on whole', async () => {
    const { port, arrived } = await start();
    const bytes = picture(300_000);
    const begun = await call(port, '/api/v1/uploads', {
      method: 'POST',
      token: REMOTE_TOKEN,
      json: { name: 'Placeholder photo.jpg', size: bytes.length },
    });
    expect(begun.status).toBe(201);
    const id = (begun.body['upload'] as UploadStatus).id;
    const first = await call(port, `/api/v1/uploads/${id}/piece?offset=0`, {
      method: 'POST',
      token: REMOTE_TOKEN,
      bytes: bytes.subarray(0, 100_000),
    });
    expect(first.status).toBe(200);
    // The next piece: the connection drops partway.
    await call(port, `/api/v1/uploads/${id}/piece?offset=100000`, {
      method: 'POST',
      token: REMOTE_TOKEN,
      bytes: bytes.subarray(100_000, 200_000),
      cut: 30_000,
    });
    // What Drashti has is what came before the piece cut short.
    const asked = await call(port, `/api/v1/uploads/${id}`, { token: REMOTE_TOKEN });
    expect(asked.body['upload']).toMatchObject({ received: 100_000, state: 'receiving' });
    const rest = await call(port, `/api/v1/uploads/${id}/piece?offset=100000`, {
      method: 'POST',
      token: REMOTE_TOKEN,
      bytes: bytes.subarray(100_000),
    });
    expect(rest.status).toBe(200);
    expect(rest.body['upload']).toMatchObject({ received: 300_000, state: 'importing' });
    expect(arrived.map((a) => [a.deviceId, a.name, a.ext])).toEqual([
      ['d-remote', 'Placeholder photo.jpg', 'jpg'],
    ]);
    expect(readFileSync(arrived[0]?.file ?? '').equals(bytes)).toBe(true);
    server?.uploadOutcome(id, { ok: true, message: 'Added to Drashti.' });
    const listed = await call(port, '/api/v1/uploads', { token: REMOTE_TOKEN });
    expect(listed.body).toMatchObject({
      ok: true,
      adding: { on: true },
      uploads: [{ id, state: 'added', message: 'Added to Drashti.' }],
    });
  });

  it('a piece without its length, or a cancelled file’s, is refused; Cancel leaves nothing', async () => {
    const { port, uploadsDir } = await start();
    const id = (
      (
        await call(port, '/api/v1/uploads', {
          method: 'POST',
          token: REMOTE_TOKEN,
          json: { name: 'Placeholder clip.mp4', size: 5000 },
        })
      ).body['upload'] as UploadStatus
    ).id;
    expect(
      (await call(port, `/api/v1/uploads/${id}/cancel`, { method: 'POST', token: REMOTE_TOKEN })).status,
    ).toBe(200);
    expect(readdirSync(uploadsDir)).toEqual([]);
    const late = await call(port, `/api/v1/uploads/${id}/piece?offset=0`, {
      method: 'POST',
      token: REMOTE_TOKEN,
      bytes: picture(5000),
    });
    expect(late.status).toBe(409);
  });

  it('a Stage or Announcements device can neither see what is shared nor add a file', async () => {
    const { port, requests, uploadsDir } = await start();
    for (const token of [STAGE_TOKEN, ANNOUNCE_TOKEN]) {
      for (const path of ['/api/v1/shared', '/api/v1/shared/p1/items', '/api/v1/uploads'])
        expect((await call(port, path, { token })).status, path).toBe(403);
      const begun = await call(port, '/api/v1/uploads', {
        method: 'POST',
        token,
        json: { name: 'Placeholder photo.jpg', size: 1000 },
      });
      expect(begun.status).toBe(403);
    }
    expect(requests).toEqual([]);
    expect(readdirSync(uploadsDir)).toEqual([]);
    // A Remote reads the shared playlists through the main process, as it reads a playlist.
    expect((await call(port, '/api/v1/shared', { token: REMOTE_TOKEN })).status).toBe(200);
    expect(requests.map((r) => r.op)).toEqual(['shared']);
  });

  it('the word on files from phones given before the server starts holds once it has', async () => {
    const { port } = await start({ policyFirst: true });
    const listed = await call(port, '/api/v1/uploads', { token: REMOTE_TOKEN });
    expect(listed.body['adding']).toEqual({ on: true, maxBytes: ON.maxBytes });
    const begun = await call(port, '/api/v1/uploads', {
      method: 'POST',
      token: REMOTE_TOKEN,
      json: { name: 'Placeholder photo.jpg', size: 1000 },
    });
    expect(begun.status).toBe(201);
  });

  it('nothing is taken while the switch is off, and the phone reads that it is off', async () => {
    const { port } = await start();
    server?.setUploadPolicy({ ...ON, on: false });
    const listed = await call(port, '/api/v1/uploads', { token: REMOTE_TOKEN });
    expect(listed.body['adding']).toEqual({ on: false, maxBytes: ON.maxBytes });
    const begun = await call(port, '/api/v1/uploads', {
      method: 'POST',
      token: REMOTE_TOKEN,
      json: { name: 'Placeholder photo.jpg', size: 1000 },
    });
    expect(begun.status).toBe(403);
  });
});
