import { randomUUID } from 'node:crypto';
import type { MessageField, MessageTemplate, MessageTemplateFields } from '../../shared/messages';
import { keptLook, readLook, readSeconds } from '../../shared/message-look';
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
  let look: MessageTemplate['look'];
  let seconds: number | undefined;
  try {
    const d = JSON.parse(r.definition) as {
      fields?: Record<string, MessageField>;
      look?: unknown;
      seconds?: unknown;
    };
    fields = d.fields ?? {};
    // Its look and its time up (Session 55, Part 15): an older library's messages have neither (the standard band,
    // until taken off), and one that cannot be read is the standard too.
    look = readLook(d.look);
    seconds = readSeconds(d.seconds);
  } catch {
    // An unreadable definition: every field is typed in.
  }
  return {
    id: r.id,
    name: r.name,
    template: r.template,
    fields,
    ...(look ? { look } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
  };
}

/** What a template keeps beside its words: its fields, and since Session 55 its look and its time up. */
function definition(t: MessageTemplateFields): string {
  const look = keptLook(t.look);
  return JSON.stringify({
    fields: t.fields,
    ...(look ? { look } : {}),
    ...(t.seconds !== undefined ? { seconds: t.seconds } : {}),
  });
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

  get(id: string): MessageTemplate | null {
    const row = this.db
      .prepare('SELECT id, name, template, definition FROM messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    return row ? toTemplate(row) : null;
  }

  create(t: MessageTemplateFields): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO messages (id, name, template, definition) VALUES (?, ?, ?, ?)')
      .run(id, t.name, t.template, definition(t));
    return id;
  }

  update(id: string, t: MessageTemplateFields): boolean {
    return (
      this.db
        .prepare(
          `UPDATE messages SET name = ?, template = ?, definition = ?, updated_at = ${NOW} WHERE id = ?`,
        )
        .run(t.name, t.template, definition(t), id).changes === 1
    );
  }

  /**
   * A template as it was, by its id (Session 55: Undo of a change or a removal): changed back, or made again with
   * that id when it was removed.
   */
  put(t: MessageTemplate): void {
    if (this.update(t.id, t)) return;
    this.db
      .prepare('INSERT INTO messages (id, name, template, definition) VALUES (?, ?, ?, ?)')
      .run(t.id, t.name, t.template, definition(t));
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes === 1;
  }
}
