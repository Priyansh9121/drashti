import { randomUUID } from 'node:crypto';
import type { Mask, MaskDefinition } from '../../shared/masks';
import { maskDefinitionSchema } from '../../shared/masks';
import type { Db } from './database';

/*
 * The mask library (migration 22): a name, a place in the list, and the
 * canvas, mode and shapes as JSON. A definition that does not read is shown
 * as a mask that hides nothing, never an error on the screens.
 */

interface Row {
  id: string;
  name: string;
  definition: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function parse(row: Row): Mask {
  let raw: unknown = null;
  try {
    raw = JSON.parse(row.definition);
  } catch {
    // Hides nothing.
  }
  const def = maskDefinitionSchema.safeParse(raw);
  return def.success
    ? { id: row.id, name: row.name, ...def.data }
    : { id: row.id, name: row.name, width: 1920, height: 1080, mode: 'hide', shapes: [] };
}

export class MaskRepo {
  constructor(private readonly db: Db) {}

  list(): Mask[] {
    return (
      this.db.prepare('SELECT id, name, definition FROM masks ORDER BY position, rowid').all() as Row[]
    ).map(parse);
  }

  get(id: string): Mask | null {
    const row = this.db.prepare('SELECT id, name, definition FROM masks WHERE id = ?').get(id) as
      Row | undefined;
    return row ? parse(row) : null;
  }

  create(name: string, def: MaskDefinition): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO masks (id, name, definition, source_kind, position)
         VALUES (?, ?, ?, 'drashti', (SELECT COALESCE(MAX(position), -1) + 1 FROM masks))`,
      )
      .run(id, name, JSON.stringify(def));
    return id;
  }

  save(id: string, name: string, def: MaskDefinition): boolean {
    return (
      this.db
        .prepare(`UPDATE masks SET name = ?, definition = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(name, JSON.stringify(def), id).changes > 0
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM masks WHERE id = ?').run(id).changes > 0;
  }
}
