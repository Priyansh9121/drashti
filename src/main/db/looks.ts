import { randomUUID } from 'node:crypto';
import type { GroupLook, LookInfo } from '../../shared/looks';
import { lookDefinitionSchema, readGroupLook, storedGroupLook } from '../../shared/looks';
import type { Db } from './database';

/*
 * Looks, kept in the library (migration 20). Each row's definition holds,
 * per screen group, only what that group changes from the defaults
 * (shared/looks.ts); reading fills in the rest, for every group there is.
 */

interface LookRow {
  id: string;
  name: string;
  definition: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** The stored groups of a definition (anything unreadable is left out). */
function storedGroups(json: string): Record<string, unknown> {
  try {
    const parsed = lookDefinitionSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data.groups : {};
  } catch {
    return {};
  }
}

/** The stored groups without one. */
const without = (groups: Record<string, unknown>, groupId: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(groups).filter(([id]) => id !== groupId));

export class LookRepo {
  constructor(private readonly db: Db) {}

  private rows(): LookRow[] {
    return this.db
      .prepare('SELECT id, name, definition FROM looks ORDER BY position, rowid')
      .all() as LookRow[];
  }

  private groupIds(): string[] {
    return (
      this.db.prepare('SELECT id FROM screen_groups ORDER BY position, rowid').all() as { id: string }[]
    ).map((r) => r.id);
  }

  private info(row: LookRow, groupIds: readonly string[]): LookInfo {
    const stored = storedGroups(row.definition);
    const groups: Record<string, GroupLook> = {};
    for (const id of groupIds) groups[id] = readGroupLook(stored[id]);
    return { id: row.id, name: row.name, groups };
  }

  /** Every Look in order, each with every group's settings. */
  list(): LookInfo[] {
    const ids = this.groupIds();
    return this.rows().map((r) => this.info(r, ids));
  }

  get(id: string): LookInfo | null {
    const row = this.db.prepare('SELECT id, name, definition FROM looks WHERE id = ?').get(id) as
      LookRow | undefined;
    return row ? this.info(row, this.groupIds()) : null;
  }

  /** The Look Drashti starts with: the first. One is made if there is none (a library always has one). */
  firstId(): string {
    const row = this.db.prepare('SELECT id FROM looks ORDER BY position, rowid LIMIT 1').get() as
      { id: string } | undefined;
    return row?.id ?? this.create('Standard');
  }

  /** A new Look at the end of the list, with the settings of `copyOf` (or the defaults). */
  create(name: string, copyOf: string | null = null): string {
    const id = randomUUID();
    const from = copyOf
      ? (this.db.prepare('SELECT definition FROM looks WHERE id = ?').get(copyOf) as
          { definition: string } | undefined)
      : undefined;
    this.db
      .prepare(
        `INSERT INTO looks (id, name, definition, source_kind, position)
         VALUES (?, ?, ?, 'drashti', (SELECT COALESCE(MAX(position), -1) + 1 FROM looks))`,
      )
      .run(id, name, from?.definition ?? '{"groups":{}}');
    return id;
  }

  rename(id: string, name: string): boolean {
    return (
      this.db.prepare(`UPDATE looks SET name = ?, updated_at = ${NOW} WHERE id = ?`).run(name, id).changes > 0
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM looks WHERE id = ?').run(id).changes > 0;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM looks').get() as { n: number }).n;
  }

  /** Put a Look at this place in the list (0 is first: the one Drashti starts with). */
  move(id: string, to: number): boolean {
    const ids = this.rows().map((r) => r.id);
    const from = ids.indexOf(id);
    if (from < 0) return false;
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    const set = this.db.prepare(`UPDATE looks SET position = ? WHERE id = ?`);
    this.db.transaction(() => {
      ids.forEach((lookId, i) => set.run(i, lookId));
    })();
    return true;
  }

  /** Change one group's settings in a Look (only what `patch` gives). */
  setGroup(lookId: string, groupId: string, patch: Partial<GroupLook>): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT definition FROM looks WHERE id = ?').get(lookId) as
        { definition: string } | undefined;
      if (!row) return false;
      const stored = storedGroups(row.definition);
      const next = storedGroupLook({ ...readGroupLook(stored[groupId]), ...patch });
      // A group at the defaults is left out.
      const groups = {
        ...without(stored, groupId),
        ...(Object.keys(next).length > 0 ? { [groupId]: next } : {}),
      };
      this.db
        .prepare(`UPDATE looks SET definition = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(JSON.stringify({ groups }), lookId);
      return true;
    })();
  }

  /** The same change to a group in every Look (a group the setup wizard makes starts the same in each). */
  setGroupEverywhere(groupId: string, patch: Partial<GroupLook>): void {
    for (const r of this.rows()) this.setGroup(r.id, groupId, patch);
  }

  /** A group was deleted: no Look keeps its settings. */
  forgetGroup(groupId: string): void {
    this.db.transaction(() => {
      for (const r of this.rows()) {
        const stored = storedGroups(r.definition);
        if (!(groupId in stored)) continue;
        this.db
          .prepare(`UPDATE looks SET definition = ?, updated_at = ${NOW} WHERE id = ?`)
          .run(JSON.stringify({ groups: without(stored, groupId) }), r.id);
      }
    })();
  }
}
