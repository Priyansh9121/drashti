import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';

/*
 * This computer's name on the local network (Bonjour on a Mac, mDNS on
 * Windows 10 and later): name.local. A phone that knows the computer by name
 * keeps working when the computer's address changes, though not every phone
 * or network resolves .local names, so the numbered address is shown too.
 */

let known: string | null | undefined;

const valid = (name: string) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/u.test(name);

/** `name.local`, or null when this computer has no usable local name. */
export function localName(platform: NodeJS.Platform = process.platform): string | null {
  if (known !== undefined) return known;
  let name = '';
  if (platform === 'darwin') {
    const r = spawnSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 1000 });
    name = r.status === 0 ? r.stdout.trim() : '';
  }
  if (!name) name = hostname().replace(/\.local$/iu, '');
  const clean = name.toLowerCase();
  known = valid(clean) ? `${clean}.local` : null;
  return known;
}
