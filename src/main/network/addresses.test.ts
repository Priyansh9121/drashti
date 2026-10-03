import { describe, expect, it } from 'vitest';
import {
  allowedHostNames,
  hostAllowed,
  isLocalAddress,
  isLoopback,
  originAllowed,
  parseAuthority,
  plainAddress,
} from './addresses';

describe('who may reach the network server', () => {
  it('lets in this computer and the private ranges, never the internet', () => {
    for (const a of [
      '127.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.20',
      '::ffff:192.168.1.20',
      '169.254.10.10',
      'fd12:3456::1',
      'fe80::1%en0',
    ])
      expect(isLocalAddress(a), a).toBe(true);
    for (const a of [
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '100.64.0.1',
      '::ffff:8.8.8.8',
      '2001:db8::1',
      '',
      'not an address',
      '192.168.1.300',
    ])
      expect(isLocalAddress(a), a).toBe(false);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(plainAddress('[FE80::1%en0]')).toBe('fe80::1');
  });

  it('answers only to its own addresses and name on its own port (no DNS rebinding)', () => {
    const allowed = allowedHostNames(['192.168.1.20', 'fe80::1'], 'Mandir-Mac.local');
    expect(hostAllowed('192.168.1.20:8740', 8740, allowed)).toBe(true);
    expect(hostAllowed('mandir-mac.local:8740', 8740, allowed)).toBe(true);
    expect(hostAllowed('localhost:8740', 8740, allowed)).toBe(true);
    expect(hostAllowed('[fe80::1]:8740', 8740, allowed)).toBe(true);
    // Another port, a name pointing here from elsewhere, nothing at all.
    expect(hostAllowed('192.168.1.20:8080', 8740, allowed)).toBe(false);
    expect(hostAllowed('192.168.1.20', 8740, allowed)).toBe(false);
    expect(hostAllowed('attacker.example:8740', 8740, allowed)).toBe(false);
    expect(hostAllowed('192.168.1.21:8740', 8740, allowed)).toBe(false);
    expect(hostAllowed(undefined, 8740, allowed)).toBe(false);
    expect(hostAllowed('192.168.1.20:8740/../x', 8740, allowed)).toBe(false);
    expect(parseAuthority('[::1]:80')).toEqual({ host: '::1', port: 80 });
  });

  it('takes browser pages only from its own origin', () => {
    expect(originAllowed('http://192.168.1.20:8740', '192.168.1.20:8740')).toBe(true);
    expect(originAllowed(undefined, '192.168.1.20:8740')).toBe(true);
    expect(originAllowed('http://attacker.example', '192.168.1.20:8740')).toBe(false);
    expect(originAllowed('https://192.168.1.20:8740', '192.168.1.20:8740')).toBe(false);
    expect(originAllowed('null', '192.168.1.20:8740')).toBe(false);
  });
});
