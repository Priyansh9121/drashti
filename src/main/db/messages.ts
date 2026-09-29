import { randomUUID } from 'node:crypto';
import type { MessageField, MessageTemplate, MessageTemplateFields } from '../../shared/messages';
import type { Db } from './database';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

interface MessageRow {
  id: string;
  name: string;
  template: string;
  definition: string;
}

function toTemplate(r: MessageRow): MessageTemplate {
  let fields: Record<string, MessageField> = {};
  try {
    const d = JSON.parse(r.definition) as { fields?: Record<string, MessageField> };
    fields = d.fields ?? {};
  } catch {
    // An unreadable definition: every field is typed in.
  }
  return { id: r.id, name: r.name, template: r.template, fields };
}

/** Message templates ("Car {plate} please move"), kept in the library. */
export class MessageRepo {
  constructor(private readonly db: Db) {}

  list(): MessageTemplate[] {
    return (
      this.db
        .prepare('SELECT id, name, template, definition FROM messages ORDER BY rowid')
        .all() as MessageRow[]
    ).map(toTemplate);
  }

  create(t: MessageTemplateFields): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO messages (id, name, template, definition) VALUES (?, ?, ?, ?)')
      .run(id, t.name, t.template, JSON.stringify({ fields: t.fields }));
    return id;
  }

  update(id: string, t: MessageTemplateFields): boolean {
    return (
      this.db
        .prepare(
          `UPDATE messages SET name = ?, template = ?, definition = ?, updated_at = ${NOW} WHERE id = ?`,
        )
        .run(t.name, t.template, JSON.stringify({ fields: t.fields }), id).changes === 1
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes === 1;
  }
}
