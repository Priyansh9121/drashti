import { existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DrashtiRole } from '../shared/nodes';
import { readState, readStateTwice, setAside } from './state-file';

/*
 * Whether this computer runs the show (Main) or follows one (a Node,
 * Session 13). One installer: the role is kept in the data folder
 * (drashti-role.json), chosen on the first start, and changed later from
 * the menu (Main) or the node's window. A computer that already has a
 * library is a Main. DRASHTI_ROLE (main or node) sets it, for tests and for
 * starting a second copy on one computer.
 */

const FILE = 'drashti-role.json';

const parseRole = (raw: unknown): DrashtiRole | null => {
  const role = (raw as { role?: unknown } | null)?.role;
  return role === 'main' || role === 'node' ? role : null;
};

export function readRole(userData: string): DrashtiRole | null {
  const read = readState(join(userData, FILE), parseRole);
  return read.status === 'ok' ? read.value : null;
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
  return startingRole(userData, env, { log: () => undefined }).role;
}

/**
 * The role to start in, and what to tell the person at the computer about it (Session 23). A role
 * file that is there but cannot be read is not taken for none: on a node nobody may be at the
 * computer to answer a question at the start. So the role is decided from the files there (whichever
 * role ran last wrote its own files last; no library at all means a node), the file is set aside with
 * the date, and the note says what was chosen. null: a first start, where only the person at it can say.
 */
export function startingRole(
  userData: string,
  env: string | undefined,
  o: { log: (message: string) => void; now?: Date; retryMs?: number },
): { role: DrashtiRole | null; note: string | null } {
  if (env === 'main' || env === 'node') return { role: env, note: null };
  const library = existsSync(join(userData, 'drashti.sqlite'));
  const read = readStateTwice(join(userData, FILE), parseRole, o.retryMs);
  if (read.status === 'ok') return { role: read.value, note: null };
  if (read.status === 'missing') return { role: library ? 'main' : null, note: null };
  // A computer can have been both (a Main turned into a node keeps its library): whichever ran last
  // wrote its own files last.
  const lastWritten = (names: string[]) =>
    Math.max(
      0,
      ...names.map((n) => {
        try {
          return statSync(join(userData, n)).mtimeMs;
        } catch {
          return 0;
        }
      }),
    );
  const asMain = lastWritten(['drashti.sqlite', 'drashti.sqlite-wal', 'live-state.json']);
  const asNode = lastWritten(['node.json', 'node-show.json']);
  const role: DrashtiRole = asMain > asNode ? 'main' : 'node';
  const moved = setAside(join(userData, FILE), o.now);
  const kept = moved ? `kept as “${basename(moved)}”` : 'left where it is';
  o.log(
    `${FILE} could not be read (${read.reason}); ${kept}. Starting as ${role === 'main' ? "Main: Main's files are the newest" : "a node: no library, or a node's files are the newest"}`,
  );
  return {
    role,
    note: `This computer's role file could not be read, so Drashti started as ${
      role === 'main'
        ? 'Main, because it last ran as Main'
        : library
          ? 'a node, because it last ran as a node'
          : 'a node, because this computer has no library'
    }. The file was ${kept} in Drashti's data folder. To change the role, ${
      role === 'main'
        ? 'choose File, then Use This Computer as a Node…'
        : 'press Use this computer as Main… below'
    }.`,
  };
}
