import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { plainAddress } from '../network/addresses';

/*
 * When the computer's network comes back (Session 55, the owner's decision of 29 Oct 2026: after he joined a hotspot,
 * the No internet bar took 15–20 s to go). The access service asks the list at once then, rather than at its next
 * 15 s check (service.ts, networkBack), and gives up a check still waiting on the old network.
 *
 * How it is told, all in the main process, so it works before any window is open and needs nothing from a page:
 * - every 2 s, Electron's net.isOnline() (Chromium's own view: false once the computer has no network at all) and the
 *   computer's addresses (Node's networkInterfaces, without loopback and link-local ones): back once it was offline
 *   and is online again, or once it is on a network it was not on (Wi-Fi to a hotspot, with no moment offline);
 * - the computer waking from sleep (powerMonitor's resume), when its network is often new.
 * Each is only a hint: the service asks the list only while it has had no answer, and never twice within 5 s, so a
 * network coming and going many times a second never floods the list. Reading the two costs well under a millisecond.
 */

/** The network as the computer has it now. */
export interface NetworkNow {
  /** Whether it has a network at all (Electron's net.isOnline(): false is a strong sign of none). */
  online: boolean;
  /** Its addresses on the networks it is on: no loopback, no link-local address. */
  addresses: readonly string[];
}

/** How often the network is looked at. */
export const NETWORK_LOOK_EVERY_MS = 2_000;

/** A link-local address (169.254.x.x, fe80::/10): one a computer gives itself with no network to speak of. */
function linkLocal(address: string): boolean {
  const a = plainAddress(address);
  if (isIP(a) === 4) return a.startsWith('169.254.');
  if (isIP(a) === 6) {
    const head = a.split(':')[0] ?? '';
    const first = head === '' ? 0 : parseInt(head, 16);
    return (first & 0xffc0) === 0xfe80;
  }
  return false;
}

/** This computer's addresses on its networks, as networkInterfaces() gives them (no loopback or link-local one). */
export function networkAddresses(nics: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(nics))
    for (const nic of list ?? []) {
      if (nic.internal || linkLocal(nic.address)) continue;
      out.push(plainAddress(nic.address));
    }
  return out;
}

/**
 * Tests only (DRASHTI_TEST_NETWORK_FILE, which a packaged Drashti never reads): the network as a file says it, so an
 * end-to-end test can take it away and bring it back. Its first word is `online` or `offline`; an online network's
 * addresses follow. A file that cannot be read is no reading at all (it throws, and the look is skipped).
 */
export function networkFromFile(path: string): NetworkNow {
  const words = readFileSync(path, 'utf8').trim().split(/\s+/u);
  return words[0] === 'online'
    ? { online: true, addresses: words.slice(1) }
    : { online: false, addresses: [] };
}

export interface NetworkWatchOptions {
  /** The network now (it may throw: that look is skipped). */
  read: () => NetworkNow;
  /** Run `run` every `ms`; what it returns stops it. */
  every: (ms: number, run: () => void) => () => void;
  /** Hear the computer wake from sleep; what it returns stops hearing. */
  onResume: (run: () => void) => () => void;
  /** The network came back, and why it is thought so (for the log). */
  back: (why: string) => void;
}

/** Watch the network from now on; what it returns stops watching. */
export function watchNetwork(o: NetworkWatchOptions): () => void {
  let last: { online: boolean; key: string } | null = null;
  const look = () => {
    let now: NetworkNow;
    try {
      now = o.read();
    } catch {
      return;
    }
    const key = [...new Set(now.addresses)].sort().join(' ');
    const was = last;
    last = { online: now.online, key };
    if (was === null || !now.online) return;
    if (!was.online) o.back('the computer is online again');
    else if (key !== '' && key !== was.key) o.back('the computer is on another network');
  };
  look();
  const stopLooking = o.every(NETWORK_LOOK_EVERY_MS, look);
  const stopHearing = o.onResume(() => {
    look();
    o.back('the computer woke from sleep');
  });
  return () => {
    stopLooking();
    stopHearing();
  };
}
