import { randomUUID } from 'node:crypto';
import type { Theme, ThemeFields } from '../../shared/themes';
import { DEFAULT_THEME, themeFieldsSchema } from '../../shared/themes';
import type { Db } from './database';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
/** app_meta key holding the default theme's id. */
const DEFAULT_KEY = 'theme.default';

/** Themes, kept in the library (the themes table), and which one is the default. */
export class ThemeRepo {
  constructor(private readonly db: Db) {}

  list(): Theme[] {
    const rows = this.db.prepare('SELECT id, name, definition FROM themes ORDER BY rowid').all() as {
      id: string;
      name: string;
      definition: string;
    }[];
    return rows.flatMap((r) => {
      const theme = this.parse(r);
      return theme ? [theme] : [];
    });
  }

  get(id: string): Theme | null {
    const row = this.db.prepare('SELECT id, name, definition FROM themes WHERE id = ?').get(id) as
      { id: string; name: string; definition: string } | undefined;
    return row ? this.parse(row) : null;
  }

  private parse(r: { id: string; name: string; definition: string }): Theme | null {
    try {
      const parsed = themeFieldsSchema.safeParse({ ...(JSON.parse(r.definition) as object), name: r.name });
      return parsed.success ? { id: r.id, ...parsed.data } : null;
    } catch {
      return null;
    }
  }

  create(
    fields: ThemeFields,
    source: { kind: 'drashti' | 'pp6' | 'pp7'; path: string | null } | null = null,
  ): string {
    const id = randomUUID();
    const { name, ...definition } = fields;
    this.db
      .prepare('INSERT INTO themes (id, name, definition, source_kind, source_path) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, JSON.stringify(definition), source?.kind ?? null, source?.path ?? null);
    return id;
  }

  update(id: string, fields: ThemeFields): boolean {
    const { name, ...definition } = fields;
    return (
      this.db
        .prepare(`UPDATE themes SET name = ?, definition = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(name, JSON.stringify(definition), id).changes === 1
    );
  }

  /** Remove a theme (not the default one). Presentations that used it keep their look. */
  remove(id: string): boolean {
    if (id === this.defaultId()) return false;
    return this.db.prepare('DELETE FROM themes WHERE id = ?').run(id).changes === 1;
  }

  /** The default theme's id, making it the first time. */
  defaultId(): string {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(DEFAULT_KEY) as
      { value: string } | undefined;
    if (row && this.get(row.value)) return row.value;
    const id = this.create(DEFAULT_THEME, { kind: 'drashti', path: null });
    this.db
      .prepare(
        'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(DEFAULT_KEY, id);
    return id;
  }

  /** Make a theme the default (presentations made in Drashti start with it). False if it does not exist. */
  setDefault(id: string): boolean {
    if (!this.get(id)) return false;
    this.db
      .prepare(
        'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(DEFAULT_KEY, id);
    return true;
  }

  /** The theme for new slides: this one if it still exists, else the default. */
  themeOrDefault(id: string | null): Theme {
    const found = id ? this.get(id) : null;
    if (found) return found;
    const defaultId = this.defaultId();
    return this.get(defaultId) ?? { id: defaultId, ...DEFAULT_THEME };
  }
}
