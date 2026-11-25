import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceAnswer, DeviceAuth, DeviceRequest } from '../../shared/network-api';
import { flowPagePng, isPng } from './flow-routes';
import { API_ROUTES, NetworkServer, type ServerHost } from './server';
import { hashToken } from './tokens';

/*
 * Sabha flow on a phone (alpha.23) as the network server takes it: the flow and its Now, and a page as a PNG, each
 * reaching the main process as its op with its arguments (the page's number from the path, the flow's id from the
 * query), from a Remote only, never a Stage device or the announcements poster, and read only (GET). A page comes back
 * as the PNG the main process gave, never as JSON, and only when it is one. On this computer only, with a stand-in for
 * the main process; made-up tokens and ids, and a made-up few bytes for a PNG.
 */

const REMOTE_TOKEN = 'test-made-up-remote-token-flow-00000';
const STAGE_TOKEN = 'test-made-up-stage-token-flow-000000';
const POSTER_TOKEN = 'test-made-up-poster-token-flow-00000';

const devices: DeviceAuth[] = [
  { id: 'd-remote', name: 'Placeholder phone', kind: 'remote', tokenHash: hashToken(REMOTE_TOKEN) },
  { id: 'd-stage', name: 'Placeholder tablet', kind: 'stage', tokenHash: hashToken(STAGE_TOKEN) },
  { id: 'd-poster', name: 'Announcements poster', kind: 'announcements', tokenHash: hashToken(POSTER_TOKEN) },
];

/** A PNG's signature and a few made-up bytes after it: enough for the server, which only passes it on. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const FLOW_ID = 'flow-placeholder-0001';

let dir = '';
let server: NetworkServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start(answer: (r: DeviceRequest) => DeviceAnswer) {
  dir = mkdtempSync(join(tmpdir(), 'drashti-flow-routes-'));
  mkdirSync(join(dir, 'web', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'web', 'remote.html'), '<!doctype html><title>remote</title>');
  const requests: DeviceRequest[] = [];
  const host: ServerHost = {
    request: (r) => {
      requests.push(r);
      return Promise.resolve(answer(r));
    },
    pair: () => Promise.resolve({ ok: false, status: 403, message: 'No.' }),
    mediaSource: () => Promise.resolve(null),
    connected: () => undefined,
    seen: () => undefined,
    resync: () => undefined,
    log: () => undefined,
  };
  server = new NetworkServer(host);
  server.setLetIn(true);
  const started = await server.start({
    port: 0,
    bind: '127.0.0.1',
    webDir: join(dir, 'web'),
    ffmpeg: null,
    previewDir: join(dir, 'previews'),
    localName: null,
  });
  if (!started.ok) throw new Error(started.message);
  server.setDevices(devices);
  return { port: started.port, requests };
}

interface Got {
  status: number;
  type: string;
  body: Buffer;
}

function call(port: number, path: string, token: string, method = 'GET'): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}` },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(parts),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const ok = (body: Record<string, unknown> = {}): DeviceAnswer => ({ status: 200, body: { ok: true, ...body } });

/** Each request, and what the main process is asked: the op and its arguments. */
const ASKED: [path: string, op: string, args: unknown][] = [
  ['/api/v1/flow', 'flow', {}],
  [`/api/v1/flow/pages/0?flow=${FLOW_ID}`, 'flow.page', { page: '0', flowId: FLOW_ID }],
  [`/api/v1/flow/pages/12?flow=${FLOW_ID}`, 'flow.page', { page: '12', flowId: FLOW_ID }],
  // No flow named: the main process is asked, and refuses it (flow-answers.ts).
  ['/api/v1/flow/pages/1', 'flow.page', { page: '1', flowId: undefined }],
];

describe('Sabha flow on a phone (alpha.23): the network server', () => {
  it('takes the flow and a page to the main process as their ops, the page from the path and the flow from the query', async () => {
    const { port, requests } = await start((r) => (r.op === 'flow.page' ? ok({ png: PNG }) : ok()));
    for (const [path, op, args] of ASKED) {
      expect((await call(port, path, REMOTE_TOKEN)).status, path).toBe(200);
      expect(requests.at(-1), path).toEqual({ deviceId: 'd-remote', op, args, address: '127.0.0.1' });
    }
  });

  it('refuses them to a Stage device and to the announcements poster, takes them only by GET, and a page only by its number', async () => {
    const { port, requests } = await start(() => ok());
    for (const [path] of ASKED) {
      expect((await call(port, path, STAGE_TOKEN)).status, path).toBe(403);
      expect((await call(port, path, POSTER_TOKEN)).status, path).toBe(403);
      expect((await call(port, path, REMOTE_TOKEN, 'POST')).status, path).toBe(405);
    }
    for (const page of ['-1', 'one', '1000', '1.5'])
      expect((await call(port, `/api/v1/flow/pages/${page}?flow=${FLOW_ID}`, REMOTE_TOKEN)).status, page).toBe(
        404,
      );
    expect(requests).toEqual([]);
  });

  it('answers the flow as JSON, and a page as the PNG the main process gave', async () => {
    const snapshot = { flow: null, state: null };
    const { port } = await start((r) => (r.op === 'flow.page' ? ok({ png: PNG }) : ok(snapshot)));
    const flow = await call(port, '/api/v1/flow', REMOTE_TOKEN);
    expect(flow.type).toMatch(/^application\/json/u);
    expect(JSON.parse(flow.body.toString('utf8'))).toEqual({ ok: true, ...snapshot });
    const page = await call(port, `/api/v1/flow/pages/0?flow=${FLOW_ID}`, REMOTE_TOKEN);
    expect(page.status).toBe(200);
    expect(page.type).toBe('image/png');
    expect([...page.body]).toEqual([...PNG]);
  });

  it('passes on the main process’s refusal of a page as it is, and never answers bytes that are not a PNG', async () => {
    let answer: DeviceAnswer = {
      status: 409,
      body: { ok: false, message: 'The Sabha flow changed on the Drashti computer.' },
    };
    const { port } = await start(() => answer);
    const refused = await call(port, `/api/v1/flow/pages/0?flow=${FLOW_ID}`, REMOTE_TOKEN);
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body.toString('utf8'))).toEqual(answer.body);
    answer = ok({ png: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    const wrong = await call(port, `/api/v1/flow/pages/0?flow=${FLOW_ID}`, REMOTE_TOKEN);
    expect(wrong.status).toBe(500);
    expect(wrong.type).toMatch(/^application\/json/u);
  });

  it('are each in the API’s list, which the documentation is checked against', () => {
    expect(API_ROUTES).toContain('GET /api/v1/flow');
    expect(API_ROUTES).toContain('GET /api/v1/flow/pages/:page');
  });

  it('knows a PNG by its signature', () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(Buffer.from(PNG))).toBe(true);
    expect(isPng(PNG.slice(0, 8))).toBe(false);
    expect(isPng(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(isPng('not bytes')).toBe(false);
    expect(flowPagePng({ ok: true, png: PNG })).toBe(PNG);
    expect(flowPagePng({ ok: true })).toBeNull();
    expect(flowPagePng(null)).toBeNull();
  });
});
