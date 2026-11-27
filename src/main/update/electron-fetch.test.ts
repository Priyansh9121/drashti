import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import type { ClientRequestConstructorOptions, Net } from 'electron';
import { expect, it, vi } from 'vitest';
import { checkedUpdateFetch, type UpdateFetch } from './checked-fetch';
import { electronUpdateFetch } from './electron-fetch';

const root = 'https://github.com/o/r/releases/latest/download/drashti-update.json';
const version = 'https://github.com/o/r/releases/download/v9/drashti-update.json';
const asset = 'https://release-assets.githubusercontent.com/placeholder';
const options = () => ({
  headers: { Range: 'bytes=4-' },
  packaged: true,
  base: 'https://github.com/o/r/releases',
  signal: new AbortController().signal,
});
type Reply = { status: number; location?: string; body?: Buffer; stream?: Readable };

/** Electron 44 emits redirect instead of a response, then cancels when it was not followed synchronously. */
function transport(replies: Record<string, Reply>) {
  const requests: { options: ClientRequestConstructorOptions; request: EventEmitter; aborted: boolean }[] =
    [];
  const fetch = vi.fn<UpdateFetch>().mockRejectedValue(new Error('Redirect was cancelled'));
  const request = vi.fn((options: ClientRequestConstructorOptions) => {
    const entry = { options, request: new EventEmitter(), aborted: false };
    requests.push(entry);
    const reply = replies[options.url ?? ''];
    const response = reply?.stream ?? Readable.from([reply?.body ?? Buffer.from('placeholder')]);
    const req = Object.assign(entry.request, {
      abort: () => {
        if (entry.aborted) return;
        entry.aborted = true;
        response.destroy();
        req.emit('abort');
        req.emit('close');
      },
      end: () => {
        queueMicrotask(() => {
          const reply = replies[options.url ?? ''];
          if (!reply) throw new Error('Unexpected test destination');
          if (reply.location) {
            req.emit('redirect', reply.status, 'GET', reply.location, { location: [reply.location] });
            if (!entry.aborted) {
              req.emit('error', new Error('Redirect was cancelled'));
              req.emit('close');
            }
          } else {
            Object.assign(response, { statusCode: reply.status, statusMessage: 'OK', headers: {} });
            response.once('end', () => req.emit('close'));
            req.emit('response', response);
          }
        });
      },
    });
    return req;
  });
  return { net: { fetch, request } as unknown as Pick<Net, 'fetch' | 'request'>, requests };
}

it('U01 review: Electron redirect events complete approved GitHub and CDN hops with Range intact', async () => {
  const t = transport({
    [root]: { status: 302, location: version },
    [version]: { status: 302, location: asset },
    [asset]: { status: 206, body: Buffer.from('checked placeholder bytes') },
  });
  const response = await checkedUpdateFetch(electronUpdateFetch(t.net), root, options());
  expect(response.status).toBe(206);
  expect(await response.text()).toBe('checked placeholder bytes');
  expect(t.requests.map((r) => r.options.url)).toEqual([root, version, asset]);
  for (const r of t.requests) {
    expect(r.options.redirect).toBe('manual');
    expect(r.options.credentials).toBe('omit');
    expect(r.options.headers).toEqual({ Range: 'bytes=4-' });
  }
  expect(t.requests.slice(0, 2).every((r) => r.aborted)).toBe(true);
});

it('U01 review: a later Electron redirect is refused before its prohibited destination is contacted', async () => {
  const t = transport({
    [root]: { status: 302, location: asset },
    [asset]: { status: 302, location: 'http://127.0.0.1/private' },
  });
  await expect(checkedUpdateFetch(electronUpdateFetch(t.net), root, options())).rejects.toThrow('Refused');
  expect(t.requests.map((r) => r.options.url)).toEqual([root, asset]);
  expect(t.requests.every((r) => r.aborted)).toBe(true);
});

it('U01 review: Electron redirect loops still stop at the five-hop limit', async () => {
  const t = transport({ [root]: { status: 302, location: root } });
  await expect(checkedUpdateFetch(electronUpdateFetch(t.net), root, options())).rejects.toThrow('redirects');
  expect(t.requests).toHaveLength(6);
  expect(t.requests.every((r) => r.aborted)).toBe(true);
});

it('U01 review: cancellation after headers aborts Chromium and rejects an unfinished download body', async () => {
  const stream = new PassThrough();
  const t = transport({ [root]: { status: 200, stream } });
  const abort = new AbortController();
  const response = await checkedUpdateFetch(electronUpdateFetch(t.net), root, {
    ...options(),
    signal: abort.signal,
  });
  const body = response.text();
  abort.abort();
  await expect(body).rejects.toThrow('aborted');
  expect(t.requests[0]?.aborted).toBe(true);
});

it('U01 review: cancelling an unread body closes the Chromium transaction', async () => {
  const t = transport({ [root]: { status: 200, stream: new PassThrough() } });
  const response = await checkedUpdateFetch(electronUpdateFetch(t.net), root, options());
  await response.body?.cancel();
  expect(t.requests[0]?.aborted).toBe(true);
});

it('U01 review: a truncated Chromium response rejects instead of yielding a complete body', async () => {
  const stream = new PassThrough();
  const t = transport({ [root]: { status: 200, stream } });
  const response = await checkedUpdateFetch(electronUpdateFetch(t.net), root, options());
  const body = response.text();
  stream.destroy(new Error('upstream reset'));
  await expect(body).rejects.toThrow('upstream reset');
});

it.each([204, 205, 304])(
  'U01 review: an empty HTTP %s response does not throw from an event callback',
  async (status) => {
    const t = transport({ [root]: { status } });
    const response = await checkedUpdateFetch(electronUpdateFetch(t.net), root, options());
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(t.requests[0]?.aborted).toBe(true);
  },
);
