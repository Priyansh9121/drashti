import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DrashtiRole } from '../shared/nodes';

/*
 * Whether this computer runs the show (Main) or follows one (a Node,
 * Session 13). One installer: the role is kept in the data folder
 * (drashti-role.json), chosen on the first start, and changed later from
 * the menu (Main) or the node's window. A computer that already has a
 * library is a Main. DRASHTI_ROLE (main or node) sets it, for tests and for
 * starting a second copy on one computer.
 */

const FILE = 'drashti-role.json';

export function readRole(userData: string): DrashtiRole | null {
  try {
    const raw = JSON.parse(readFileSync(join(userData, FILE), 'utf8')) as { role?: unknown };
    return raw.role === 'main' || raw.role === 'node' ? raw.role : null;
  } catch {
    return null;
  }
}

export function writeRole(userData: string, role: DrashtiRole): void {
  const file = join(userData, FILE);
  writeFileSync(`${file}.writing`, JSON.stringify({ role }, null, 2));
  renameSync(`${file}.writing`, file);
}

/**
 * The role to start in without asking: the environment's, the one kept, or
 * Main for a computer that has a library (it was a Main before roles); null
 * when only the person at the computer can say.
 */
export function knownRole(userData: string, env: string | undefined): DrashtiRole | null {
  if (env === 'main' || env === 'node') return env;
  return readRole(userData) ?? (existsSync(join(userData, 'drashti.sqlite')) ? 'main' : null);
}
