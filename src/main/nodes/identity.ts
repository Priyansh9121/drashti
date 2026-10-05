import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type Identity, makeIdentity, pemFingerprint } from './certificate';

/*
 * Main's identity for its nodes (Session 13): an id, and a key and
 * certificate made once, the first time a node pairs, kept in the data
 * folder (node-link/identity.json, readable by this computer's user only).
 * Never in the library, so a backup restored on another computer does not
 * carry it: nodes paired with this Main follow only this Main.
 */

export interface MainIdentity extends Identity {
  id: string;
}

const fileSchema = z.object({
  id: z.uuid(),
  certPem: z.string().min(1),
  keyPem: z.string().min(1),
});

export function loadOrMakeIdentity(userData: string, commonName: string): MainIdentity {
  const dir = join(userData, 'node-link');
  const file = join(dir, 'identity.json');
  try {
    const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (parsed.success) return { ...parsed.data, fingerprint: pemFingerprint(parsed.data.certPem) };
  } catch {
    // None yet (or unreadable): a new one.
  }
  const made = makeIdentity(`Drashti Main ${commonName}`.slice(0, 64));
  const identity: MainIdentity = { id: randomUUID(), ...made };
  mkdirSync(dir, { recursive: true });
  const temp = `${file}.writing`;
  writeFileSync(
    temp,
    JSON.stringify({ id: identity.id, certPem: identity.certPem, keyPem: identity.keyPem }, null, 2),
    { mode: 0o600 },
  );
  renameSync(temp, file);
  return identity;
}
