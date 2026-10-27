import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { NO_ACTIVITY, type AccessActivity, type AccessGrant } from '../../shared/access-protocol';
import { readStateTwice, type StateRead } from '../state-file';

/*
 * This computer's way in (Session 54, E1): the Gmail, the grant and the secret the list gave when its token
 * was used, with the computer id it was made on, kept in Drashti's data folder (access.json, readable by
 * this computer's user only), written whole or not at all. Never the keychain: asking it at start blocks the
 * Intel build under Rosetta. Never the library, so never a backup. The computer id kept is only for saying
 * plainly that a data folder was copied from another computer: the list itself refuses another computer.
 *
 * It keeps too what each check sends: the last `at` (the next is never at or below it, whatever this
 * computer's clock does) and the totals since the token was used (minutes open, shows, streams, recordings,
 * imports: never content).
 */

export const ACCESS_FILE = 'access.json';

export interface StoredAccess {
  v: 1;
  gmail: string;
  grantId: string;
  secret: string;
  /** The computer id this was made on (identity.ts). */
  computerId: string;
  owner: boolean;
  /** When the token was used, on this computer's clock (ms). */
  since: number;
  /** The last `at` sent with a signed call. */
  lastAt: number;
  /** Totals since the token was used. */
  activity: AccessActivity;
}

const count = z.number().int().min(0).max(1e9);
const storedSchema = z.object({
  v: z.literal(1),
  gmail: z.string().min(3).max(254),
  grantId: z.string().regex(/^[0-9a-f]{32}$/u),
  secret: z.string().regex(/^[0-9a-f]{64}$/u),
  computerId: z.string().regex(/^[0-9a-f]{64}$/u),
  owner: z.boolean(),
  since: z.number().min(0),
  lastAt: z.number().min(0),
  activity: z.object({ minutes: count, shows: count, streams: count, recordings: count, imports: count }),
}) satisfies z.ZodType<StoredAccess>;

/** A way in, as the list gave it, ready to keep. */
export function storedAccess(o: {
  grant: AccessGrant;
  computerId: string;
  owner: boolean;
  since: number;
}): StoredAccess {
  return {
    v: 1,
    gmail: o.grant.gmail,
    grantId: o.grant.grantId,
    secret: o.grant.secret,
    computerId: o.computerId,
    owner: o.owner,
    since: o.since,
    lastAt: 0,
    activity: { ...NO_ACTIVITY },
  };
}

/** The grant to sign calls with. */
export const grantOf = (s: StoredAccess): AccessGrant => ({
  gmail: s.gmail,
  grantId: s.grantId,
  secret: s.secret,
});

export class AccessStore {
  readonly file: string;
  private kept: StoredAccess | null = null;

  constructor(userData: string) {
    this.file = join(userData, ACCESS_FILE);
  }

  /** What is kept: missing (never let in here), unreadable or invalid (as state-file.ts says), or ok. */
  read(retryMs?: number): StateRead<StoredAccess> {
    const r = readStateTwice(
      this.file,
      (raw) => {
        const parsed = storedSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      },
      retryMs,
    );
    this.kept = r.status === 'ok' ? r.value : null;
    return r;
  }

  /** Kept whole or not at all: written beside, then moved into place. */
  save(value: StoredAccess): void {
    const checked = storedSchema.parse(value);
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.writing`;
    writeFileSync(temp, JSON.stringify(checked, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
    this.kept = checked;
  }

  /** Forgotten: this computer is not let in by it any more. */
  clear(): void {
    rmSync(this.file, { force: true });
    rmSync(`${this.file}.writing`, { force: true });
    this.kept = null;
  }

  /** Whether what is kept was made on this computer (a copied data folder's was not). */
  madeHere(computerId: string): boolean {
    return this.current()?.computerId === computerId;
  }

  /** The `at` for the next signed call: this computer's clock, but never at or below the last one sent. */
  nextAt(now: number): number {
    const s = this.current();
    const at = Math.max(Math.floor(now), (s?.lastAt ?? 0) + 1);
    if (s) this.save({ ...s, lastAt: at });
    return at;
  }

  /** More shows, streams, minutes…, added to the totals kept. */
  add(more: Partial<AccessActivity>): AccessActivity {
    const s = this.current();
    if (!s) return { ...NO_ACTIVITY };
    const activity = { ...s.activity };
    for (const k of Object.keys(activity) as (keyof AccessActivity)[])
      activity[k] = Math.min(1e9, activity[k] + Math.max(0, Math.floor(more[k] ?? 0)));
    this.save({ ...s, activity });
    return activity;
  }

  private current(): StoredAccess | null {
    if (this.kept === null) this.read(0);
    return this.kept;
  }
}
