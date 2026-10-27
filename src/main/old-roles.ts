import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Roles and PINs (Session 14) are gone (Session 54, E5: "remove admin/operator logic completely"): everyone
 * let in can do all an admin could, and Simple Mode is left by its button and the word. A data folder from
 * 1.0.0-alpha.12 or before may still hold what they kept there: roles.json (the two PINs' scrypt hashes and
 * the count of wrong ones), roles-held.json (roles held locked because roles.json could not be read), the
 * copies of an unreadable roles.json set aside with their date (roles.unreadable-<date>.json), and a write
 * cut short (roles.json.writing). None is read again: each is removed at every start, on Main and on a node
 * alike, before anything else runs (after the first start there is nothing left to remove). A backup never
 * held one, as they lived outside the library, so a restore brings none back. The log names the files,
 * never what they held.
 */

/** A file roles left in the data folder, by its name. drashti-role.json (Main or Node, role.ts) is not one. */
export function isOldRolesFile(name: string): boolean {
  return (
    name === 'roles.json' ||
    name === 'roles-held.json' ||
    name === 'roles.json.writing' ||
    /^roles\.unreadable-.+\.json$/u.test(name)
  );
}

/**
 * Remove roles' files from the data folder; the names removed. One that cannot be removed now (held by
 * another program for a moment) is said, never read, and tried again at the next start.
 */
export function removeOldRoles(
  dataDir: string,
  log: (level: 'info' | 'warn', message: string) => void,
): string[] {
  let names: string[];
  try {
    names = readdirSync(dataDir).filter(isOldRolesFile);
  } catch {
    // No data folder yet (a first start): nothing to remove.
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    try {
      // A folder in roles.json's place, as an unreadable one could be, goes too.
      rmSync(join(dataDir, name), { recursive: true, force: true });
      removed.push(name);
    } catch (error) {
      log(
        'warn',
        `Roles are gone: ${name} could not be removed from the data folder (${(error as NodeJS.ErrnoException).code ?? String(error)}); it is never read, and is removed at the next start`,
      );
    }
  }
  if (removed.length > 0)
    log('info', `Roles and PINs are gone (Session 54): removed ${removed.join(', ')} from the data folder`);
  return removed;
}
