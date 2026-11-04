import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { AiSearchHint } from '../../shared/search';
import { cutText } from '../../shared/text';
import { AI_MODEL } from '../../shared/ai';
export interface SourceCandidate {
  key: string;
  presentationId: string;
  slideId: string | null;
  stamp: string;
  text: string;
}
function wordsIn(props: string | null): string {
  if (!props) return '';
  let raw: unknown;
  try {
    raw = JSON.parse(props) as unknown;
  } catch {
    return '';
  }
  if (!raw || typeof raw !== 'object') return '';
  const value = raw as { text?: unknown; runs?: unknown };
  if (Array.isArray(value.runs)) {
    const runs: readonly unknown[] = value.runs;
    return runs
      .flatMap((run) => {
        if (!run || typeof run !== 'object') return [];
        const row = run as { text?: unknown; legacy?: unknown };
        return row.legacy !== true && typeof row.text === 'string' ? [row.text] : [];
      })
      .join('');
  }
  return typeof value.text === 'string' ? value.text : '';
}
function chunks(text: string): string[] {
  const result: string[] = [];
  let pending = '';
  for (const word of text.match(/\S+\s*/gu) ?? []) {
    const bounded = cutText(word, 256);
    if (pending.length + bounded.length > 800 && pending !== '') {
      result.push(pending);
      pending = '';
    }
    pending += bounded;
  }
  if (pending !== '') result.push(pending);
  return result;
}
/** Read-only source connection. No read cursor stays open across inference. */
export class LibraryCorpus {
  private readonly db: Database.Database;
  constructor(file: string) {
    this.db = new Database(file, { readonly: true, fileMustExist: true });
    this.db.pragma('busy_timeout = 50');
  }
  *candidates(): Generator<SourceCandidate> {
    let cursor = 0;
    const titles = this.db.prepare(
      'SELECT rowid AS row, id, name, updated_at, content_rev FROM presentations WHERE rowid > ? AND deleted_at IS NULL ORDER BY rowid LIMIT 64',
    );
    for (;;) {
      const rows = titles.all(cursor) as {
        row: number;
        id: string;
        name: string;
        updated_at: string;
        content_rev: number;
      }[];
      if (!rows.length) break;
      for (const row of rows) {
        cursor = row.row;
        yield {
          key: 'title:' + row.id,
          presentationId: row.id,
          slideId: null,
          stamp: row.updated_at + '#' + String(row.content_rev),
          text: row.name,
        };
      }
    }
    cursor = 0;
    const elements = this.db
      .prepare(`SELECT e.rowid AS row, e.id, e.slide_id, p.id AS presentation_id, p.name, p.updated_at, p.content_rev,
      CASE WHEN length(e.props) <= 100000 THEN e.props ELSE NULL END AS props
      FROM elements e JOIN slides s ON s.id=e.slide_id AND s.enabled=1 JOIN slide_groups g ON g.id=s.group_id
      JOIN presentations p ON p.id=g.presentation_id AND p.deleted_at IS NULL
      WHERE e.rowid > ? AND e.kind='text' ORDER BY e.rowid LIMIT 16`);
    for (;;) {
      const rows = elements.all(cursor) as {
        row: number;
        id: string;
        slide_id: string;
        presentation_id: string;
        name: string;
        updated_at: string;
        content_rev: number;
        props: string | null;
      }[];
      if (!rows.length) break;
      for (const row of rows) {
        cursor = row.row;
        for (const [index, text] of chunks(wordsIn(row.props)).entries())
          yield {
            key: row.id + ':' + String(index),
            presentationId: row.presentation_id,
            slideId: row.slide_id,
            stamp: row.updated_at + '#' + String(row.content_rev),
            text: row.name + '\n' + text,
          };
      }
    }
  }
  close(): void {
    this.db.close();
  }
}
/** Derived vectors only, in a separate cache file so a helper never holds the library's write lock. */
export class VectorCache {
  private readonly db: Database.Database;
  private writes = 0;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, vector BLOB NOT NULL, used_at INTEGER NOT NULL)',
    );
  }
  key(source: SourceCandidate): string {
    return (
      AI_MODEL.files['model.onnx'].sha256 +
      ':' +
      createHash('sha256')
        .update(source.key + '\0' + source.stamp + '\0' + source.text)
        .digest('hex')
    );
  }
  get(key: string): Float32Array | null {
    const row = this.db.prepare('SELECT vector FROM vectors WHERE key=?').get(key) as
      { vector: Buffer } | undefined;
    if (row?.vector.length !== 384 * 4) return null;
    const value = new Float32Array(384);
    for (let i = 0; i < value.length; i++) value[i] = row.vector.readFloatLE(i * 4);
    return value.every(Number.isFinite) ? value : null;
  }
  put(key: string, value: Float32Array): void {
    const bytes = Buffer.alloc(value.length * 4);
    value.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
    this.db
      .prepare('INSERT OR REPLACE INTO vectors (key, vector, used_at) VALUES (?, ?, ?)')
      .run(key, bytes, Date.now());
    if (++this.writes % 100 === 0)
      this.db.exec(
        'DELETE FROM vectors WHERE key IN (SELECT key FROM vectors ORDER BY used_at DESC LIMIT -1 OFFSET 100000)',
      );
  }
  close(): void {
    this.db.close();
  }
}
export function topHints(hints: readonly AiSearchHint[]): AiSearchHint[] {
  const sorted = [...hints].sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return sorted
    .filter((hint) => {
      if (seen.has(hint.presentationId)) return false;
      seen.add(hint.presentationId);
      return true;
    })
    .slice(0, 50);
}
