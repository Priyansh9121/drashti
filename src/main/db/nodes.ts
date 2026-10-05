import { randomUUID } from 'node:crypto';
import type { DisplayInfo } from '../../shared/screens';
import { displayListSchema } from '../../shared/nodes-schema';
import type { Db } from './database';

/*
 * The nodes Main has paired (migration 30). Only a token's SHA-256 is kept.
 * When a node was last seen, where from and its version are written now and
 * then, never on every message: a write in the main process can take a few
 * hundred milliseconds on a Windows PC whose antivirus scans each commit.
 */

export interface NodeRow {
  id: string;
  name: string;
  tokenHash: string;
  pairedAt: string;
  lastSeenAt: string | null;
  /** The address it last connected from. */
  address: string | null;
  version: string | null;
  /** Copy every picture and video in the library ("Get everything ready"). */
  everything: boolean;
  /** The displays it last reported. */
  displays: DisplayInfo[];
}

interface Row {
  id: string;
  name: string;
  token_hash: string;
  paired_at: string | null;
  last_seen_at: string | null;
  host: string | null;
  version: string | null;
  everything: number;
  displays: string;
}

function parseDisplays(json: string): DisplayInfo[] {
  try {
    const parsed = displayListSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

const toNode = (r: Row): NodeRow => ({
  id: r.id,
  name: r.name,
  tokenHash: r.token_hash,
  pairedAt: r.paired_at ?? '',
  lastSeenAt: r.last_seen_at,
  address: r.host,
  version: r.version,
  everything: r.everything === 1,
  displays: parseDisplays(r.displays),
});

const COLUMNS = 'id, name, token_hash, paired_at, last_seen_at, host, version, everything, displays';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export class NodeRepo {
  constructor(private readonly db: Db) {}

  list(): NodeRow[] {
    return (
      this.db
        .prepare(`SELECT ${COLUMNS} FROM nodes WHERE token_hash IS NOT NULL ORDER BY paired_at, rowid`)
        .all() as Row[]
    ).map(toNode);
  }

  get(id: string): NodeRow | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM nodes WHERE id = ? AND token_hash IS NOT NULL`)
      .get(id) as Row | undefined;
    return row ? toNode(row) : null;
  }

  add(node: { name: string; tokenHash: string; address: string | null; version: string }): NodeRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO nodes (id, name, token_hash, host, version, paired_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ${NOW}, ${NOW})`,
      )
      .run(id, node.name, node.tokenHash, node.address, node.version);
    const added = this.get(id);
    if (!added) throw new Error('The node was not kept.');
    return added;
  }

  rename(id: string, name: string): boolean {
    return (
      this.db.prepare(`UPDATE nodes SET name = ?, updated_at = ${NOW} WHERE id = ?`).run(name, id).changes ===
      1
    );
  }

  /** Remove (unpair) a node: its token works no more, and its screens go with it. */
  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id).changes === 1;
  }

  setEverything(id: string, everything: boolean): boolean {
    return (
      this.db
        .prepare(`UPDATE nodes SET everything = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(everything ? 1 : 0, id).changes === 1
    );
  }

  /** The displays a node reported, kept when they changed. Returns whether they did. */
  setDisplays(id: string, displays: readonly DisplayInfo[]): boolean {
    const json = JSON.stringify(displays);
    return (
      this.db
        .prepare(`UPDATE nodes SET displays = ?, updated_at = ${NOW} WHERE id = ? AND displays <> ?`)
        .run(json, id, json).changes === 1
    );
  }

  /** Write when nodes were last seen, where from and the version they ran, in one go. */
  touch(seen: ReadonlyMap<string, { at: string; address: string | null; version: string | null }>): void {
    if (seen.size === 0) return;
    const stmt = this.db.prepare(
      `UPDATE nodes SET last_seen_at = ?, host = COALESCE(?, host), version = COALESCE(?, version)
        WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)`,
    );
    this.db.transaction(() => {
      for (const [id, s] of seen) stmt.run(s.at, s.address, s.version, id, s.at);
    })();
  }
}
