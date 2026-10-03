import { randomUUID } from 'node:crypto';
import type { Macro, MacroAction } from '../../shared/macros';
import type { Db } from './database';

/*
 * Macros made in Drashti (migration 24 gives them a place in the list): a
 * name, a colour and their actions as JSON, kept as written. They are checked
 * every time they run (macro-service.ts), not just when saved.
 */

interface Row {
  id: string;
  name: string;
  color: string | null;
  actions: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export interface StoredMacro {
  id: string;
  name: string;
  color: string;
  /** As stored: checked before it runs. */
  actions: unknown[];
}

function parse(row: Row): StoredMacro {
  let actions: unknown = [];
  try {
    actions = JSON.parse(row.actions);
  } catch {
    // None that can run.
  }
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? '#3e63dd',
    actions: Array.isArray(actions) ? (actions as unknown[]) : [],
  };
}

export class MacroRepo {
  constructor(private readonly db: Db) {}

  list(): StoredMacro[] {
    return (
      this.db.prepare('SELECT id, name, color, actions FROM macros ORDER BY position, rowid').all() as Row[]
    ).map(parse);
  }

  get(id: string): StoredMacro | null {
    const row = this.db.prepare('SELECT id, name, color, actions FROM macros WHERE id = ?').get(id) as
      Row | undefined;
    return row ? parse(row) : null;
  }

  create(name: string, color: string, actions: readonly MacroAction[]): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO macros (id, name, color, actions, source_kind, position)
         VALUES (?, ?, ?, ?, 'drashti', (SELECT COALESCE(MAX(position), -1) + 1 FROM macros))`,
      )
      .run(id, name, color, JSON.stringify(actions));
    return id;
  }

  save(id: string, name: string, color: string, actions: readonly MacroAction[]): boolean {
    return (
      this.db
        .prepare(`UPDATE macros SET name = ?, color = ?, actions = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(name, color, JSON.stringify(actions), id).changes > 0
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM macros WHERE id = ?').run(id).changes > 0;
  }

  /** For tests and imports: actions written as they are, unchecked. */
  writeRaw(id: string, actions: unknown[]): void {
    this.db.prepare('UPDATE macros SET actions = ? WHERE id = ?').run(JSON.stringify(actions), id);
  }

  /** Every macro, as the operator window lists them (checked: an action that is not allowed is left out). */
  asMacros(
    check: (raw: readonly unknown[]) => { ok: true; actions: MacroAction[] } | { ok: false },
  ): Macro[] {
    return this.list().map((m) => {
      const checked = check(m.actions);
      return { id: m.id, name: m.name, color: m.color, actions: checked.ok ? checked.actions : [] };
    });
  }
}
