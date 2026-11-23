import type { Db } from './db/database';

const HIDDEN = '[library name]';

/** Names the library holds, to blank out wherever they appear. */
export function libraryNames(db: Db): string[] {
  const rows = db
    .prepare(
      `SELECT name AS n FROM presentations UNION SELECT name FROM playlists UNION SELECT name FROM media
       UNION SELECT name FROM props UNION SELECT name FROM messages UNION SELECT template FROM messages
       UNION SELECT name FROM timers UNION SELECT name FROM slide_groups UNION SELECT label FROM playlist_items`,
    )
    .pluck()
    .all() as (string | null)[];
  // Short names ("A", "Hi") would blank out ordinary words; they are left.
  return [...new Set(rows.filter((n): n is string => typeof n === 'string').map((n) => n.trim()))].filter(
    (n) => n.length >= 3,
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The text with every one of these names blanked out, longest first. */
export function redactNames(text: string, names: readonly string[]): string {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  let out = text;
  for (let i = 0; i < sorted.length; i += 400) {
    const pattern = new RegExp(
      sorted
        .slice(i, i + 400)
        .map(escape)
        .join('|'),
      'giu',
    );
    out = out.replace(pattern, HIDDEN);
  }
  return out;
}
