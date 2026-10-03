import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

/*
 * Who may talk to Drashti's network server, by address (the security model
 * in README "The local network"):
 *
 * - only from this computer, or from private and link-local addresses
 *   (192.168.x.x, 10.x.x.x, 172.16-31.x.x, 169.254.x.x; IPv6 unique-local
 *   and link-local): never from the internet;
 * - only when asked for by one of this computer's own addresses or its
 *   local name in the Host header, so a web page from elsewhere cannot use
 *   a name that points here (DNS rebinding);
 * - from a browser page only when that page came from Drashti (Origin).
 */

/** An address without an IPv4-mapped IPv6 prefix or an IPv6 zone (fe80::1%en0). */
export function plainAddress(address: string): string {
  let a = address.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (a.startsWith('::ffff:') && isIP(a.slice(7)) === 4) a = a.slice(7);
  return a;
}

function ipv4Parts(a: string): number[] | null {
  if (isIP(a) !== 4) return null;
  return a.split('.').map(Number);
}

/** This computer itself (127.x.x.x, ::1). */
export function isLoopback(address: string): boolean {
  const a = plainAddress(address);
  const v4 = ipv4Parts(a);
  if (v4) return v4[0] === 127;
  return a === '::1';
}

/** A private, link-local or loopback address: on this computer or the local network, never the internet. */
export function isLocalAddress(address: string): boolean {
  const a = plainAddress(address);
  const v4 = ipv4Parts(a);
  if (v4) {
    const [p0 = -1, p1 = -1] = v4;
    return (
      p0 === 10 ||
      p0 === 127 ||
      (p0 === 172 && p1 >= 16 && p1 <= 31) ||
      (p0 === 192 && p1 === 168) ||
      (p0 === 169 && p1 === 254)
    );
  }
  if (isIP(a) === 6) {
    if (a === '::1') return true;
    const head = a.split(':')[0] ?? '';
    const first = head === '' ? 0 : parseInt(head, 16);
    // fc00::/7 unique local, fe80::/10 link-local.
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

/** This computer's addresses on its local networks (not loopback), IPv4 first. */
export function localInterfaceAddresses(): string[] {
  const v4: string[] = [];
  const v6: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.internal) continue;
      if (!isLocalAddress(nic.address)) continue;
      if (nic.family === 'IPv4') v4.push(nic.address);
      else v6.push(plainAddress(nic.address));
    }
  }
  return [...new Set(v4), ...new Set(v6)];
}

/** The host names and addresses a request may name in its Host header (lower case, no port). */
export function allowedHostNames(interfaces: readonly string[], localName: string | null): Set<string> {
  const names = new Set(['localhost', '127.0.0.1', '::1']);
  for (const a of interfaces) names.add(plainAddress(a));
  if (localName) names.add(localName.toLowerCase());
  return names;
}

/** The host and port a Host header (or an origin's authority) names; null when it does not parse. */
export function parseAuthority(value: string): { host: string; port: number | null } | null {
  const v = value.trim().toLowerCase();
  if (v === '' || v.length > 300) return null;
  // [IPv6]:port
  const bracket = /^\[([0-9a-f:.%]+)\](?::(\d{1,5}))?$/u.exec(v);
  if (bracket) return { host: plainAddress(bracket[1] ?? ''), port: bracket[2] ? Number(bracket[2]) : null };
  const plain = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/u.exec(v);
  if (!plain) return null;
  return { host: plain[1] ?? '', port: plain[2] ? Number(plain[2]) : null };
}

/** The Host header names this server: one of its own addresses or names, on its port. */
export function hostAllowed(
  hostHeader: string | undefined,
  port: number,
  allowed: ReadonlySet<string>,
): boolean {
  if (!hostHeader) return false;
  const parsed = parseAuthority(hostHeader);
  if (!parsed) return false;
  if ((parsed.port ?? 80) !== port) return false;
  return allowed.has(parsed.host);
}

/**
 * A browser page's Origin is Drashti's own (same scheme, host and port as
 * the request). Requests without one (curl, Companion) are let through:
 * they still need a device token.
 */
export function originAllowed(originHeader: string | undefined, hostHeader: string | undefined): boolean {
  if (originHeader === undefined) return true;
  if (!hostHeader) return false;
  return originHeader.trim().toLowerCase() === `http://${hostHeader.trim().toLowerCase()}`;
}
