import { randomUUID } from 'node:crypto';
import type { DeviceKind } from '../../shared/network';
import type { Db } from './database';

/*
 * Paired devices (migration 18). Only a token's SHA-256 is kept. Last seen
 * is written now and then, not on every request: a write in the main process
 * can take a few hundred milliseconds on a Windows PC whose antivirus scans
 * each commit, and taps on a phone must never wait for one.
 */

export interface DeviceRow {
  id: string;
  name: string;
  kind: DeviceKind;
  tokenHash: string;
  poster: boolean;
  pairedAt: string;
  lastSeenAt: string | null;
}

interface Row {
  id: string;
  name: string;
  kind: DeviceKind;
  token_hash: string;
  poster: number;
  paired_at: string;
  last_seen_at: string | null;
}

const toDevice = (r: Row): DeviceRow => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  tokenHash: r.token_hash,
  poster: r.poster === 1,
  pairedAt: r.paired_at,
  lastSeenAt: r.last_seen_at,
});

export class DeviceRepo {
  constructor(private readonly db: Db) {}

  list(): DeviceRow[] {
    return (
      this.db
        .prepare(
          'SELECT id, name, kind, token_hash, poster, paired_at, last_seen_at FROM network_devices ORDER BY poster, paired_at',
        )
        .all() as Row[]
    ).map(toDevice);
  }

  get(id: string): DeviceRow | null {
    const row = this.db
      .prepare(
        'SELECT id, name, kind, token_hash, poster, paired_at, last_seen_at FROM network_devices WHERE id = ?',
      )
      .get(id) as Row | undefined;
    return row ? toDevice(row) : null;
  }

  add(device: { name: string; kind: DeviceKind; tokenHash: string; poster?: boolean }): DeviceRow {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO network_devices (id, name, kind, token_hash, poster) VALUES (?, ?, ?, ?, ?)')
      .run(id, device.name, device.kind, device.tokenHash, device.poster ? 1 : 0);
    const added = this.get(id);
    if (!added) throw new Error('The device was not kept.');
    return added;
  }

  rename(id: string, name: string): boolean {
    return this.db.prepare('UPDATE network_devices SET name = ? WHERE id = ?').run(name, id).changes === 1;
  }

  /** Remove (revoke) a device: its token works no more. */
  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM network_devices WHERE id = ?').run(id).changes === 1;
  }

  /** Remove the announcements poster link (before a new one is made). */
  removePosters(): number {
    return this.db.prepare('DELETE FROM network_devices WHERE poster = 1').run().changes;
  }

  /** Write when devices were last seen (ISO times), in one go. */
  touch(seen: ReadonlyMap<string, string>): void {
    if (seen.size === 0) return;
    const stmt = this.db.prepare(
      'UPDATE network_devices SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)',
    );
    this.db.transaction(() => {
      for (const [id, at] of seen) stmt.run(at, id, at);
    })();
  }
}
