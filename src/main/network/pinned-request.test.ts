import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { authorize, OutboundPolicy } from './outbound-policy';
import { openChecked } from './pinned-request';

it('SECNET-03 review: connection fallback tries later pinned answers in the same address family', async () => {
  let host = '';
  const server = createServer((req, res) => {
    host = req.headers.host ?? '';
    res.end('placeholder segment');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://encoder.local:${port}/segment.ts`;
  const resolve = vi.fn().mockResolvedValue([
    { address: '127.0.0.2', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  const policy = new OutboundPolicy(await authorize(url, resolve), false, resolve);
  try {
    const { response } = await openChecked(url, (raw) => policy.target(raw), AbortSignal.timeout(5000));
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('placeholder segment');
    expect(host).toBe(`encoder.local:${port}`);
    expect(resolve).toHaveBeenCalledTimes(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
