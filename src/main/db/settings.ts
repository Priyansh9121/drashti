import type { Statement } from 'better-sqlite3';
import type { Db } from './database';

/** App settings, as JSON values in app_meta under "setting.<name>". */
export class SettingsRepo {
  private readonly getStmt: Statement<[string], { value: string }>;
  private readonly setStmt: Statement<[string, string]>;

  constructor(db: Db) {
    this.getStmt = db.prepare('SELECT value FROM app_meta WHERE key = ?');
    this.setStmt = db.prepare(
      'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
  }

  /** The stored value, or undefined when there is none (or it cannot be read). */
  get(name: string): unknown {
    const row = this.getStmt.get(`setting.${name}`);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return undefined;
    }
  }

  set(name: string, value: unknown): void {
    this.setStmt.run(`setting.${name}`, JSON.stringify(value));
  }
}
