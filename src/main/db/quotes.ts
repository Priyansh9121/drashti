import { randomUUID } from 'node:crypto';
import type { Quote, QuoteFields, QuoteLang } from '../../shared/idle';
import { QUOTE_LANGS } from '../../shared/idle';
import type { Db } from './database';

/* The admin's quotes for the idle rotation (migration 29), in their order. */

interface Row {
  id: string;
  words: string;
  attribution: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function words(json: string): Partial<Record<QuoteLang, string>> {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const out: Partial<Record<QuoteLang, string>> = {};
    for (const l of QUOTE_LANGS) {
      const w = parsed[l];
      if (typeof w === 'string' && w !== '') out[l] = w;
    }
    return out;
  } catch {
    return {};
  }
}

export class QuoteRepo {
  constructor(private readonly db: Db) {}

  list(): Quote[] {
    return (
      this.db.prepare('SELECT id, words, attribution FROM quotes ORDER BY position, rowid').all() as Row[]
    ).map((r) => ({ id: r.id, words: words(r.words), attribution: r.attribution }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM quotes').get() as { n: number }).n;
  }

  create(f: QuoteFields): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO quotes (id, words, attribution, position)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM quotes))`,
      )
      .run(id, JSON.stringify(f.words), f.attribution);
    return id;
  }

  save(id: string, f: QuoteFields): boolean {
    return (
      this.db
        .prepare(`UPDATE quotes SET words = ?, attribution = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(JSON.stringify(f.words), f.attribution, id).changes > 0
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM quotes WHERE id = ?').run(id).changes > 0;
  }
}
