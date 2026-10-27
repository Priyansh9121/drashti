import { isIP } from 'node:net';
import { isLocalAddress } from '../network/addresses';

/*
 * Where events out may go (Session 28, decision 20): an address on the local network unless this one is
 * allowed on the internet, and then only over https. The name is resolved first and every address it
 * resolves to is checked; the request then goes to the address checked, so a name that later resolves
 * elsewhere (DNS rebinding) cannot send it anywhere else. Tests (never a packaged Drashti) go only to
 * 127.0.0.1, refused loudly otherwise.
 */

export type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;

export type Target =
  { ok: true; ip: string; family: 4 | 6; url: URL } | { ok: false; reason: string; loud?: boolean };

export async function checkTarget(
  address: string,
  options: { allowInternet: boolean; onlyThisComputer: boolean; resolve: Resolve },
): Promise<Target> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, reason: 'The address is not a web address.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'The address must start http:// or https://.' };
  if (options.allowInternet && url.protocol !== 'https:')
    return { ok: false, reason: 'An address on the internet must start https://.' };
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  let found: { address: string; family: number }[];
  try {
    found = isIP(host) ? [{ address: host, family: isIP(host) }] : await options.resolve(host);
  } catch {
    return { ok: false, reason: `This computer cannot find ${url.hostname}.` };
  }
  if (found.length === 0) return { ok: false, reason: `This computer cannot find ${url.hostname}.` };
  if (options.onlyThisComputer) {
    const away = found.filter((f) => f.address !== '127.0.0.1');
    if (away.length > 0)
      return {
        ok: false,
        reason: `TEST GUARD: events out go only to 127.0.0.1, not ${url.hostname}.`,
        loud: true,
      };
  }
  // Every address the name has: one off the local network is enough to refuse it, unless allowed.
  if (!options.allowInternet && found.some((f) => !isLocalAddress(f.address)))
    return {
      ok: false,
      reason: `${url.hostname} is not on this computer’s local network. One address on the internet may be allowed: tick “It is on the internet” (https only).`,
    };
  // Never an address that means "any" or a group.
  const first = found.find((f) => !/^(0\.0\.0\.0|::|22[4-9]\.|23\d\.|ff)/iu.test(f.address));
  if (!first) return { ok: false, reason: `${url.hostname} is not an address a request can go to.` };
  return { ok: true, ip: first.address, family: first.family === 6 ? 6 : 4, url };
}
