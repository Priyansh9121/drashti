import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { fetchPlaylist, requirePublicPlaylist } from './fetch-playlist';
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});
async function serve(handler: RequestListener) {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
it('SECNET-03: a typed LAN link cannot redirect to a different local service', async () => {
  let prohibited = 0;
  const sink = await serve((_req, res) => {
    prohibited++;
    res.end('#EXTM3U\n');
  });
  const root = await serve((_req, res) => {
    res.writeHead(302, { Location: `${sink}/private` });
    res.end();
  });
  const got = await fetchPlaylist(`${root}/live.m3u8`, {
    guard: false,
    signal: new AbortController().signal,
  });
  expect(prohibited).toBe(0);
  expect(got.ok).toBe(false);
});
it('SECNET-03: an explicitly typed LAN playlist and same-origin redirects still work', async () => {
  const root = await serve((req, res) => {
    if (req.url === '/live.m3u8') {
      res.writeHead(302, { Location: '/actual.m3u8' });
      res.end();
    } else res.end('#EXTM3U\n#EXTINF:1,\nsegment.ts\n');
  });
  expect(
    await fetchPlaylist(`${root}/live.m3u8`, { guard: false, signal: new AbortController().signal }),
  ).toMatchObject({ ok: true, url: `${root}/actual.m3u8` });
});

it('SECNET-03: a public-content URL cannot authorize its own LAN destination', async () => {
  let contacted = 0;
  const root = await serve((_req, res) => {
    contacted++;
    res.end('#EXTM3U\n');
  });
  const signal = new AbortController().signal;
  requirePublicPlaylist(signal);
  expect((await fetchPlaylist(`${root}/derived.m3u8`, { guard: false, signal })).ok).toBe(false);
  expect(contacted).toBe(0);
});
