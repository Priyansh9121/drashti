import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { readState, readStateTwice, setAside } from '../state-file';
import { type Identity, makeIdentity, pemFingerprint } from './certificate';

/*
 * Main's identity for its nodes (Session 13): an id, and a key and
 * certificate made once, the first time a node pairs, kept in the data
 * folder (node-link/identity.json, readable by this computer's user only).
 * Never in the library, so a backup restored on another computer does not
 * carry it: nodes paired with this Main follow only this Main.
 *
 * Every paired node pins this certificate. Since Session 23 a file that is
 * there but cannot be read is never replaced by a new identity: that cut off
 * every node without a word. It is read once more after a moment (antivirus
 * can hold a file), then set aside with the date, and Main holds: no link to
 * the nodes, the operator is told, and only an admin's "Make a new identity"
 * (makeNewIdentity) makes another, after which each node is paired again. The
 * hold is kept in node-link/identity-held.json, so a restart does not quietly
 * make a new identity in the set-aside file's place.
 */

export interface MainIdentity extends Identity {
  id: string;
}

export type IdentityLoad = { ok: true; identity: MainIdentity } | { ok: false; problem: string };

const fileSchema = z.object({
  id: z.uuid(),
  certPem: z.string().min(1),
  keyPem: z.string().min(1),
});

const heldSchema = z.object({ reason: z.string().max(300), setAside: z.string().max(300).nullable() });

const parseIdentity = (raw: unknown) => {
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) return null;
  try {
    return { ...parsed.data, fingerprint: pemFingerprint(parsed.data.certPem) };
  } catch {
    return null;
  }
};

const files = (userData: string) => {
  const dir = join(userData, 'node-link');
  return { dir, file: join(dir, 'identity.json'), held: join(dir, 'identity-held.json') };
};

/** What the operator (and the dashboard) is told while Main holds. */
export function heldProblem(setAsideAs: string | null): string {
  return `This computer's identity for its nodes could not be read, so no node can follow it. ${
    setAsideAs
      ? `It was kept as “${setAsideAs}” in Drashti's data folder (node-link).`
      : "It was left where it is, in Drashti's data folder (node-link)."
  } An admin can make a new identity, then pair each node again.`;
}

function write(f: ReturnType<typeof files>, identity: MainIdentity): void {
  mkdirSync(f.dir, { recursive: true });
  const temp = `${f.file}.writing`;
  writeFileSync(
    temp,
    JSON.stringify({ id: identity.id, certPem: identity.certPem, keyPem: identity.keyPem }, null, 2),
    { mode: 0o600 },
  );
  renameSync(temp, f.file);
}

function make(commonName: string): MainIdentity {
  return { id: randomUUID(), ...makeIdentity(`Drashti Main ${commonName}`.slice(0, 64)) };
}

/**
 * Main's identity: the one kept, or a new one when there is none yet. One that cannot be read
 * is set aside and Main holds (see above).
 */
export function loadIdentity(
  userData: string,
  commonName: string,
  o: { log: (message: string) => void; now?: Date; retryMs?: number },
): IdentityLoad {
  const f = files(userData);
  const held = readState(f.held, (raw) => {
    const parsed = heldSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  });
  // Held since an earlier start (a hold that cannot be read itself still holds).
  if (held.status === 'ok') return { ok: false, problem: heldProblem(held.value.setAside) };
  if (held.status !== 'missing') return { ok: false, problem: heldProblem(null) };
  const read = readStateTwice(f.file, parseIdentity, o.retryMs);
  if (read.status === 'ok') return { ok: true, identity: read.value };
  if (read.status === 'missing') {
    const identity = make(commonName);
    write(f, identity);
    return { ok: true, identity };
  }
  const moved = setAside(f.file, o.now);
  const setAsideAs = moved === null ? null : basename(moved);
  // Moved aside: the hold is kept, so the next start does not make a new one in its place. Not moved
  // (still locked, say): it stays where it is, and the next start reads it again.
  if (moved !== null)
    try {
      writeFileSync(f.held, JSON.stringify({ reason: read.reason, setAside: setAsideAs }, null, 2));
    } catch {
      // Held for this run anyway.
    }
  o.log(
    `Nodes: node-link/identity.json could not be read (${read.reason}); ${
      setAsideAs ? `kept as ${setAsideAs}` : 'left where it is'
    }. No new identity is made until an admin asks: the nodes cannot follow until then.`,
  );
  return { ok: false, problem: heldProblem(setAsideAs) };
}

/** An admin's choice (Screens > Nodes > Make a new identity): a new identity, ending the hold. */
export function makeNewIdentity(userData: string, commonName: string, now = new Date()): MainIdentity {
  const f = files(userData);
  // Whatever is still in its place (a folder, a file that could not be moved before) goes aside first.
  const there = readState(f.file, parseIdentity);
  if (there.status !== 'missing' && setAside(f.file, now) === null)
    throw new Error('The old identity file cannot be moved aside, so a new one cannot be written.');
  const identity = make(commonName);
  write(f, identity);
  rmSync(f.held, { force: true });
  return identity;
}
