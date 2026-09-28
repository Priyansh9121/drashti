import { randomUUID } from 'node:crypto';
import type {
  ImportCounts,
  ImportFormat,
  ImportIssue,
  ImportItemReport,
  ImportOptions,
  ImportReport,
  ImportRunStatus,
  ImportRunSummary,
  ImportTotals,
  ItemOutcome,
} from '../../shared/import';
import { emptyTotals, NO_COUNTS } from '../../shared/import';
import type { Db } from './database';

/*
 * Import runs and their reports (PLAN.md 4.4: a migration report after every
 * import). The import worker writes them; the operator window reads them.
 */

export type NewImportItem = Omit<ImportItemReport, 'id'>;

interface RunRow {
  id: string;
  status: ImportRunStatus;
  paths: string;
  totals: string;
  message: string | null;
  started_at: string;
  finished_at: string | null;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toSummary(r: RunRow): ImportRunSummary {
  return {
    id: r.id,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    paths: parseJson<string[]>(r.paths, []),
    totals: { ...emptyTotals(), ...parseJson<Partial<ImportTotals>>(r.totals, {}) },
    message: r.message,
  };
}

/** Add one item's outcome and counts to a run's totals. */
export function addToTotals(totals: ImportTotals, item: NewImportItem, files = 1): void {
  totals.files += files;
  const key: Record<ItemOutcome, keyof ImportTotals> = {
    imported: 'imported',
    replaced: 'replaced',
    'kept-both': 'keptBoth',
    skipped: 'skipped',
    conflict: 'conflicts',
    failed: 'failed',
    unsupported: 'unsupported',
  };
  totals[key[item.outcome]] += 1;
  totals.issues += item.issues.length;
  if (item.outcome === 'imported' || item.outcome === 'replaced' || item.outcome === 'kept-both') {
    for (const k of Object.keys(NO_COUNTS) as (keyof ImportCounts)[]) totals[k] += item.counts[k];
  }
}

export class ImportRepo {
  constructor(private readonly db: Db) {}

  startRun(id: string, paths: readonly string[], options: ImportOptions): void {
    this.db
      .prepare("INSERT INTO import_runs (id, status, paths, options) VALUES (?, 'running', ?, ?)")
      .run(id, JSON.stringify(paths), JSON.stringify({ onConflict: options.onConflict ?? 'ask' }));
  }

  /** Record one item of a run (call inside the transaction that wrote its content). */
  addItem(runId: string, position: number, item: NewImportItem): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO import_items (id, run_id, position, source_path, format, outcome, name, target_kind, target_id, counts, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        runId,
        position,
        item.sourcePath,
        item.format,
        item.outcome,
        item.name,
        item.target?.kind ?? null,
        item.target?.id ?? null,
        JSON.stringify(item.counts),
        item.message,
      );
    const insertIssue = this.db.prepare(
      'INSERT INTO import_issues (item_id, severity, code, message, fix) VALUES (?, ?, ?, ?, ?)',
    );
    for (const issue of item.issues) {
      insertIssue.run(
        id,
        issue.severity,
        issue.code,
        issue.message,
        issue.fix ? JSON.stringify(issue.fix) : null,
      );
    }
    return id;
  }

  finishRun(id: string, status: ImportRunStatus, totals: ImportTotals, message: string | null = null): void {
    this.db
      .prepare(
        `UPDATE import_runs SET status = ?, totals = ?, message = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .run(status, JSON.stringify(totals), message, id);
  }

  /**
   * Mark a run failed from outside the worker (it crashed or could not
   * start). Totals are rebuilt from the items it managed to write.
   */
  failRun(id: string, paths: readonly string[], message: string): void {
    this.db.transaction(() => {
      this.db
        .prepare("INSERT OR IGNORE INTO import_runs (id, status, paths) VALUES (?, 'running', ?)")
        .run(id, JSON.stringify(paths));
      const totals = emptyTotals();
      for (const item of this.items(id)) addToTotals(totals, item);
      this.db
        .prepare(
          `UPDATE import_runs SET status = 'failed', totals = ?, message = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND status = 'running'`,
        )
        .run(JSON.stringify(totals), message, id);
    })();
  }

  summary(id: string): ImportRunSummary | null {
    const r = this.db.prepare('SELECT * FROM import_runs WHERE id = ?').get(id) as RunRow | undefined;
    return r ? toSummary(r) : null;
  }

  /** Recent runs, newest first. */
  listRuns(limit = 50): ImportRunSummary[] {
    return (
      this.db
        .prepare('SELECT * FROM import_runs ORDER BY started_at DESC, rowid DESC LIMIT ?')
        .all(limit) as RunRow[]
    ).map(toSummary);
  }

  items(runId: string): ImportItemReport[] {
    const rows = this.db
      .prepare('SELECT * FROM import_items WHERE run_id = ? ORDER BY position, rowid')
      .all(runId) as {
      id: string;
      source_path: string;
      format: ImportFormat;
      outcome: ItemOutcome;
      name: string | null;
      target_kind: 'presentation' | 'media' | 'playlist' | null;
      target_id: string | null;
      counts: string;
      message: string | null;
    }[];
    const issues = this.db
      .prepare(
        `SELECT i.item_id, i.severity, i.code, i.message, i.fix FROM import_issues i
           JOIN import_items t ON t.id = i.item_id WHERE t.run_id = ? ORDER BY i.id`,
      )
      .all(runId) as {
      item_id: string;
      severity: ImportIssue['severity'];
      code: string;
      message: string;
      fix: string | null;
    }[];
    const byItem = new Map<string, ImportIssue[]>();
    for (const i of issues) {
      const list = byItem.get(i.item_id) ?? [];
      list.push({ severity: i.severity, code: i.code, message: i.message, fix: parseJson(i.fix, null) });
      byItem.set(i.item_id, list);
    }
    return rows.map((r) => ({
      id: r.id,
      sourcePath: r.source_path,
      format: r.format,
      outcome: r.outcome,
      name: r.name,
      target: r.target_kind && r.target_id ? { kind: r.target_kind, id: r.target_id } : null,
      counts: { ...NO_COUNTS, ...parseJson<Partial<ImportCounts>>(r.counts, {}) },
      message: r.message,
      issues: byItem.get(r.id) ?? [],
    }));
  }

  report(id: string): ImportReport | null {
    const summary = this.summary(id);
    return summary ? { ...summary, items: this.items(id) } : null;
  }
}
