import { randomUUID } from 'node:crypto';
import type { SlideElement } from '../../shared/model';
import { slideElementSchema } from '../../shared/model-schema';
import type { PropFields, PropInfo } from '../../shared/props';
import type { Db } from './database';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

interface PropRow {
  id: string;
  name: string;
  definition: string;
  source_kind: string | null;
}

function toProp(r: PropRow): PropInfo | null {
  try {
    const d = JSON.parse(r.definition) as { width?: number; height?: number; elements?: unknown[] };
    const elements = (d.elements ?? []).flatMap((e) => {
      const parsed = slideElementSchema.safeParse(e);
      return parsed.success ? [parsed.data] : [];
    });
    return {
      id: r.id,
      name: r.name,
      width: d.width ?? 1920,
      height: d.height ?? 1080,
      elements,
      imported: r.source_kind === 'pp6' || r.source_kind === 'pp7',
    };
  } catch {
    return null;
  }
}

const definition = (p: Pick<PropFields, 'width' | 'height' | 'elements'>) =>
  JSON.stringify({ width: p.width, height: p.height, elements: p.elements });

/** Props, kept in the library (the props table). */
export class PropRepo {
  constructor(private readonly db: Db) {}

  list(): PropInfo[] {
    return (
      this.db.prepare('SELECT id, name, definition, source_kind FROM props ORDER BY rowid').all() as PropRow[]
    ).flatMap((r) => {
      const prop = toProp(r);
      return prop ? [prop] : [];
    });
  }

  get(id: string): PropInfo | null {
    const row = this.db
      .prepare('SELECT id, name, definition, source_kind FROM props WHERE id = ?')
      .get(id) as PropRow | undefined;
    return row ? toProp(row) : null;
  }

  create(fields: PropFields): string {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO props (id, name, definition, source_kind) VALUES (?, ?, ?, 'drashti')")
      .run(id, fields.name, definition(fields));
    return id;
  }

  update(id: string, fields: PropFields): boolean {
    return (
      this.db
        .prepare(`UPDATE props SET name = ?, definition = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(fields.name, definition(fields), id).changes === 1
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM props WHERE id = ?').run(id).changes === 1;
  }

  /**
   * Put in the props from a props file, replacing any imported from the
   * same file before. Returns the new ids, in order.
   */
  replaceImported(
    kind: 'pp6' | 'pp7',
    path: string,
    props: { name: string; ref: string | null; width: number; height: number; elements: SlideElement[] }[],
  ): string[] {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM props WHERE source_kind = ? AND source_path = ?').run(kind, path);
      const insert = this.db.prepare(
        `INSERT INTO props (id, name, definition, source_kind, source_path, source_ref, source_imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ${NOW})`,
      );
      return props.map((p) => {
        const id = randomUUID();
        insert.run(id, p.name.slice(0, 80), definition(p), kind, path, p.ref);
        return id;
      });
    })();
  }
}
