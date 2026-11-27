import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { checkedUpdateFetch, updateHopAllowed, type UpdateFetch } from './checked-fetch';
import { downloadFile } from './download';
import { RateGate } from '../rate-gate';

const root = 'https://github.com/o/r/releases/download/v1/placeholder.exe';
const asset = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/placeholder';
const options = () => ({
  headers: {},
  packaged: true,
  base: 'https://github.com/o/r/releases',
  signal: new AbortController().signal,
});

it.each([
  'http://github.com/x',
  'https://localhost/x',
  'https://[::1]/x',
  'https://169.254.169.254/x',
  'https://github.com.attacker.example/x',
  'https://raw.githubusercontent.com/x',
  'https://user:pass@github.com/x',
  'https://github.com:444/x',
])('U01: rejects unapproved hop %s', (url) => expect(updateHopAllowed(url)).toBe(false));
it('U01: follows approved HTTPS release redirects manually and retains Range and SHA-512', async () => {
  const body = Buffer.from('placeholder update file');
  const calls: string[] = [];
  const fetch: UpdateFetch = (url, init) => {
    calls.push(url);
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('omit');
    expect(init.headers['Range']).toBe('bytes=4-');
    return Promise.resolve(
      url === root
        ? new Response(null, { status: 302, headers: { Location: asset } })
        : new Response(body.subarray(4), { status: 206 }),
    );
  };
  const dir = mkdtempSync(join(tmpdir(), 'secnet-update-'));
  const dest = join(dir, 'placeholder.bin');
  writeFileSync(`${dest}.part`, body.subarray(0, 4));
  try {
    await downloadFile({
      url: root,
      dest,
      size: body.length,
      sha512: createHash('sha512').update(body).digest('base64'),
      fetch: (url, init) => checkedUpdateFetch(fetch, url, { ...options(), headers: init.headers }),
      rate: new RateGate(1024 * 1024),
      gate: () => Promise.resolve(),
      cancelled: () => false,
      progress: () => undefined,
    });
    expect(readFileSync(dest)).toEqual(body);
    expect(calls).toEqual([root, asset]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it('U01: checks a later CDN redirect before connecting and cancels the redirect body', async () => {
  const cancelled = vi.fn();
  const contacts: string[] = [];
  const fetch: UpdateFetch = (url) => {
    contacts.push(url);
    const body = new ReadableStream({ cancel: cancelled });
    return Promise.resolve(
      new Response(body, {
        status: 302,
        headers: { Location: url === root ? asset : 'http://127.0.0.1/private' },
      }),
    );
  };
  await expect(checkedUpdateFetch(fetch, root, options())).rejects.toThrow('Refused');
  expect(contacts).toEqual([root, asset]);
  expect(cancelled).toHaveBeenCalledTimes(2);
});
it('U01: stops redirect loops after five hops and respects cancellation', async () => {
  const fetch = vi
    .fn<UpdateFetch>()
    .mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 307, headers: { Location: root } })),
    );
  await expect(checkedUpdateFetch(fetch, root, options())).rejects.toThrow('redirects');
  expect(fetch).toHaveBeenCalledTimes(6);
  const abort = new AbortController();
  abort.abort();
  await expect(checkedUpdateFetch(fetch, root, { ...options(), signal: abort.signal })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(6);
});

it('U01: the overall redirect deadline also bounds an unresponsive transport', async () => {
  vi.useFakeTimers();
  try {
    const pending = checkedUpdateFetch(() => new Promise<Response>(() => undefined), root, options());
    const refused = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await refused;
  } finally {
    vi.useRealTimers();
  }
});
