import { createServer, type Server, type RequestListener } from 'node:http';
import { createServer as secureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { CheckedHls } from './checked-hls';
import { fetchPlaylist } from './fetch-playlist';
import { pinnedRequest, type PinnedRequest } from '../network/pinned-request';
import { makeAuthority } from '../stream/testing/made-up-ca';

const servers: Server[] = [],
  sessions: CheckedHls[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});
async function fixture(handler: RequestListener) {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  return (s.address() as AddressInfo).port;
}
const resolve = (host: string) =>
  Promise.resolve([{ address: host === 'private.example' ? '127.0.0.1' : '8.8.4.4', family: 4 }]);
const localRequest: PinnedRequest = (target, signal, headers) =>
  pinnedRequest({ ...target, ip: '127.0.0.1', family: 4 }, signal, headers);
function session(port: number, request = localRequest) {
  const s = new CheckedHls(
    { origin: `http://public.example:${port}`, addresses: [{ address: '8.8.8.8', family: 4 }] },
    { resolve, request },
  );
  sessions.push(s);
  return s;
}

it('SECNET-03: nested playlists, keys, maps and segments reach only checked pinned targets', async () => {
  const contacts: string[] = [];
  const port = await fixture((req, res) => {
    contacts.push(req.url ?? '');
    if (req.url === '/master.m3u8') res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvariant.m3u8\n');
    else if (req.url === '/variant.m3u8')
      res.end(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nsegment.ts\n',
      );
    else if (req.url === '/key.bin') res.end(Buffer.alloc(16, 7));
    else res.end(Buffer.from('placeholder binary'));
  });
  const pinned: string[] = [];
  const s = session(port, (target, signal, headers) => {
    pinned.push(target.ip);
    return localRequest(target, signal, headers);
  });
  const root = await s.start(`http://public.example:${port}/master.m3u8`);
  const master = await (await fetch(root)).text();
  expect(master).not.toContain('public.example');
  const variant = master.split('\n').find((l) => l.startsWith('http:'));
  if (!variant) throw new Error('Missing rewritten variant');
  const media = await (await fetch(variant)).text();
  const children = [...media.matchAll(/URI="([^"]+)"/gu)].map((m) => m[1] ?? '');
  children.push(media.split('\n').find((l) => l.startsWith('http:')) ?? '');
  expect(children).toHaveLength(3);
  for (const url of children) expect((await fetch(url)).status).toBe(200);
  expect(contacts).toEqual(['/master.m3u8', '/variant.m3u8', '/key.bin', '/init.mp4', '/segment.ts']);
  expect(pinned).toEqual(Array(5).fill('8.8.8.8'));
});

it.each(['variant', 'segment', 'key', 'map', 'part', 'preload', 'rendition', 'audio'])(
  'SECNET-03: refuses private %s before FFmpeg receives its URI',
  async (kind) => {
    let contacts = 0;
    const port = await fixture((_req, res) => {
      contacts++;
      res.end();
    });
    const s = session(port);
    await s.start(`http://public.example:${port}/root.m3u8`);
    const url = `http://private.example:${port}/private`;
    const lines: Record<string, string> = {
      variant: `#EXT-X-STREAM-INF:BANDWIDTH=1\n${url}`,
      segment: `#EXTINF:1,\n${url}`,
      key: `#EXT-X-KEY:METHOD=AES-128,URI="${url}"`,
      map: `#EXT-X-MAP:URI="${url}"`,
      part: `#EXT-X-PART:DURATION=1,URI="${url}"`,
      preload: `#EXT-X-PRELOAD-HINT:TYPE=PART,URI="${url}"`,
      rendition: `#EXT-X-RENDITION-REPORT:URI="${url}"`,
      audio: `#EXT-X-MEDIA:TYPE=AUDIO,URI="${url}"`,
    };
    await expect(
      s.rewrite(`#EXTM3U\n${lines[kind]}\n`, `http://public.example:${port}/root.m3u8`),
    ).rejects.toThrow('private');
    expect(contacts).toBe(0);
  },
);

it('SECNET-03: a segment redirect is checked again and never contacts the local sink', async () => {
  let prohibited = 0;
  const sink = await fixture((_req, res) => {
    prohibited++;
    res.end('private');
  });
  const port = await fixture((req, res) => {
    if (req.url === '/live.m3u8') res.end('#EXTM3U\n#EXTINF:1,\nredirect.ts\n');
    else {
      res.writeHead(302, { Location: `http://127.0.0.1:${sink}/private` });
      res.end();
    }
  });
  const root = await session(port).start(`http://public.example:${port}/live.m3u8`);
  const text = await (await fetch(root)).text();
  const segment = text.split('\n').find((l) => l.startsWith('http:')) ?? '';
  expect((await fetch(segment)).status).toBe(502);
  expect(prohibited).toBe(0);
});

it('SECNET-03: refuses untrusted TLS before reading playlist bytes', async () => {
  const ca = makeAuthority();
  let read = 0;
  const server = secureServer({ cert: ca.certPem, key: ca.keyPem }, (_req, res) => {
    read++;
    res.end('#EXTM3U\n');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/live.m3u8`;
  expect((await fetchPlaylist(url, { guard: true, signal: new AbortController().signal })).ok).toBe(false);
  expect(read).toBe(0);
});

it.each([
  '#EXT-X-DEFINE:NAME="x",VALUE="http://private.example"',
  '#EXT-X-CONTENT-STEERING:SERVER-URI="http://private.example"',
  '#EXT-X-KEY:METHOD=AES-128,URI="file:///placeholder"',
  '#EXTINF:1,\ncrypto+http://private.example/x',
  '#EXT-X-KEY:METHOD=AES-128,URI="{$x}"',
])('SECNET-03: refuses unsupported or non-web HLS indirection', async (line) => {
  const port = await fixture((_req, res) => res.end());
  const s = session(port);
  await s.start(`http://public.example:${port}/live.m3u8`);
  await expect(s.rewrite(`#EXTM3U\n${line}\n`, `http://public.example:${port}/live.m3u8`)).rejects.toThrow();
});
