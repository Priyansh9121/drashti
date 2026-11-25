import { expect, it } from 'vitest';
import { openDatabase } from './database';
import { MediaRepo } from './media';

/*
 * The bytes whose page copies are kept (QA23-FADE-9 candidate 1, a22-review-fadecopies S6): those of every media row
 * that still has its file in the library, deleted-but-undoable and missing ones included; never a purged row's (its
 * path emptied before its files go: after a crash between the two, its copies would stay for ever). Placeholder rows.
 */

it('keeps the bytes of rows with a file, deleted ones that can be undone and missing ones too; a purged row’s go', () => {
  const db = openDatabase(':memory:');
  const media = new MediaRepo(db);
  const add = (id: string, path: string, sha: string | null, deletedAt: string | null = null) =>
    db
      .prepare(
        `INSERT INTO media (id, kind, name, path, sha256, deleted_at)
         VALUES (?, 'video', 'Placeholder clip.webm', ?, ?, ?)`,
      )
      .run(id, path, sha, deletedAt);
  const DELETED = '2026-11-25T10:00:00.000Z';
  add('kept', 'aa/kept.webm', 'a'.repeat(64));
  add('undoable', 'bb/undoable.webm', 'b'.repeat(64), DELETED);
  add('missing', 'cc/missing.webm', 'c'.repeat(64));
  db.prepare("UPDATE media SET missing = 1 WHERE id = 'missing'").run();
  add('purged', '', 'd'.repeat(64), DELETED);
  add('unread', 'ee/unread.webm', null);
  expect([...media.liveSha256s()].sort()).toEqual(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]);
  // The same bytes in a purged row and a kept one: kept.
  add('purged twin', '', 'a'.repeat(64), DELETED);
  expect(media.liveSha256s().has('a'.repeat(64))).toBe(true);
});
