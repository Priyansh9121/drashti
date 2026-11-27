import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface Address {
  address: string;
  family: number;
}
export type Resolve = (host: string) => Promise<Address[]>;
export const resolveAddresses: Resolve = (host) => lookup(host, { all: true, verbatim: true });
export interface Authority {
  origin: string;
  addresses: Address[];
}
export interface PinnedTarget {
  url: URL;
  ip: string;
  family: 4 | 6;
}

const special = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  special.addSubnet(ip, prefix, 'ipv4');
for (const [ip, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  special.addSubnet(ip, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

/** Positive global-unicast policy; mapped IPv4 is classified by its embedded address. */
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) return !special.check(address, 'ipv4');
  if (isIP(address) !== 6) return false;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/u.exec(normalized);
  if (mapped) {
    const hi = parseInt(mapped[1] ?? '', 16),
      lo = parseInt(mapped[2] ?? '', 16);
    return publicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return globalV6.check(normalized, 'ipv6') && !special.check(normalized, 'ipv6');
}

export function webUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Refused web destination');
  return url;
}

async function addresses(url: URL, resolve: Resolve): Promise<Address[]> {
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  const family = isIP(host);
  const found = family ? [{ address: host, family }] : await resolve(host);
  if (!found.length || found.some((a) => !isIP(a.address) || isIP(a.address) !== a.family))
    throw new Error('No valid destination');
  return found;
}

/** The operator authorizes this exact origin and its initial DNS answers, never a later rebind. */
export async function authorize(raw: string, resolve: Resolve = resolveAddresses): Promise<Authority> {
  const url = webUrl(raw);
  return { origin: url.origin, addresses: await addresses(url, resolve) };
}

export class OutboundPolicy {
  constructor(
    readonly authority: Authority,
    private readonly guard = false,
    private readonly resolve: Resolve = resolveAddresses,
  ) {}

  async target(raw: string): Promise<PinnedTarget> {
    const url = webUrl(raw);
    const mine = url.origin === this.authority.origin;
    const found = mine ? this.authority.addresses : await addresses(url, this.resolve);
    // Test traffic stays on loopback even when a fake hostname looks public.
    if (this.guard && found.some((a) => a.address !== '127.0.0.1' && a.address !== '::1'))
      throw new Error('Test guard');
    if (!mine && found.some((a) => !publicAddress(a.address))) throw new Error('Refused private destination');
    const first = found[0];
    if (!first || !isIP(first.address)) throw new Error('No destination');
    return { url, ip: first.address, family: first.family === 6 ? 6 : 4 };
  }
}

/** A deadline includes DNS and injected transports, even if they cannot themselves be cancelled. */
export function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => undefined);
    signal.throwIfAborted();
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Operation aborted', { cause: signal.reason }));
    signal.addEventListener('abort', abort, { once: true });
    void work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(cause instanceof Error ? cause : new Error('Operation failed', { cause }));
      },
    );
  });
}
