import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ChatEvent } from '../../shared/chat';
import { CHAT_API } from '../../shared/chat';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import type { ToDevice } from '../../shared/network';
import type { DeviceAuth, DeviceRequest } from '../../shared/network-api';
import { API_ROUTES, NetworkServer, type ServerHost } from './server';
import { hashToken } from './tokens';

/*
 * The chat through the phone server (alpha.23, QA23-CHAT-1): its three requests go to the main process as ops, by
 * the existing token check; the feed carries each chat event to the devices in the chat that follow it, and never
 * the show to a chat phone. On this computer only, with made-up tokens and placeholder words.
 */

const T = {
  remote: 'test-made-up-remote-token-chat-00000',
  stage: 'test-made-up-stage-token-chat-000000',
  announce: 'test-made-up-announce-token-chat-000',
  poster: 'test-made-up-poster-token-chat-00000',
  chat: 'test-made-up-chat-token-chat-0000000',
};

const devices: DeviceAuth[] = [
  { id: 'd-remote', name: 'Placeholder phone', kind: 'remote', tokenHash: hashToken(T.remote) },
  { id: 'd-stage', name: 'Placeholder tablet', kind: 'stage', tokenHash: hashToken(T.stage) },
  { id: 'd-announce', name: 'Placeholder sender', kind: 'announcements', tokenHash: hashToken(T.announce) },
  {
    id: 'd-poster',
    name: 'Announcements poster',
    kind: 'announcements',
    tokenHash: hashToken(T.poster),
    poster: true,
  },
  { id: 'd-chat', name: 'Chat 1', kind: 'chat', tokenHash: hashToken(T.chat) },
];

let dir = '';
let server: NetworkServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start() {
  dir = mkdtempSync(join(tmpdir(), 'drashti-net-chat-'));
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'web', 'pair.html'), '<!doctype html><title>pair</title>');
  const requests: DeviceRequest[] = [];
  const host: ServerHost = {
    request: (r) => {
      requests.push(r);
      return Promise.resolve({ status: 200, body: { ok: true, op: r.op } });
    },
    pair: () =>
      Promise.resolve({ ok: false as const, status: 403, message: 'That code is wrong or has expired.' }),
    mediaSource: () => Promise.resolve(null),
    connected: () => undefined,
    seen: () => undefined,
    resync: () => undefined,
    log: () => undefined,
  };
  server = new NetworkServer(host);
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
  server.setLetIn(true);
  return { port: started.port, server, requests };
}

function call(
  port: number,
  path: string,
  options: { method?: string; token?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          Host: `127.0.0.1:${port}`,
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/** A feed that has said hello: its messages as they come, and whether it closed. */
async function feed(port: number, hello: Record<string, unknown>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/feed`, { headers: {} });
  const messages: ToDevice[] = [];
  let closed = false;
  ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString('utf8')) as ToDevice));
  ws.on('close', () => {
    closed = true;
  });
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      resolve();
    });
    ws.on('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello', ...hello }));
  return { ws, messages, closed: () => closed };
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

const message: ChatEvent = {
  kind: 'message',
  message: {
    id: 'm-1',
    at: '2026-11-25T10:00:00.000Z',
    from: { id: 'd-remote', name: 'Person 1' },
    text: 'Placeholder <b>words</b>',
  },
};

describe('the chat through the phone server', () => {
  it('has its three requests, as docs/api.md writes them', () => {
    expect(API_ROUTES).toEqual(
      expect.arrayContaining([`GET ${CHAT_API.read}`, `POST ${CHAT_API.name}`, `POST ${CHAT_API.send}`]),
    );
  });

  it('hands each request to the main process as an op, for the devices in the chat; others are refused here', async () => {
    const { port, requests } = await start();
    for (const token of [T.remote, T.announce, T.chat]) {
      expect((await call(port, CHAT_API.read, { token })).status).toBe(200);
      expect(
        (await call(port, CHAT_API.name, { method: 'POST', token, body: JSON.stringify({ name: 'Person' }) }))
          .status,
      ).toBe(200);
      expect(
        (
          await call(port, CHAT_API.send, {
            method: 'POST',
            token,
            body: JSON.stringify({ text: 'Placeholder' }),
          })
        ).status,
      ).toBe(200);
    }
    expect(requests.map((r) => [r.deviceId, r.op])).toEqual([
      ['d-remote', 'chat'],
      ['d-remote', 'chat.name'],
      ['d-remote', 'chat.send'],
      ['d-announce', 'chat'],
      ['d-announce', 'chat.name'],
      ['d-announce', 'chat.send'],
      ['d-chat', 'chat'],
      ['d-chat', 'chat.name'],
      ['d-chat', 'chat.send'],
    ]);
    expect(requests[2]?.args).toEqual({ text: 'Placeholder' });
    expect(requests[1]?.args).toEqual({ name: 'Person' });
    // A Stage device is never in the chat; no token, no chat.
    expect((await call(port, CHAT_API.read, { token: T.stage })).status).toBe(403);
    expect((await call(port, CHAT_API.read)).status).toBe(401);
    expect(requests).toHaveLength(9);
  });

  it('lets a chat phone do nothing else: not the show, not the state, not the library', async () => {
    const { port, requests } = await start();
    const me = await call(port, '/api/v1/me', { token: T.chat });
    expect(JSON.parse(me.body)).toMatchObject({ device: { kind: 'chat', name: 'Chat 1' } });
    for (const [method, path] of [
      ['GET', '/api/v1/state'],
      ['GET', '/api/v1/status'],
      ['GET', '/api/v1/playlists'],
      ['POST', '/api/v1/trigger/next'],
      ['POST', '/api/v1/announcements'],
    ] as const)
      expect((await call(port, path, { method, token: T.chat })).status, path).toBe(403);
    expect(requests).toEqual([]);
  });

  it('a chat phone’s feed: welcome, the clock and the chat; never the show', async () => {
    const { port, server: s } = await start();
    s.engine({
      kind: 'snapshot',
      version: ENGINE_STATE_VERSION,
      rev: 3,
      state: initialEngineState(),
      sentAt: Date.now(),
    });
    const chat = await feed(port, { token: T.chat });
    await until(() => chat.messages.some((m) => m.type === 'welcome'));
    expect(chat.messages[0]).toEqual({ type: 'welcome', device: { name: 'Chat 1', kind: 'chat' } });
    s.engine({
      kind: 'patch',
      version: ENGINE_STATE_VERSION,
      baseRev: 3,
      rev: 4,
      ops: [{ path: ['blackout'], value: true }],
      sentAt: Date.now(),
    });
    s.hint('playlists');
    s.chat(message);
    await until(() => chat.messages.some((m) => m.type === 'chat'));
    await settle();
    expect(chat.messages.map((m) => m.type)).toEqual(['welcome', 'chat']);
    expect(chat.messages[1]).toEqual({ type: 'chat', event: message });
    expect(chat.closed()).toBe(false);
  });

  it('sends each chat event to the pages that follow the chat, of devices in it; never to a Stage device or the poster', async () => {
    const { port, server: s } = await start();
    const remote = await feed(port, { token: T.remote, chat: true });
    const remoteNoChat = await feed(port, { token: T.remote });
    const announce = await feed(port, { token: T.announce, chat: true });
    const chat = await feed(port, { token: T.chat });
    const stage = await feed(port, { token: T.stage, chat: true });
    await until(() =>
      [remote, remoteNoChat, announce, chat, stage].every((f) =>
        f.messages.some((m) => m.type === 'welcome'),
      ),
    );
    s.chat(message);
    s.chat({ kind: 'cleared', day: '2026-11-25' });
    await until(() =>
      [remote, announce, chat].every((f) => f.messages.filter((m) => m.type === 'chat').length === 2),
    );
    await settle();
    for (const f of [remote, announce, chat])
      expect(f.messages.filter((m) => m.type === 'chat')).toEqual([
        { type: 'chat', event: message },
        { type: 'chat', event: { kind: 'cleared', day: '2026-11-25' } },
      ]);
    for (const f of [remoteNoChat, stage]) expect(f.messages.some((m) => m.type === 'chat')).toBe(false);
    // The poster link may never follow anything, and an Announcements device only the chat.
    const poster = await feed(port, { token: T.poster, chat: true });
    await until(() => poster.messages.some((m) => m.type === 'bye'));
    expect(poster.messages.at(-1)).toEqual({ type: 'bye', reason: 'not-allowed' });
    const announceNoChat = await feed(port, { token: T.announce });
    await until(() => announceNoChat.messages.some((m) => m.type === 'bye'));
    expect(announceNoChat.messages.at(-1)).toEqual({ type: 'bye', reason: 'not-allowed' });
    expect(announce.messages.some((m) => m.type === 'engine')).toBe(false);
  });

  it('cuts a removed chat phone off at once', async () => {
    const { port, server: s } = await start();
    const chat = await feed(port, { token: T.chat });
    await until(() => chat.messages.some((m) => m.type === 'welcome'));
    s.setDevices(devices.filter((d) => d.id !== 'd-chat'));
    await until(() => chat.closed());
    expect(chat.messages.at(-1)).toEqual({ type: 'bye', reason: 'revoked' });
    expect((await call(port, CHAT_API.read, { token: T.chat })).status).toBe(401);
    s.chat(message);
    await settle();
    expect(chat.messages.some((m) => m.type === 'chat')).toBe(false);
  });
});
