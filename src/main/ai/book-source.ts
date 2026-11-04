import { createHash } from 'node:crypto';
import { bookHintSchema } from '../../shared/ai-speech';
import { passageId, type ShastraHit } from '../../shared/shastra';
import { cutText } from '../../shared/text';
import type { Db } from '../db/database';
import type { ShastraRepo } from '../db/shastra';
export function bookStamp(id: string, loadedAt: string, sourceHash: string | null, text: string): string {
  return createHash('sha256')
    .update([id, loadedAt, sourceHash ?? '', text].join('\0'))
    .digest('hex');
}
export function bookHit(db: Db, books: ShastraRepo, input: unknown): ShastraHit | null {
  const parsed = bookHintSchema.safeParse(input);
  if (!parsed.success) return null;
  const hint = parsed.data;
  const row = db
    .prepare(
      `SELECT i.id, x.loaded_at, x.source_hash, t.text FROM shastra_items i
    JOIN shastra_texts x ON x.id=i.text_id JOIN shastra_item_texts t ON t.item_id=i.id
    WHERE i.id=? AND t.lang=? AND t.made=0`,
    )
    .get(hint.itemId, hint.lang) as
    { id: string; loaded_at: string; source_hash: string | null; text: string } | undefined;
  if (!row || bookStamp(row.id, row.loaded_at, row.source_hash, row.text) !== hint.stamp) return null;
  const key = books.itemKey(row.id);
  if (!key) return null;
  const reference = books.display(key);
  if (!reference) return null;
  return {
    passageId: passageId(key),
    reference,
    lang: hint.lang,
    snippet: cutText(row.text.split('\n').find((line) => line.trim() !== '') ?? '', 160, '…'),
  };
}
