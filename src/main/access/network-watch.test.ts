import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NETWORK_LOOK_EVERY_MS,
  type NetworkNow,
  networkAddresses,
  networkFromFile,
  watchNetwork,
} from './network-watch';

/*
 * When the computer's network comes back (Session 55, network-watch.ts): told from net.isOnline() and the computer's
 * addresses every 2 s, and from the computer waking. Placeholder addresses only (documentation ranges).
 */

/** A watch on a network the test changes, its looks run by the test. */
function watched(first: NetworkNow) {
  let now: NetworkNow | Error = first;
  let look: (() => void) | null = null;
  let resume: (() => void) | null = null;
  const said: string[] = [];
  const stop = watchNetwork({
    read: () => {
      if (now instanceof Error) throw now;
      return now;
    },
    every: (ms, run) => {
      expect(ms).toBe(NETWORK_LOOK_EVERY_MS);
      look = run;
      return () => {
        look = null;
      };
    },
    onResume: (run) => {
      resume = run;
      return () => {
        resume = null;
      };
    },
    back: (why) => said.push(why),
  });
  return {
    said,
    stop,
    /** The network changes, and the next look sees it. */
    becomes(next: NetworkNow | Error) {
      now = next;
      look?.();
    },
    wake() {
      resume?.();
    },
    get watching() {
      return look !== null || resume !== null;
    },
  };
}

const ONLINE = (...addresses: string[]): NetworkNow => ({ online: true, addresses });
const OFFLINE: NetworkNow = { online: false, addresses: [] };

describe('the network coming back', () => {
  it('is told once the computer is online again after none', () => {
    const w = watched(ONLINE('192.0.2.10'));
    w.becomes(OFFLINE);
    w.becomes(OFFLINE);
    expect(w.said).toEqual([]);
    w.becomes(ONLINE('198.51.100.7'));
    expect(w.said).toEqual(['the computer is online again']);
    // Online and on the same network: nothing more.
    w.becomes(ONLINE('198.51.100.7'));
    expect(w.said).toHaveLength(1);
  });

  it('is told when the computer moves to another network with no moment offline (Wi-Fi to a hotspot)', () => {
    const w = watched(ONLINE('192.0.2.10', '2001:db8::10'));
    // The same addresses in another order: the same network.
    w.becomes(ONLINE('2001:db8::10', '192.0.2.10'));
    expect(w.said).toEqual([]);
    w.becomes(ONLINE('172.20.10.2'));
    expect(w.said).toEqual(['the computer is on another network']);
    // Its addresses gone, still online by Chromium's view: no network to speak of, so nothing is told.
    w.becomes(ONLINE());
    expect(w.said).toHaveLength(1);
    // Then one comes: told.
    w.becomes(ONLINE('172.20.10.3'));
    expect(w.said).toHaveLength(2);
  });

  it('is told when the computer wakes from sleep', () => {
    const w = watched(ONLINE('192.0.2.10'));
    w.wake();
    expect(w.said).toEqual(['the computer woke from sleep']);
  });

  it('a reading that fails is skipped, never thrown; stopped, it looks no more', () => {
    const w = watched(OFFLINE);
    w.becomes(new Error('placeholder: no reading'));
    expect(w.said).toEqual([]);
    w.becomes(ONLINE('192.0.2.10'));
    expect(w.said).toEqual(['the computer is online again']);
    w.stop();
    expect(w.watching).toBe(false);
  });

  it('nothing is told at the first look, whatever the network', () => {
    expect(watched(ONLINE('192.0.2.10')).said).toEqual([]);
    expect(watched(OFFLINE).said).toEqual([]);
  });
});

describe('the computer’s addresses', () => {
  it('leave out loopback and link-local ones', () => {
    const nic = (address: string, family: 'IPv4' | 'IPv6', internal = false) => ({
      address,
      family,
      internal,
      netmask: '',
      mac: '00:00:00:00:00:00',
      cidr: null,
      ...(family === 'IPv6' ? { scopeid: 0 } : {}),
    });
    expect(
      networkAddresses({
        lo0: [nic('127.0.0.1', 'IPv4', true), nic('::1', 'IPv6', true)],
        en0: [nic('192.0.2.10', 'IPv4'), nic('fe80::1%en0', 'IPv6'), nic('2001:db8::10', 'IPv6')],
        bridge0: [nic('169.254.10.20', 'IPv4')],
      } as unknown as Parameters<typeof networkAddresses>[0]),
    ).toEqual(['192.0.2.10', '2001:db8::10']);
  });
});

describe('the tests’ network file (DRASHTI_TEST_NETWORK_FILE)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('says online with its addresses, or offline; a missing file throws (that look is skipped)', () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-network-file-'));
    const file = join(dir, 'network.txt');
    expect(() => networkFromFile(file)).toThrow();
    writeFileSync(file, 'online 192.0.2.10 2001:db8::10\n');
    expect(networkFromFile(file)).toEqual({ online: true, addresses: ['192.0.2.10', '2001:db8::10'] });
    writeFileSync(file, 'offline\n');
    expect(networkFromFile(file)).toEqual({ online: false, addresses: [] });
  });
});
