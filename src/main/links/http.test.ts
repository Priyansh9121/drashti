import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LinkError, nodeGet, openLink, routeFor } from './http';

/*
 * A local server stands in for Dropbox: no test contacts the internet
 * (PLAN §6). The links are made up.
 */

let server: Server | null = null;
const seen: { path: string; host: string | undefined }[] = [];

async function stand(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  seen.length = 0;
  server = createServer((req, res) => {
    seen.push({ path: req.url ?? '', host: req.headers['x-drashti-test-host'] as string | undefined });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

async function closeServer(): Promise<void> {
  const s = server;
  server = null;
  if (s) await new Promise((resolve) => s.close(resolve));
}

afterEach(closeServer);

const LINK = 'https://www.dropbox.com/scl/fi/abc123placeholder/clip.mp4?rlkey=placeholderkey&dl=1';
const signal = () => new AbortController().signal;

describe('routing a request', () => {
  it('goes to the address itself outside the tests', () => {
    expect(routeFor(LINK, null, false)).toEqual({ url: LINK, headers: {} });
  });

  it('goes to the local stand-in in the tests, saying which address it stands for', () => {
    expect(routeFor(LINK, 'http://127.0.0.1:4567', true)).toEqual({
      url: 'http://127.0.0.1:4567/scl/fi/abc123placeholder/clip.mp4?rlkey=placeholderkey&dl=1',
      headers: { 'x-drashti-test-host': 'www.dropbox.com' },
    });
  });

  it('refuses (the test guard) anything but 127.0.0.1 while the guard is on', () => {
    expect(() => routeFor(LINK, null, true)).toThrow(LinkError);
    expect(() => routeFor(LINK, 'http://192.0.2.1:4567', true)).toThrow(/127\.0\.0\.1/u);
    expect(() => routeFor(LINK, 'http://localhost:4567', true)).toThrow(LinkError);
  });
});

describe("following Dropbox's redirects", () => {
  it('follows a redirect to its download address, and returns the file', async () => {
    const origin = await stand((req, res) => {
      if (req.url?.startsWith('/scl/')) {
        res.writeHead(302, {
          Location: 'https://uc0placeholder.dl.dropboxusercontent.com/cd/0/get/token/file',
        });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Length': '5', 'Content-Disposition': 'attachment; filename="clip.mp4"' });
      res.end('hello');
    });
    const reply = await openLink(LINK, nodeGet, { testOrigin: origin, guard: true, signal: signal() });
    expect(reply.status).toBe(200);
    expect(reply.header('content-disposition')).toContain('clip.mp4');
    let body = '';
    for await (const chunk of reply.body()) body += Buffer.from(chunk).toString();
    expect(body).toBe('hello');
    expect(seen).toEqual([
      { path: '/scl/fi/abc123placeholder/clip.mp4?rlkey=placeholderkey&dl=1', host: 'www.dropbox.com' },
      { path: '/cd/0/get/token/file', host: 'uc0placeholder.dl.dropboxusercontent.com' },
    ]);
  });

  it('follows a relative redirect on the same address', async () => {
    const origin = await stand((req, res) => {
      if (req.url?.startsWith('/scl/')) {
        res.writeHead(301, { Location: '/s/raw/clip.mp4' });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end('x');
    });
    const reply = await openLink(LINK, nodeGet, { testOrigin: origin, guard: true, signal: signal() });
    reply.cancel();
    expect(seen.map((s) => s.host)).toEqual(['www.dropbox.com', 'www.dropbox.com']);
  });

  it('stops at a redirect to an address that is not Dropbox’s, or not https', async () => {
    for (const location of ['https://example.net/file', 'http://uc0.dl.dropboxusercontent.com/file']) {
      const origin = await stand((_req, res) => {
        res.writeHead(302, { Location: location });
        res.end();
      });
      await expect(
        openLink(LINK, nodeGet, { testOrigin: origin, guard: true, signal: signal() }),
      ).rejects.toMatchObject({ code: 'host' });
      expect(seen).toHaveLength(1);
      await closeServer();
    }
  });

  it('stops after too many redirects', async () => {
    const origin = await stand((_req, res) => {
      res.writeHead(302, { Location: 'https://www.dropbox.com/scl/fi/again/x?dl=1' });
      res.end();
    });
    await expect(
      openLink(LINK, nodeGet, { testOrigin: origin, guard: true, signal: signal() }),
    ).rejects.toMatchObject({
      code: 'redirects',
    });
  });

  it('says plainly when Dropbox refuses or the link is gone', async () => {
    const origin = await stand((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const error = await openLink(LINK, nodeGet, { testOrigin: origin, guard: true, signal: signal() }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LinkError);
    expect((error as LinkError).message).toMatch(/no longer|new link/u);
    expect((error as LinkError).message).not.toMatch(/404/u);
  });
});
