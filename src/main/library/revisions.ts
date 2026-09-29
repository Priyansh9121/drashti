import { randomUUID } from 'node:crypto';
import type { ContentRows } from '../db/content';

/**
 * Copies of presentations' content from before a change (edited words, a
 * theme), for Undo. Kept in memory for this run of Drashti, as the Undo
 * list itself is; the oldest go first.
 */
export class Revisions {
  private readonly kept = new Map<string, ContentRows[]>();

  constructor(private readonly limit = 40) {}

  /** Keep copies (one change can cover several presentations); returns the id Undo uses. */
  keep(rows: ContentRows[]): string {
    const id = randomUUID();
    this.kept.set(id, rows);
    while (this.kept.size > this.limit) {
      const oldest = this.kept.keys().next().value;
      if (oldest === undefined) break;
      this.kept.delete(oldest);
    }
    return id;
  }

  /** The copies, once: Undo uses them up. */
  take(id: string): ContentRows[] | null {
    const rows = this.kept.get(id) ?? null;
    this.kept.delete(id);
    return rows;
  }
}
