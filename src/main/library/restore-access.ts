import { existsSync } from 'node:fs';
import type { Db } from '../db/database';

/*
 * After a restore, who may connect is today's, not the backup's (Sessions 31–36, SEC-6). A backup brings
 * back the phones, the poster link and the nodes paired when it was made: a phone removed since would be
 * let in again, and one paired since refused. So the restored library takes them from the library kept
 * aside before the swap (Backups/Before restore …): today's phones and poster link exactly, and each node's
 * token as today. A node unpaired since keeps its row without a token (refused), as its screens go with
 * its row, and a node paired since is put back. If the library from before cannot be read, every phone and
 * node is refused instead, and they pair again.
 */

export type KeptAccess =
  { ok: true; phones: number; nodes: number; refused: number } | { ok: false; refused: number };

/** Every phone and node refused: who was paired could not be read. */
function refuseAll(db: Db): KeptAccess {
  return db.transaction((): KeptAccess => {
    const phones = db.prepare('DELETE FROM network_devices').run().changes;
    const nodes = db.prepare('UPDATE nodes SET token_hash = NULL WHERE token_hash IS NOT NULL').run().changes;
    return { ok: false, refused: phones + nodes };
  })();
}

/** Copy who may connect from `keptLibrary` (today's library, kept aside) into the restored library. */
export function keepAccessAfterRestore(db: Db, keptLibrary: string): KeptAccess {
  if (!existsSync(keptLibrary)) return refuseAll(db);
  try {
    db.prepare('ATTACH DATABASE ? AS kept').run(keptLibrary);
  } catch {
    return refuseAll(db);
  }
  try {
    return db.transaction((): KeptAccess => {
      // The phones and the poster link: today's exactly. Each kept row keeps its id, so the restored
      // announcements still name the phone that sent them.
      const gone = db
        .prepare('DELETE FROM main.network_devices WHERE id NOT IN (SELECT id FROM kept.network_devices)')
        .run().changes;
      db.prepare(
        `INSERT INTO main.network_devices (id, name, kind, token_hash, poster, paired_at, last_seen_at)
         SELECT id, name, kind, token_hash, poster, paired_at, last_seen_at FROM kept.network_devices WHERE true
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, token_hash = excluded.token_hash,
           poster = excluded.poster, paired_at = excluded.paired_at, last_seen_at = excluded.last_seen_at`,
      ).run();
      const phones = (db.prepare('SELECT count(*) AS n FROM main.network_devices').get() as { n: number }).n;
      // The nodes: every token as today. Unpaired since the backup: refused, its row kept. Cleared first, so
      // no two rows ever hold one token.
      const unpaired = (
        db
          .prepare(
            `SELECT count(*) AS n FROM main.nodes WHERE token_hash IS NOT NULL
             AND id NOT IN (SELECT id FROM kept.nodes WHERE token_hash IS NOT NULL)`,
          )
          .get() as { n: number }
      ).n;
      db.prepare('UPDATE main.nodes SET token_hash = NULL').run();
      db.prepare(
        `UPDATE main.nodes SET token_hash = k.token_hash, paired_at = k.paired_at
         FROM kept.nodes AS k WHERE k.id = main.nodes.id AND k.token_hash IS NOT NULL`,
      ).run();
      // Paired since the backup: put back (without screens, which the backup's library does not have).
      db.prepare(
        `INSERT INTO main.nodes (id, name, host, port, last_seen_at, token_hash, paired_at, version, everything, displays)
         SELECT id, name, host, port, last_seen_at, token_hash, paired_at, version, everything, displays
         FROM kept.nodes WHERE token_hash IS NOT NULL AND id NOT IN (SELECT id FROM main.nodes)`,
      ).run();
      const nodes = (
        db.prepare('SELECT count(*) AS n FROM main.nodes WHERE token_hash IS NOT NULL').get() as { n: number }
      ).n;
      // Refused: the backup's phones and nodes that today's library had removed.
      return { ok: true, phones, nodes, refused: gone + unpaired };
    })();
  } catch {
    return refuseAll(db);
  } finally {
    db.prepare('DETACH DATABASE kept').run();
  }
}
