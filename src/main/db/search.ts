import { occasionsFrom } from '../../shared/kirtans';
import type { KirtanField, SearchHit, SearchResult } from '../../shared/search';
import { ftsQuery, matchesAll, SEARCH_LIMIT, searchWords } from '../../shared/search';
import type { TextRun } from '../../shared/model';
import type { Statement } from 'better-sqlite3';
import type { Db } from './database';

/**
 * Bump to rebuild every library's index at the next start (when what is
 * indexed changes). 2: kirtan lines are only in the slides' words
 * (migration 11). 3: a kirtan's details (migration 13). 4: v and w, and
 * doubled vowels, fold together (Session 13, shared/search.ts).
 */
export const SEARCH_VERSION = 4;
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

  private readonly statements = new Map<string, Statement>();

  /** Prepared once: search runs on every keystroke. */
  private stmt(sql: string): Statement {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /** Index one presentation again from what is stored. */
  update(presentationId: string): void {
    const p = this.stmt('SELECT name, deleted_at FROM presentations WHERE id = ?').get(presentationId) as
      { name: string; deleted_at: string | null } | undefined;
    if (!p) return;
    const elements = this.stmt(
      `SELECT s.id AS slide_id, e.props AS props
           FROM slide_groups g JOIN slides s ON s.group_id = g.id JOIN elements e ON e.slide_id = s.id
          WHERE g.presentation_id = ? AND e.kind = 'text' AND s.enabled = 1
          ORDER BY g.position, s.position, e.position`,
    ).all(presentationId) as { slide_id: string; props: string }[];
    const { lines, legacyRuns } = textOf(elements);
    const body = lines.map(([, line]) => searchWords(line).join(' ')).join('\n');
    const title = searchWords(p.name).join(' ');
    const details = this.detailsOf(presentationId)
      .map(([, value]) => searchWords(value).join(' '))
      .join('\n');
    const existing = this.stmt('SELECT id FROM search_docs WHERE presentation_id = ?').get(presentationId) as
      { id: number } | undefined;
    let row: number;
    if (existing) {
      row = existing.id;
      this.stmt('DELETE FROM search_fts WHERE rowid = ?').run(row);
      this.stmt('UPDATE search_docs SET lines = ?, legacy_runs = ? WHERE id = ?').run(
        JSON.stringify(lines),
        legacyRuns,
        row,
      );
    } else {
      row = Number(
        this.stmt('INSERT INTO search_docs (presentation_id, lines, legacy_runs) VALUES (?, ?, ?)').run(
          presentationId,
          JSON.stringify(lines),
          legacyRuns,
        ).lastInsertRowid,
      );
    }
    // A removed presentation keeps its lines (Undo brings it back) but is not searched.
    if (p.deleted_at === null)
      this.stmt('INSERT INTO search_fts (rowid, title, body, details) VALUES (?, ?, ?, ?)').run(
        row,
        title,
        body,
        details,
      );
  }

  /** A kirtan's details search reads (none for other presentations). */
  private detailsOf(presentationId: string): [KirtanField, string][] {
    const k = this.stmt('SELECT category, kavi, raag, occasions FROM kirtans WHERE presentation_id = ?').get(
      presentationId,
    ) as { category: string | null; kavi: string | null; raag: string | null; occasions: string } | undefined;
    if (!k) return [];
    const out: [KirtanField, string][] = [];
    if (k.kavi) out.push(['kavi', k.kavi]);
    if (k.raag) out.push(['raag', k.raag]);
    if (k.category) out.push(['category', k.category]);
    for (const o of occasionsFrom(k.occasions)) out.push(['occasion', o]);
    return out;
  }

  /** A presentation was removed: it is no longer found (restoring it indexes it again). */
  drop(presentationId: string): void {
    this.stmt(
      'DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE presentation_id = ?)',
    ).run(presentationId);
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
      this.stmt(
        `SELECT COUNT(*) AS n FROM search_docs d INDEXED BY search_docs_legacy
           JOIN presentations p ON p.id = d.presentation_id
          WHERE d.legacy_runs > 0 AND p.deleted_at IS NULL`,
      ).get() as { n: number }
    ).n;
    const query = ftsQuery(input);
    if (!query) return { query: input, hits: [], more: false, legacyCount };
    // Every match is ranked, so the index alone does it (removed presentations are not in it)...
    const ranked = this.stmt(
      `SELECT rowid FROM search_fts WHERE search_fts MATCH ?
        ORDER BY bm25(search_fts, 10.0, 1.0, 4.0), rowid LIMIT ?`,
    )
      .pluck()
      .all(query, limit + 1) as number[];
    // ...then the names and lines of those shown, to say where each matched.
    const docOf = this.stmt(
      `SELECT p.id, p.name, l.name AS library_name, d.lines
         FROM search_docs d
         JOIN presentations p ON p.id = d.presentation_id AND p.deleted_at IS NULL
         JOIN libraries l ON l.id = p.library_id
        WHERE d.id = ?`,
    );
    const rows = ranked
      .slice(0, limit)
      .map(
        (doc) =>
          docOf.get(doc) as { id: string; name: string; library_name: string; lines: string } | undefined,
      )
      .filter((r) => r !== undefined);
    const words = searchWords(input);
    const hits = rows.map((r): SearchHit => {
      const base = { presentationId: r.id, name: r.name, libraryName: r.library_name };
      if (matchesAll(words, searchWords(r.name))) return { ...base, match: { kind: 'title' } };
      // A kirtan's kavi or raag (or category, or an occasion) with every word typed.
      const detail = this.detailsOf(r.id).find(([, value]) => matchesAll(words, searchWords(value)));
      if (detail) return { ...base, match: { kind: 'detail', field: detail[0], value: detail[1] } };
      const lines = JSON.parse(r.lines) as [string, string][];
      const found =
        lines.find(([, line]) => matchesAll(words, searchWords(line))) ??
        lines.find(([, line]) => matchesAll(words.slice(0, 1), searchWords(line)));
      return found
        ? { ...base, match: { kind: 'text', line: found[1], slideId: found[0] } }
        : { ...base, match: { kind: 'title' } };
    });
    return { query: input, hits, more: ranked.length > limit, legacyCount };
  }

  /** Presentations with text search cannot read yet, by name. */
  legacyPresentations(): { id: string; name: string }[] {
    return this.db
      .prepare(
        `SELECT p.id, p.name FROM search_docs d INDEXED BY search_docs_legacy
           JOIN presentations p ON p.id = d.presentation_id
          WHERE d.legacy_runs > 0 AND p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as { id: string; name: string }[];
  }
}
