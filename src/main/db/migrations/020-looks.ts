import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { groupLanguagesSchema } from '../../../shared/screens-schema';

/**
 * Migration 20: Looks (Session 11).
 *
 * A Look says what each screen group shows (src/shared/looks.ts). Each
 * group's languages move from the group into a Look named "Standard", made
 * here from the groups as they are (`before`), with every other setting at
 * its default (every layer, slides as designed): so the screens show exactly
 * what they did. Looks get a place in the list (the first is the one Drashti
 * starts with), and Standard is first.
 *
 * screen_groups is rebuilt: its languages go (they are in the Looks now),
 * the unused look_id goes (one Look is live for every group), and a group can
 * be a key and fill pair ('keyfill', for a video switcher).
 */
export function before(db: Database.Database): void {
  const rows = db.prepare('SELECT id, languages FROM screen_groups').all() as {
    id: string;
    languages: string | null;
  }[];
  const groups: Record<string, { languages: string[] }> = {};
  for (const row of rows) {
    if (row.languages === null) continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.languages);
    } catch {
      // Unreadable languages showed every language: the default.
    }
    const languages = groupLanguagesSchema.safeParse(parsed);
    if (languages.success && languages.data !== null) groups[row.id] = { languages: languages.data };
  }
  db.prepare(
    "INSERT INTO looks (id, name, definition, source_kind) VALUES (?, 'Standard', ?, 'drashti')",
  ).run(randomUUID(), JSON.stringify({ groups }));
}

const now = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const up = `
ALTER TABLE looks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE looks SET position = 1 WHERE rowid <> (SELECT MAX(rowid) FROM looks);

CREATE TABLE screen_groups_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'audience' CHECK (role IN ('audience', 'stage', 'stream', 'keyfill', 'other')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${now},
  updated_at TEXT NOT NULL DEFAULT ${now}
);
INSERT INTO screen_groups_new (id, name, role, position, created_at, updated_at)
  SELECT id, name, role, position, created_at, updated_at FROM screen_groups;
DROP TABLE screen_groups;
ALTER TABLE screen_groups_new RENAME TO screen_groups;
`;
