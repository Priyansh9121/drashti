import type { SearchHit, SearchResult } from '../../shared/search';
import { ftsQuery, matchesAll, SEARCH_LIMIT, searchWords } from '../../shared/search';
import type { TextRun } from '../../shared/model';
import type { Db } from './database';

/** Bump to rebuild every library's index at the next start (when what is indexed changes). */
export const SEARCH_VERSION = 1;
const VERSION_KEY = 'search.version';

interface TextProps {
  text?: string;
  runs?: TextRun[];
}

/** A presentation's searchable text: lines as written with their slide, and runs search cannot read. */
function textOf(elements: { slide_id: string; props: string }[]): {
  lines: [string, string][];
  legacyRuns: number;
} {
  const lines: [string, string][] = [];
  let legacyRuns = 0;
  for (const { slide_id: slideId, props } of elements) {
    let parsed: TextProps;
    try {
      parsed = JSON.parse(props) as TextProps;
    } catch {
      continue;
    }
    let text = parsed.text ?? '';
    if (parsed.runs) {
      // Legacy-font runs are Latin codes that only look like Gujarati or Hindi: leave them out, and count them.
      legacyRuns += parsed.runs.filter((r) => r.legacy).length;
      text = parsed.runs
        .filter((r) => !r.legacy)
        .map((r) => r.text)
        .join('');
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed !== '') lines.push([slideId, trimmed]);
    }
  }
  return { lines, legacyRuns };
}

/**
 * The library's search index (migration 9). The presentation repository
 * keeps it up to date as presentations are written; removed presentations
 * stay indexed (so Undo needs nothing) but are never found.
 */
export class SearchIndex {
  constructor(private readonly db: Db) {}

  /** Index one presentation again from what is stored. */
  update(presentationId: string): void {
    const db = this.db;
    const p = db.prepare('SELECT name FROM presentations WHERE id = ?').get(presentationId) as
      { name: string } | undefined;
    if (!p) return;
    const elements = db
      .prepare(
        `SELECT s.id AS slide_id, e.props AS props
           FROM slide_groups g JOIN slides s ON s.group_id = g.id JOIN elements e ON e.slide_id = s.id
          WHERE g.presentation_id = ? AND e.kind = 'text' AND s.enabled = 1
          ORDER BY g.position, s.position, e.position`,
      )
      .all(presentationId) as { slide_id: string; props: string }[];
    const { lines, legacyRuns } = textOf(elements);
    // Kirtan language lines, when they are not on the slides already.
    const seen = new Set(lines.map(([, line]) => line));
    const kirtanLines = db
      .prepare('SELECT slide_id, text FROM kirtan_track_lines WHERE kirtan_id = ? ORDER BY lang')
      .all(presentationId) as { slide_id: string; text: string }[];
    for (const { slide_id: slideId, text } of kirtanLines)
      for (const line of text.split(/\r?\n/).map((l) => l.trim()))
        if (line !== '' && !seen.has(line)) {
          seen.add(line);
          lines.push([slideId, line]);
        }
    const body = lines.map(([, line]) => searchWords(line).join(' ')).join('\n');
    const title = searchWords(p.name).join(' ');
    const existing = db
      .prepare('SELECT id FROM search_docs WHERE presentation_id = ?')
      .get(presentationId) as { id: number } | undefined;
    let row: number;
    if (existing) {
      row = existing.id;
      db.prepare('DELETE FROM search_fts WHERE rowid = ?').run(row);
      db.prepare('UPDATE search_docs SET lines = ?, legacy_runs = ? WHERE id = ?').run(
        JSON.stringify(lines),
        legacyRuns,
        row,
      );
    } else {
      row = Number(
        db
          .prepare('INSERT INTO search_docs (presentation_id, lines, legacy_runs) VALUES (?, ?, ?)')
          .run(presentationId, JSON.stringify(lines), legacyRuns).lastInsertRowid,
      );
    }
    db.prepare('INSERT INTO search_fts (rowid, title, body) VALUES (?, ?, ?)').run(row, title, body);
  }

  /** Rebuild the whole index when it was built by another version (or never). Returns whether it did. */
  rebuildIfStale(): boolean {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(VERSION_KEY) as
      { value: string } | undefined;
    if (row?.value === String(SEARCH_VERSION)) return false;
    this.rebuild();
    return true;
  }

  rebuild(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM search_docs').run();
      this.db.prepare('DELETE FROM search_fts').run();
      const ids = this.db.prepare('SELECT id FROM presentations').pluck().all() as string[];
      for (const id of ids) this.update(id);
      this.db
        .prepare(
          'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        )
        .run(VERSION_KEY, String(SEARCH_VERSION));
    })();
  }

  /** Presentations whose title or text has every word typed, best first. */
  search(input: string, limit = SEARCH_LIMIT): SearchResult {
    const legacyCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM search_docs d JOIN presentations p ON p.id = d.presentation_id
            WHERE d.legacy_runs > 0 AND p.deleted_at IS NULL`,
        )
        .get() as { n: number }
    ).n;
    const query = ftsQuery(input);
    if (!query) return { query: input, hits: [], more: false, legacyCount };
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, l.name AS library_name, d.lines
           FROM search_fts f
           JOIN search_docs d ON d.id = f.rowid
           JOIN presentations p ON p.id = d.presentation_id AND p.deleted_at IS NULL
           JOIN libraries l ON l.id = p.library_id
          WHERE search_fts MATCH ?
          ORDER BY bm25(search_fts, 10.0, 1.0), p.name
          LIMIT ?`,
      )
      .all(query, limit + 1) as { id: string; name: string; library_name: string; lines: string }[];
    const words = searchWords(input);
    const hits = rows.slice(0, limit).map((r): SearchHit => {
      const base = { presentationId: r.id, name: r.name, libraryName: r.library_name };
      if (matchesAll(words, searchWords(r.name))) return { ...base, match: { kind: 'title' } };
      const lines = JSON.parse(r.lines) as [string, string][];
      const found =
        lines.find(([, line]) => matchesAll(words, searchWords(line))) ??
        lines.find(([, line]) => matchesAll(words.slice(0, 1), searchWords(line)));
      return found
        ? { ...base, match: { kind: 'text', line: found[1], slideId: found[0] } }
        : { ...base, match: { kind: 'title' } };
    });
    return { query: input, hits, more: rows.length > limit, legacyCount };
  }

  /** Presentations with text search cannot read yet, by name. */
  legacyPresentations(): { id: string; name: string }[] {
    return this.db
      .prepare(
        `SELECT p.id, p.name FROM search_docs d JOIN presentations p ON p.id = d.presentation_id
          WHERE d.legacy_runs > 0 AND p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as { id: string; name: string }[];
  }
}
