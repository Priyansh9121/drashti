import { randomUUID } from 'node:crypto';
import type { ContentRows } from '../db/content';
import { cuePropsRenamed } from '../db/input-renames';

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

  /**
   * A video input renamed in Media (Session 52; ../db/input-renames.ts): the copies' slides name it by its new name
   * too, as the library's do now, so undoing a change made before never puts its old name back.
   */
  carryInput(from: string, to: string): void {
    for (const [id, copies] of this.kept)
      this.kept.set(
        id,
        copies.map((rows) => ({
          ...rows,
          cues: rows.cues.map((c) => {
            const props = cuePropsRenamed({ kind: c.kind, mediaId: c.media_id, props: c.props }, from, to);
            return props === null ? c : { ...c, props };
          }),
        })),
      );
  }
}
