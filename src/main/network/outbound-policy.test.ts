import { expect, it, vi } from 'vitest';
import { authorize, OutboundPolicy, publicAddress } from './outbound-policy';

it.each([
  '0.0.0.0',
  '10.1.2.3',
  '100.64.0.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '192.0.0.1',
  '192.0.2.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  '::ffff:a00:1',
  'fc00::1',
  'fe80::1',
  'ff02::1',
  '64:ff9b::a00:1',
  '2001:db8::1',
  '2002:7f00:1::',
  '3fff::1',
])('SECNET-03: refuses derived special destination %s', (ip) => {
  expect(publicAddress(ip)).toBe(false);
});
it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:808:808'])(
  'SECNET-03: permits global unicast %s',
  (ip) => expect(publicAddress(ip)).toBe(true),
);

it('SECNET-03: checks every DNS answer and pins the explicitly authorized origin across rebinding', async () => {
  const resolve = vi
    .fn()
    .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    .mockResolvedValue([
      { address: '8.8.4.4', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
  const authority = await authorize('http://typed.example/live.m3u8', resolve);
  const policy = new OutboundPolicy(authority, false, resolve);
  expect(await policy.target('http://typed.example/a.ts')).toMatchObject({ ip: '8.8.8.8' });
  expect(resolve).toHaveBeenCalledTimes(1);
  await expect(policy.target('http://derived.example/sub.m3u8')).rejects.toThrow('private');
  expect(resolve).toHaveBeenCalledTimes(2);
  await expect(policy.target('http://user:pass@typed.example/a')).rejects.toThrow();
  await expect(policy.target('file:///tmp/placeholder')).rejects.toThrow();
});
it('SECNET-03: a later private DNS answer cannot replace a derived public target', async () => {
  const resolve = vi
    .fn()
    .mockResolvedValueOnce([{ address: '8.8.4.4', family: 4 }])
    .mockResolvedValue([{ address: '::ffff:127.0.0.1', family: 6 }]);
  const policy = new OutboundPolicy(
    { origin: 'https://typed.example', addresses: [{ address: '8.8.8.8', family: 4 }] },
    false,
    resolve,
  );
  expect(await policy.target('https://derived.example/a.ts')).toMatchObject({ ip: '8.8.4.4' });
  await expect(policy.target('https://derived.example/b.ts')).rejects.toThrow('private');
});
