import { randomUUID } from 'node:crypto';
import type { StageLayout, StageLayoutDefinition } from '../../shared/stage-layouts';
import { stageLayoutDefinitionSchema } from '../../shared/stage-layouts';
import type { Db } from './database';

/*
 * Stage layouts made in Drashti (migration 21): a name, a place in the list,
 * and the boxes and background as JSON. A definition that does not read is
 * shown as an empty black layout, never an error on the stage.
 */

interface Row {
  id: string;
  name: string;
  definition: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function parse(row: Row): StageLayout {
  let raw: unknown = null;
  try {
    raw = JSON.parse(row.definition);
  } catch {
    // An empty layout.
  }
  const def = stageLayoutDefinitionSchema.safeParse(raw);
  return {
    id: row.id,
    name: row.name,
    background: def.success ? def.data.background : '#000000',
    boxes: def.success ? def.data.boxes : [],
  };
}

export class StageLayoutRepo {
  constructor(private readonly db: Db) {}

  list(): StageLayout[] {
    return (
      this.db
        .prepare('SELECT id, name, definition FROM stage_layouts ORDER BY position, rowid')
        .all() as Row[]
    ).map(parse);
  }

  get(id: string): StageLayout | null {
    const row = this.db.prepare('SELECT id, name, definition FROM stage_layouts WHERE id = ?').get(id) as
      Row | undefined;
    return row ? parse(row) : null;
  }

  /** A new layout at the end of the list. */
  create(name: string, def: StageLayoutDefinition): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO stage_layouts (id, name, definition, source_kind, position)
         VALUES (?, ?, ?, 'drashti', (SELECT COALESCE(MAX(position), -1) + 1 FROM stage_layouts))`,
      )
      .run(id, name, JSON.stringify(def));
    return id;
  }

  save(id: string, name: string, def: StageLayoutDefinition): boolean {
    return (
      this.db
        .prepare(`UPDATE stage_layouts SET name = ?, definition = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(name, JSON.stringify(def), id).changes > 0
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM stage_layouts WHERE id = ?').run(id).changes > 0;
  }
}
