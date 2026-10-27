import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type IncomingMessage, request } from 'node:http';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { STOPPED_REFUSAL } from '../../shared/access';
import { EngineMirror } from '../../shared/engine/mirror';
import type { EngineMessage, EngineSnapshotMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { ToDevice } from '../../shared/network';
import type { DeviceAuth, DeviceRequest } from '../../shared/network-api';
import { NetworkServer, type ServerHost, SOCKET_LIMITS } from './server';
import { hashToken } from './tokens';

/*
 * The network server on this computer only, with a stand-in for the main
 * process, and made-up tokens.
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

let dir = '';
let server: NetworkServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface Fake extends ServerHost {
  requests: DeviceRequest[];
  connectedNow: string[];
  resyncs: number;
}

function fakeHost(): Fake {
  const host: Fake = {
    requests: [],
    connectedNow: [],
    resyncs: 0,
    request: (r) => {
      host.requests.push(r);
      return Promise.resolve({ status: 200, body: { ok: true, op: r.op } });
    },
    pair: (code) =>
      Promise.resolve(
        code === '123456'
          ? {
              ok: true as const,
              token: 'test-made-up-new-token-000000000000',
              device: {
                id: 'd-new',
                name: 'Placeholder new phone',
                kind: 'remote' as const,
                tokenHash: hashToken('test-made-up-new-token-000000000000'),
              },
            }
          : { ok: false as const, status: 403, message: 'That code is wrong or has expired.' },
      ),
    mediaSource: () => Promise.resolve(null),
    connected: (ids) => {
      host.connectedNow = ids;
    },
    seen: () => undefined,
    resync: () => {
      host.resyncs++;
    },
    log: () => undefined,
  };
  return host;
}

async function start(
  options: { refuseLoopback?: boolean; sockets?: { total: number; perAddress: number } } = {},
) {
  dir = mkdtempSync(join(tmpdir(), 'drashti-net-'));
  mkdirSync(join(dir, 'web', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'web', 'pair.html'), '<!doctype html><title>pair</title>');
  writeFileSync(join(dir, 'web', 'remote.html'), '<!doctype html><title>remote</title>');
  writeFileSync(join(dir, 'web', 'assets', 'remote-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, 'drashti.sqlite'), 'the library');
  const host = fakeHost();
  server = new NetworkServer(host);
  const started = await server.start({
    port: 0,
    bind: '127.0.0.1',
    webDir: join(dir, 'web'),
    ffmpeg: null,
    previewDir: join(dir, 'previews'),
    localName: null,
    refuseLoopback: options.refuseLoopback,
    ...(options.sockets ? { sockets: options.sockets } : {}),
  });
  if (!started.ok) throw new Error(started.message);
  server.setDevices(devices);
  // Let in (Session 54): the main process says so as it starts the server.
  server.setLetIn(true);
  return { host, port: started.port, server };
}

function call(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: { Host: `127.0.0.1:${port}`, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function feed(
  port: number,
  headers: Record<string, string> = {},
): Promise<{ ws: WebSocket; messages: ToDevice[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/feed`, { headers });
    const messages: ToDevice[] = [];
    ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString('utf8')) as ToDevice));
    ws.on('open', () => {
      resolve({ ws, messages });
    });
    ws.on('error', reject);
  });
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const snapshot = (rev: number): EngineMessage => ({
  kind: 'snapshot',
  version: ENGINE_STATE_VERSION,
  rev,
  state: initialEngineState(),
  sentAt: Date.now(),
});

/** A raw connection from this computer, and whether the server has closed it (a moment after connecting). */
function socketTo(port: number): Promise<{ socket: Socket; closed: () => boolean }> {
  return new Promise((resolve, reject) => {
    let closed = false;
    const socket = connect(port, '127.0.0.1', () => {
      resolve({ socket, closed: () => closed });
    });
    socket.on('close', () => {
      closed = true;
    });
    socket.on('error', () => {
      closed = true;
    });
    socket.once('error', reject);
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('connections at once (Sessions 31–36, SEC-11)', () => {
  it('closes at once the one too many from an address', async () => {
    const { port } = await start({ sockets: { total: 50, perAddress: 3 } });
    const open = await Promise.all([socketTo(port), socketTo(port), socketTo(port)]);
    const extra = await socketTo(port);
    await settle();
    expect(open.map((o) => o.closed())).toEqual([false, false, false]);
    expect(extra.closed()).toBe(true);
    // One closed: room again.
    open[0].socket.destroy();
    await settle();
    const again = await socketTo(port);
    await settle();
    expect(again.closed()).toBe(false);
    for (const o of [...open, again]) o.socket.destroy();
  });

  it('closes at once the one too many in all', async () => {
    const { port } = await start({ sockets: { total: 2, perAddress: 50 } });
    const open = await Promise.all([socketTo(port), socketTo(port)]);
    const extra = await socketTo(port);
    await settle();
    expect(open.map((o) => o.closed())).toEqual([false, false]);
    expect(extra.closed()).toBe(true);
    for (const o of open) o.socket.destroy();
  });

  it('leaves room from one address for 10 feeds and a browser’s page fetches, and the Performance check’s 10 devices', () => {
    // A browser opens up to 6 connections to one address for pages; the Performance check's 10 devices, all
    // from this computer, each keep a feed open and fetch pages.
    expect(SOCKET_LIMITS.perAddress).toBeGreaterThan(10 + 6);
    expect(SOCKET_LIMITS.perAddress).toBeGreaterThanOrEqual(10 * 2);
    expect(SOCKET_LIMITS.total).toBeGreaterThan(100);
  });
});

describe('the network server', () => {
  it('serves the pages, and nothing by a path that escapes', async () => {
    const { port } = await start();
    const page = await call(port, '/remote');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain(`connect-src 'self' ws://127.0.0.1:${port}`);
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect((await call(port, '/assets/remote-abc.js')).headers['cache-control']).toContain('immutable');
    expect((await call(port, '/')).body).toContain('pair');
    for (const path of [
      '/../drashti.sqlite',
      '/assets/../../drashti.sqlite',
      '/assets/%2e%2e/%2e%2e/drashti.sqlite',
      '/assets/..%2f..%2fdrashti.sqlite',
      '/%2e%2e/drashti.sqlite',
    ]) {
      const r = await call(port, path);
      expect(r.status, path).toBe(400);
      expect(r.body).not.toContain('the library');
    }
    expect((await call(port, '/drashti.sqlite')).status).toBe(404);
    expect((await call(port, '/index.html')).status).toBe(404);
  });

  it('refuses a foreign Host, a foreign Origin, and addresses outside the local network', async () => {
    const { port } = await start();
    expect((await call(port, '/remote', { headers: { Host: `attacker.example:${port}` } })).status).toBe(421);
    expect((await call(port, '/remote', { headers: { Host: '127.0.0.1:1' } })).status).toBe(421);
    expect(
      (
        await call(port, '/api/v1/me', {
          headers: { ...bearer(REMOTE_TOKEN), Origin: 'http://attacker.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(port, '/api/v1/me', {
          headers: { ...bearer(REMOTE_TOKEN), Origin: `http://127.0.0.1:${port}` },
        })
      ).status,
    ).toBe(200);
    await expect(feed(port, { Origin: 'http://attacker.example' })).rejects.toThrow(/403/u);
    await expect(feed(port, { Host: `attacker.example:${port}` })).rejects.toThrow(/421/u);
    await server?.stop();
    const outside = await start({ refuseLoopback: true });
    const refused = await call(outside.port, '/remote');
    expect(refused.status).toBe(403);
    expect(refused.body).toContain('Only devices on this local network');
    await expect(feed(outside.port)).rejects.toThrow(/403/u);
  });

  it('needs a token for anything with data, and lets each kind of device do only its own things', async () => {
    const { port, host } = await start();
    const none = await call(port, '/api/v1/me');
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toBe('Bearer');
    expect(
      (await call(port, '/api/v1/me', { headers: bearer('test-made-up-wrong-token-000000000') })).status,
    ).toBe(401);
    expect(JSON.parse((await call(port, '/api/v1/me', { headers: bearer(STAGE_TOKEN) })).body)).toMatchObject(
      {
        device: { kind: 'stage', name: 'Placeholder tablet' },
      },
    );
    // Stage watches; it cannot run the show or read playlists. Announcements only submits.
    expect(
      (await call(port, '/api/v1/trigger/next', { method: 'POST', headers: bearer(STAGE_TOKEN) })).status,
    ).toBe(403);
    expect((await call(port, '/api/v1/playlists', { headers: bearer(STAGE_TOKEN) })).status).toBe(403);
    expect((await call(port, '/api/v1/state', { headers: bearer(ANNOUNCE_TOKEN) })).status).toBe(403);
    expect(
      (await call(port, '/api/v1/trigger/next', { method: 'POST', headers: bearer(ANNOUNCE_TOKEN) })).status,
    ).toBe(403);
    // The remote's request reaches the main process as an op with its arguments.
    const next = await call(port, '/api/v1/trigger/next', { method: 'POST', headers: bearer(REMOTE_TOKEN) });
    expect(next.status).toBe(200);
    // With the address it came from (for the limit on announcements per phone).
    expect(host.requests.at(-1)).toEqual({
      deviceId: 'd-remote',
      op: 'command',
      args: { type: 'next' },
      address: '127.0.0.1',
    });
    await call(port, '/api/v1/trigger/slide', {
      method: 'POST',
      headers: { ...bearer(REMOTE_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ presentationId: 'p1', slideIndex: 2, type: 'clearAll' }),
    });
    expect(host.requests.at(-1)?.args).toEqual({ presentationId: 'p1', slideIndex: 2, type: 'goLive' });
    expect((await call(port, '/api/v1/trigger/next', { headers: bearer(REMOTE_TOKEN) })).status).toBe(405);
    expect((await call(port, '/api/v1/nothing', { headers: bearer(REMOTE_TOKEN) })).status).toBe(404);
    expect(
      (await call(port, '/api/v1/timers/..%2f/start', { method: 'POST', headers: bearer(REMOTE_TOKEN) }))
        .status,
    ).toBe(400);
    // A Shastra passage plays like a presentation: its id (with "/" and "#") comes percent-encoded.
    const passage = 'shastra:pg/ppr#14-16';
    expect(
      (
        await call(port, `/api/v1/presentations/${encodeURIComponent(passage)}`, {
          headers: bearer(REMOTE_TOKEN),
        })
      ).status,
    ).toBe(200);
    expect(host.requests.at(-1)).toMatchObject({ op: 'presentation', args: { presentationId: passage } });
    // Only a passage's own shape, and never a dot segment.
    expect(
      (
        await call(port, `/api/v1/presentations/${encodeURIComponent('shastra:x/../y#1')}`, {
          headers: bearer(REMOTE_TOKEN),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(port, `/api/v1/presentations/${encodeURIComponent('shastra:x y#1')}`, {
          headers: bearer(REMOTE_TOKEN),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(port, `/api/v1/timers/${encodeURIComponent('shastra:pg#1')}/start`, {
          method: 'POST',
          headers: bearer(REMOTE_TOKEN),
        })
      ).status,
    ).toBe(404);
    // The presenter's remote (Session 18): the library a page at a time, and searched, by query string.
    expect(
      (await call(port, '/api/v1/presentations?offset=100&limit=50', { headers: bearer(REMOTE_TOKEN) }))
        .status,
    ).toBe(200);
    expect(host.requests.at(-1)).toMatchObject({
      op: 'presentations',
      args: { offset: '100', limit: '50' },
    });
    expect(
      (await call(port, '/api/v1/search?q=placeholder%20words', { headers: bearer(REMOTE_TOKEN) })).status,
    ).toBe(200);
    expect(host.requests.at(-1)).toMatchObject({ op: 'search', args: { query: 'placeholder words' } });
    expect((await call(port, '/api/v1/search?q=x', { headers: bearer(STAGE_TOKEN) })).status).toBe(403);
    expect(
      (await call(port, '/api/v1/presentations', { method: 'POST', headers: bearer(REMOTE_TOKEN) })).status,
    ).toBe(405);
    const big = await call(port, '/api/v1/announcements', {
      method: 'POST',
      headers: { ...bearer(ANNOUNCE_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(20_000) }),
    });
    expect(big.status).toBe(413);
  });

  // Session 51 (S4-4): a tablet's stage display draws the audience picture box from the same small previews as a
  // remote's live picture, under the same rules (a paired device's token, a media id); an announcements poster none.
  it('takes the time bar’s move, Pause and Play from a remote as the engine’s commands, and none from a stage display (Session 54)', async () => {
    const { port, host } = await start();
    const send = (path: string, token: string, body: unknown) =>
      call(port, path, {
        method: 'POST',
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const playing = { layer: 'slide', mediaId: 'placeholder-video' };
    // Its own words only: a body naming another command is still a move.
    expect(
      (await send('/api/v1/playing/move', REMOTE_TOKEN, { playing, toMs: 61_500, type: 'clearAll' })).status,
    ).toBe(200);
    expect(host.requests.at(-1)?.args).toEqual({ type: 'moveTo', playing, toMs: 61_500 });
    await send('/api/v1/playing/pause', REMOTE_TOKEN, { playing });
    expect(host.requests.at(-1)?.args).toEqual({ type: 'pausePlaying', playing });
    await send('/api/v1/playing/play', REMOTE_TOKEN, { playing });
    expect(host.requests.at(-1)?.args).toEqual({ type: 'resumePlaying', playing });
    const asked = host.requests.length;
    expect((await send('/api/v1/playing/pause', STAGE_TOKEN, { playing })).status).toBe(403);
    expect(host.requests).toHaveLength(asked);
  });

  it('gives a stage display the same small previews as a remote, and an announcements poster none', async () => {
    const { port } = await start();
    const preview = (headers: Record<string, string>) =>
      call(port, '/api/v1/media/placeholder-media/preview', { headers });
    // The stand-in main process knows no media: past the device's kind, there is no such item.
    for (const token of [REMOTE_TOKEN, STAGE_TOKEN]) {
      const answer = await preview(bearer(token));
      expect(answer.status, token).toBe(404);
      expect(answer.body).toContain('There is no such media item.');
    }
    expect((await preview(bearer(ANNOUNCE_TOKEN))).status).toBe(403);
    expect((await preview({})).status).toBe(401);
  });

  it('pairs with the right code, and refuses an address after five wrong ones', async () => {
    const { port } = await start();
    const pair = (code: string) =>
      call(port, '/api/v1/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    const ok = await pair('123 456');
    expect(ok.status).toBe(200);
    const token = (JSON.parse(ok.body) as { token: string }).token;
    expect((await call(port, '/api/v1/me', { headers: bearer(token) })).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await pair('000000')).status).toBe(403);
    // The sixth try in the minute is refused, even with the right code.
    expect((await pair('123456')).status).toBe(429);
  });

  it('sends the whole state, then each change; answers the clock; cuts off a removed device at once', async () => {
    const { port, server: s, host } = await start();
    s.engine(snapshot(5));
    const { ws, messages } = await feed(port);
    ws.send(JSON.stringify({ type: 'hello', token: REMOTE_TOKEN }));
    await until(() => messages.some((m) => m.type === 'engine'));
    expect(messages[0]).toEqual({ type: 'welcome', device: { name: 'Placeholder phone', kind: 'remote' } });
    expect(messages[1]).toMatchObject({ type: 'engine', message: { kind: 'snapshot', rev: 5 } });
    await until(() => host.connectedNow.includes('d-remote'));
    s.engine({
      kind: 'patch',
      version: ENGINE_STATE_VERSION,
      baseRev: 5,
      rev: 6,
      ops: [{ path: ['blackout'], value: true }],
      sentAt: Date.now(),
    });
    await until(() => messages.length === 3);
    expect(messages[2]).toMatchObject({ type: 'engine', message: { kind: 'patch', rev: 6 } });
    // A patch that does not follow on asks the main process for a fresh snapshot.
    s.engine({
      kind: 'patch',
      version: ENGINE_STATE_VERSION,
      baseRev: 9,
      rev: 10,
      ops: [],
      sentAt: Date.now(),
    });
    expect(host.resyncs).toBe(1);
    const t0 = Date.now();
    ws.send(JSON.stringify({ type: 'clock', t0 }));
    await until(() => messages.some((m) => m.type === 'clock'));
    const clock = messages.find((m) => m.type === 'clock');
    expect(clock).toMatchObject({ type: 'clock', t0 });
    expect(Math.abs((clock?.type === 'clock' ? clock.server : 0) - Date.now())).toBeLessThan(1000);
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    s.setDevices(devices.filter((d) => d.id !== 'd-remote'));
    expect(await closed).toBe(4000);
    expect(messages.at(-1)).toEqual({ type: 'bye', reason: 'revoked' });
    await until(() => host.connectedNow.length === 0);
  });

  // Session 53: each run of the engine (Drashti started again after a crash or an update) counts its revisions from
  // 0 again. To a phone's or tablet's page left open over the restart, a snapshot that did not say its run was old
  // news: the page kept the last run's picture, and its Next, sent with the last run's revision, did nothing.
  it('says which run of the engine each snapshot is from: a page left open over a restart follows the new run', async () => {
    const { port, server: s, host } = await start();
    const run = (rev: number, session: string, blackout: boolean): EngineSnapshotMessage => ({
      kind: 'snapshot',
      version: ENGINE_STATE_VERSION,
      rev,
      state: { ...initialEngineState(), blackout },
      sentAt: Date.now(),
      session,
    });
    // The page's copy, as a phone keeps it (web/feed.ts, engine/engine-store.ts).
    const page = new EngineMirror();
    const follow = async () => {
      const f = await feed(port);
      f.ws.send(JSON.stringify({ type: 'hello', token: REMOTE_TOKEN }));
      await until(() => f.messages.some((m) => m.type === 'engine'));
      const first = f.messages.find((m) => m.type === 'engine');
      return { ...f, first, result: first?.type === 'engine' ? page.apply(first.message) : null };
    };
    s.engine(run(57, 'run-1', false));
    const before = await follow();
    expect(before.result).toBe('applied');
    before.ws.close();
    // Drashti starts again: the new run's state, a few revisions in; the page connects again by itself.
    s.engine(run(3, 'run-2', true));
    const after = await follow();
    expect(after.result).toBe('applied');
    expect({ rev: page.rev, session: page.session, blackout: page.state?.blackout }).toEqual({
      rev: 3,
      session: 'run-2',
      blackout: true,
    });
    expect(before.first).toMatchObject({ message: { kind: 'snapshot', rev: 57, session: 'run-1' } });
    expect(after.first).toMatchObject({ message: { kind: 'snapshot', rev: 3, session: 'run-2' } });
    // The whole state asked for again (a revision went missing) says its run too, and so does the API's state.
    after.ws.send(JSON.stringify({ type: 'resync' }));
    await until(() => after.messages.filter((m) => m.type === 'engine').length === 2);
    expect(after.messages.filter((m) => m.type === 'engine').at(-1)).toMatchObject({
      message: { kind: 'snapshot', rev: 3, session: 'run-2' },
    });
    const state = await call(port, '/api/v1/state', { headers: bearer(STAGE_TOKEN) });
    expect(JSON.parse(state.body)).toMatchObject({ ok: true, rev: 3, session: 'run-2' });
    // A phone's Next says the run it saw with the revision: both reach the main process.
    await call(port, '/api/v1/trigger/next', {
      method: 'POST',
      headers: { ...bearer(REMOTE_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: 3, session: 'run-2' }),
    });
    expect(host.requests.at(-1)?.args).toEqual({ type: 'next', rev: 3, session: 'run-2' });
    after.ws.close();
  });

  it('closes a feed that does not say hello with a token, and one from a device that may not watch', async () => {
    const { port } = await start();
    const bad = await feed(port);
    bad.ws.send(JSON.stringify({ type: 'hello', token: 'test-made-up-wrong-token-000000000' }));
    await until(() => bad.messages.some((m) => m.type === 'bye'));
    expect(bad.messages.at(-1)).toEqual({ type: 'bye', reason: 'unauthorized' });
    const poster = await feed(port);
    poster.ws.send(JSON.stringify({ type: 'hello', token: ANNOUNCE_TOKEN }));
    await until(() => poster.messages.some((m) => m.type === 'bye'));
    expect(poster.messages.at(-1)).toEqual({ type: 'bye', reason: 'not-allowed' });
  });
});

describe('full quality for phones and tablets (Session 54, D1 and D2)', () => {
  /** A PNG's headers saying this size, as a stand-in picture in the media folder. */
  function pictureFile(width: number, height: number): string {
    const b = Buffer.alloc(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    b[24] = 8;
    b[25] = 2;
    const file = join(dir, 'placeholder-picture.png');
    writeFileSync(file, b);
    return file;
  }

  const CLIP = 'Placeholder clip bytes. '.repeat(40);

  /** The server, its stand-in main process knowing a picture and a video by these ids. */
  async function withMedia() {
    const started = await start();
    const picture = pictureFile(640, 360);
    const video = join(dir, 'placeholder-clip.mp4');
    writeFileSync(video, CLIP);
    started.host.mediaSource = (mediaId) =>
      Promise.resolve(
        mediaId === 'm-picture'
          ? { path: picture, kind: 'image' as const }
          : mediaId === 'm-video'
            ? { path: video, kind: 'video' as const }
            : null,
      );
    return started;
  }

  it('gives a Remote and a Stage device a picture at the width asked, up to the file itself, and others none', async () => {
    const { port } = await withMedia();
    const picture = (width: string, headers: Record<string, string>) =>
      call(port, `/api/v1/media/m-picture/picture?width=${width}`, { headers });
    for (const token of [REMOTE_TOKEN, STAGE_TOKEN]) {
      // Asked wider than it is (640): the file itself, never made bigger.
      const whole = await picture('1280', bearer(token));
      expect(whole.status, token).toBe(200);
      expect(whole.headers['content-type']).toBe('image/png');
      expect(whole.headers['content-length']).toBe('64');
      expect(whole.headers['x-content-type-options']).toBe('nosniff');
      // Asked smaller: FFmpeg would make it (the tests have none), so not yet; never the 320 preview instead.
      const smaller = await picture('320', bearer(token));
      expect(smaller.status).toBe(503);
      expect(JSON.parse(smaller.body)).toEqual({
        ok: false,
        message: 'That picture is not ready yet: try again in a moment.',
      });
    }
    expect((await picture('1280', bearer(ANNOUNCE_TOKEN))).status).toBe(403);
    expect((await picture('1280', {})).status).toBe(401);
    expect(
      (await call(port, '/api/v1/media/m-nothing/picture?width=640', { headers: bearer(REMOTE_TOKEN) }))
        .status,
    ).toBe(404);
    expect(
      (await call(port, '/api/v1/media/..%2Fm-picture/picture', { headers: bearer(REMOTE_TOKEN) })).status,
    ).toBe(400);
  });

  it('streams a video’s own file to a Remote in pieces, by its token or a link made for it, and to no other kind', async () => {
    const { port } = await withMedia();
    const piece = await call(port, '/api/v1/media/m-video/original', {
      headers: { ...bearer(REMOTE_TOKEN), Range: 'bytes=0-10' },
    });
    expect(piece.status).toBe(206);
    expect(piece.body).toBe(CLIP.slice(0, 11));
    expect(piece.headers['content-range']).toBe(`bytes 0-10/${String(CLIP.length)}`);
    expect(piece.headers['content-type']).toBe('video/mp4');
    expect((await call(port, '/api/v1/media/m-video/original', { headers: bearer(REMOTE_TOKEN) })).body).toBe(
      CLIP,
    );
    // A Stage device draws pictures only; an announcements poster nothing.
    for (const token of [STAGE_TOKEN, ANNOUNCE_TOKEN]) {
      expect((await call(port, '/api/v1/media/m-video/original', { headers: bearer(token) })).status).toBe(
        403,
      );
      expect((await call(port, '/api/v1/media/m-video/link', { headers: bearer(token) })).status).toBe(403);
    }
    // A <video> cannot send the token: the link, made for this device and this file, plays without it.
    const made = await call(port, '/api/v1/media/m-video/link', { headers: bearer(REMOTE_TOKEN) });
    expect(made.status).toBe(200);
    const { url, until } = JSON.parse(made.body) as { url: string; until: string };
    expect(url).toMatch(/^\/api\/v1\/media\/m-video\/original\?link=d-remote\.[0-9a-z]+\.[A-Za-z0-9_-]+$/u);
    expect(Date.parse(until)).toBeGreaterThan(0);
    const played = await call(port, url, { headers: { Range: `bytes=${String(CLIP.length - 4)}-` } });
    expect(played.status).toBe(206);
    expect(played.body).toBe(CLIP.slice(-4));
    // Never for a media item there is none of.
    expect((await call(port, '/api/v1/media/m-nothing/link', { headers: bearer(REMOTE_TOKEN) })).status).toBe(
      404,
    );
  });

  it('refuses a link for another file, with a token beside it, made up, or once its device is removed', async () => {
    const { port, server: s } = await withMedia();
    const made = await call(port, '/api/v1/media/m-video/link', { headers: bearer(REMOTE_TOKEN) });
    const { url } = JSON.parse(made.body) as { url: string };
    const ticket = url.split('link=')[1] ?? '';
    // The picture's address with the video's link; the picture link never made.
    expect((await call(port, `/api/v1/media/m-picture/original?link=${ticket}`)).status).toBe(401);
    // A link is for the original alone: never a picture, nor anything else.
    expect((await call(port, `/api/v1/media/m-video/picture?link=${ticket}`)).status).toBe(401);
    expect((await call(port, `/api/v1/state?link=${ticket}`)).status).toBe(401);
    // With a token it does not belong to, the token decides.
    expect((await call(port, url, { headers: bearer('test-made-up-wrong-token-000000000') })).status).toBe(
      401,
    );
    const [deviceId = '', at = '', signature = ''] = ticket.split('.');
    expect((await call(port, `/api/v1/media/m-video/original?link=d-stage.${at}.${signature}`)).status).toBe(
      401,
    );
    expect(
      (await call(port, `/api/v1/media/m-video/original?link=${deviceId}.${at}.x${signature}`)).status,
    ).toBe(401);
    // The device removed in Drashti: its links stop at once.
    expect((await call(port, url)).status).toBe(200);
    s.setDevices(devices.filter((d) => d.id !== 'd-remote'));
    expect((await call(port, url)).status).toBe(401);
  });

  it('streams a sound’s own file to a Remote only while a playlist shared with phones has it (D3)', async () => {
    const { port, host } = await withMedia();
    const TONE = 'Placeholder tone bytes. '.repeat(20);
    const tone = join(dir, 'placeholder-tone.wav');
    writeFileSync(tone, TONE);
    // The stand-in main process: the sound while its playlist is shared, nothing once it is not.
    let shared = true;
    host.sharedSound = (mediaId) => Promise.resolve(mediaId === 'm-sound' && shared ? tone : null);
    const piece = await call(port, '/api/v1/media/m-sound/original', {
      headers: { ...bearer(REMOTE_TOKEN), Range: 'bytes=0-9' },
    });
    expect(piece.status).toBe(206);
    expect(piece.body).toBe(TONE.slice(0, 10));
    expect(piece.headers['content-type']).toBe('audio/wav');
    // An <audio> cannot send the token either: a link, as a video's.
    const made = await call(port, '/api/v1/media/m-sound/link', { headers: bearer(REMOTE_TOKEN) });
    expect(made.status).toBe(200);
    const { url } = JSON.parse(made.body) as { url: string };
    const rest = await call(port, url, { headers: { Range: 'bytes=10-' } });
    expect(rest.status).toBe(206);
    expect(rest.body).toBe(TONE.slice(10));
    // Never a Stage or Announcements device's, and never a picture of it.
    for (const token of [STAGE_TOKEN, ANNOUNCE_TOKEN])
      expect((await call(port, '/api/v1/media/m-sound/original', { headers: bearer(token) })).status).toBe(
        403,
      );
    expect(
      (await call(port, '/api/v1/media/m-sound/picture?width=640', { headers: bearer(REMOTE_TOKEN) })).status,
    ).toBe(404);
    // Stop Sharing: refused at once, by the token and by the link made while it was shared; no new link.
    shared = false;
    expect(
      (await call(port, '/api/v1/media/m-sound/original', { headers: bearer(REMOTE_TOKEN) })).status,
    ).toBe(404);
    expect((await call(port, url)).status).toBe(404);
    expect((await call(port, '/api/v1/media/m-sound/link', { headers: bearer(REMOTE_TOKEN) })).status).toBe(
      404,
    );
  });

  it('puts a phone’s zoom on the screens, and the screens back to whole, as a Remote’s commands (D2)', async () => {
    const { port, host } = await start();
    const zoom = await call(port, '/api/v1/zoom', {
      method: 'POST',
      headers: { ...bearer(REMOTE_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoom: 2.5, x: 0.25, y: -0.5, type: 'clearAll' }),
    });
    expect(zoom.status).toBe(200);
    expect(host.requests.at(-1)).toMatchObject({
      op: 'command',
      args: { type: 'zoomLive', zoom: 2.5, x: 0.25, y: -0.5 },
    });
    await call(port, '/api/v1/zoom/whole', { method: 'POST', headers: bearer(REMOTE_TOKEN) });
    expect(host.requests.at(-1)).toEqual(
      expect.objectContaining({ op: 'command', args: { type: 'resetLiveZoom' } }),
    );
    expect((await call(port, '/api/v1/zoom', { method: 'POST', headers: bearer(STAGE_TOKEN) })).status).toBe(
      403,
    );
    // With the showing the phone zoomed (D1/D2 review): the engine does nothing when another is up by then.
    const json = { ...bearer(REMOTE_TOKEN), 'Content-Type': 'application/json' };
    await call(port, '/api/v1/zoom', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ zoom: 2, x: 0, y: 0, showing: 'slide:5000' }),
    });
    expect(host.requests.at(-1)?.args).toEqual({
      type: 'zoomLive',
      zoom: 2,
      x: 0,
      y: 0,
      showing: 'slide:5000',
    });
    await call(port, '/api/v1/zoom/whole', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ showing: 'slide:5000' }),
    });
    expect(host.requests.at(-1)?.args).toEqual({ type: 'resetLiveZoom', showing: 'slide:5000' });
  });
});

describe('while Drashti is not let in (Session 54, access by Gmail)', () => {
  it('refuses a feed while not let in, and closes every open feed the moment it stops', async () => {
    const { port, server: s } = await start();
    s.engine(snapshot(1));
    // Let in: a phone follows the show.
    const { ws, messages } = await feed(port);
    ws.send(JSON.stringify({ type: 'hello', token: REMOTE_TOKEN }));
    await until(() => messages.some((m) => m.type === 'engine'));
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    s.setLetIn(false);
    // Told why, and closed: nothing more of the show reaches it.
    await until(() => messages.some((m) => m.type === 'bye'));
    expect(messages.find((m) => m.type === 'bye')).toEqual({ type: 'bye', reason: 'stopped' });
    expect(await closed).toBe(4000);
    // A new feed is refused while Drashti is not let in.
    await expect(feed(port)).rejects.toThrow(/503/u);
    s.setLetIn(true);
    const again = await feed(port);
    again.ws.close();
  });

  it('cuts off a file still being sent the moment Drashti stops, or its device is removed', async () => {
    const { port, host, server: s } = await start();
    // A video's original, far larger than what a connection holds unread.
    const big = join(dir, 'placeholder-big.mp4');
    writeFileSync(big, Buffer.alloc(24 * 1024 * 1024, 7));
    host.mediaSource = (mediaId) =>
      Promise.resolve(mediaId === 'm-video' ? { path: big, kind: 'video' as const } : null);
    /** A <video>'s request for the whole file, read slowly (here: not at all until told). */
    const playing = () => {
      let answer: IncomingMessage | null = null;
      const ended = new Promise<{ complete: boolean; got: number }>((resolve) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: '/api/v1/media/m-video/original',
            headers: { Host: `127.0.0.1:${port}`, ...bearer(REMOTE_TOKEN), Range: 'bytes=0-' },
          },
          (res) => {
            answer = res;
            res.pause();
            let got = 0;
            res.on('data', (c: Buffer) => (got += c.length));
            res.on('error', () => undefined);
            res.on('close', () => {
              resolve({ complete: res.complete, got });
            });
          },
        );
        req.on('error', () => {
          resolve({ complete: false, got: -1 });
        });
        req.end();
      });
      return { ended, started: () => answer !== null, read: () => answer?.resume() };
    };
    const first = playing();
    await until(() => first.started());
    s.setLetIn(false);
    first.read();
    const cut = await first.ended;
    expect(cut.complete).toBe(false);
    expect(cut.got).toBeLessThan(24 * 1024 * 1024);
    // Let in again: a device removed in Drashti has its file cut off too.
    s.setLetIn(true);
    const second = playing();
    await until(() => second.started());
    s.setDevices(devices.filter((d) => d.id !== 'd-remote'));
    second.read();
    expect((await second.ended).complete).toBe(false);
  });

  it('refuses every request, those answered here too: pairing, the state, a command, a preview, a picture, an original, a link, an upload', async () => {
    const started = await start();
    const { port, host, server: s } = started;
    const video = join(dir, 'placeholder-clip.mp4');
    writeFileSync(video, 'Placeholder clip bytes. '.repeat(10));
    host.mediaSource = (mediaId) =>
      Promise.resolve(mediaId === 'm-video' ? { path: video, kind: 'video' as const } : null);
    // A link made while let in: a <video>'s way to the file, without the token.
    const made = await call(port, '/api/v1/media/m-video/link', { headers: bearer(REMOTE_TOKEN) });
    expect(made.status).toBe(200);
    const { url } = JSON.parse(made.body) as { url: string };
    const asked = host.requests.length;
    s.setLetIn(false);
    const json = { 'Content-Type': 'application/json' };
    const refused = [
      await call(port, '/api/v1/pair', { method: 'POST', headers: json, body: '{"code":"123456"}' }),
      await call(port, '/api/v1/me', { headers: bearer(REMOTE_TOKEN) }),
      await call(port, '/api/v1/state', { headers: bearer(STAGE_TOKEN) }),
      await call(port, '/api/v1/status', { headers: bearer(REMOTE_TOKEN) }),
      await call(port, '/api/v1/command', {
        method: 'POST',
        headers: { ...bearer(REMOTE_TOKEN), ...json },
        body: '{"type":"next"}',
      }),
      await call(port, '/api/v1/media/m-video/preview', { headers: bearer(REMOTE_TOKEN) }),
      await call(port, '/api/v1/media/m-video/picture?width=640', { headers: bearer(REMOTE_TOKEN) }),
      await call(port, '/api/v1/media/m-video/original', { headers: bearer(REMOTE_TOKEN) }),
      await call(port, '/api/v1/media/m-video/link', { headers: bearer(REMOTE_TOKEN) }),
      await call(port, url),
      await call(port, '/api/v1/uploads', { headers: bearer(REMOTE_TOKEN) }),
      await call(port, '/api/v1/uploads', {
        method: 'POST',
        headers: { ...bearer(REMOTE_TOKEN), ...json },
        body: '{"name":"placeholder.jpg","bytes":10}',
      }),
    ];
    for (const r of refused) {
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ ok: false, message: STOPPED_REFUSAL });
    }
    // Nothing reached the main process.
    expect(host.requests.length).toBe(asked);
    // The pages themselves still load, to say so.
    expect((await call(port, '/remote')).status).toBe(200);
    // Let in again (as a new start would be): as before.
    s.setLetIn(true);
    expect((await call(port, '/api/v1/me', { headers: bearer(REMOTE_TOKEN) })).status).toBe(200);
  });
});
