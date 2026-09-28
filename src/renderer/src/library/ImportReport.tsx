import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { formatBytes } from '../../../shared/format';
import type { ConflictChoice, ImportItemReport, ImportRunSummary } from '../../../shared/import';
import { describeRun } from '../operator/PresentationList';
import { Button } from '../ui/Button';
import { plural } from '../ui/text';
import {
  closeReport,
  fileToImport,
  importPaths,
  openReport,
  relinkMedia,
  resolveConflicts,
  useImports,
} from './import-store';
import { selectPresentation, useLibrary } from './library-store';

/*
 * The migration report (PLAN.md 4.4): what came across, what did not, and a
 * way to fix each item.
 */

const WRITTEN = new Set(['imported', 'replaced', 'kept-both']);

function openPresentation(id: string) {
  closeReport();
  useLibrary.setState({ marked: [id], anchorId: id });
  void selectPresentation(id);
}

function tryAgain(sourcePath: string) {
  closeReport();
  void importPaths([fileToImport(sourcePath)]);
}

/** The buttons that fix an item, from its issues and outcome. */
function Fixes({ item }: { item: ImportItemReport }) {
  const out: ReactNode[] = [];
  const seen = new Set<string>();
  for (const issue of item.issues) {
    const fix = issue.fix;
    if (!fix || seen.has(fix.kind)) continue;
    seen.add(fix.kind);
    switch (fix.kind) {
      case 'relink-media':
        out.push(
          <Button
            key="relink"
            className="px-2 py-0.5 text-xs"
            onClick={() => void relinkMedia([fix.mediaId])}
          >
            Find…
          </Button>,
        );
        break;
      case 'import-again':
        out.push(
          <Button key="again" className="px-2 py-0.5 text-xs" onClick={() => tryAgain(fix.sourcePath)}>
            Try again
          </Button>,
        );
        break;
      case 'free-space':
        out.push(
          <span key="space" className="text-muted">
            Free up at least {formatBytes(fix.neededBytes)}, then
          </span>,
          <Button key="again" className="px-2 py-0.5 text-xs" onClick={() => tryAgain(item.sourcePath)}>
            Try again
          </Button>,
        );
        seen.add('import-again');
        break;
      case 'open-presentation':
        out.push(
          <Button
            key="open"
            className="px-2 py-0.5 text-xs"
            onClick={() => openPresentation(fix.presentationId)}
          >
            Open
          </Button>,
        );
        break;
      case 'convert-font':
        out.push(
          <span key="font" className="text-muted">
            No converter for {fix.font} yet: it shows in its own font.
          </span>,
        );
        break;
      case 'choose':
        break;
    }
  }
  const target = item.target;
  if (target?.kind === 'presentation' && !seen.has('open-presentation') && item.outcome !== 'conflict') {
    out.push(
      <Button key="open" className="px-2 py-0.5 text-xs" onClick={() => openPresentation(target.id)}>
        Open
      </Button>,
    );
  }
  if (item.outcome === 'failed' && !seen.has('import-again') && item.format !== 'unknown') {
    out.push(
      <Button key="again" className="px-2 py-0.5 text-xs" onClick={() => tryAgain(item.sourcePath)}>
        Try again
      </Button>,
    );
  }
  return out.length > 0 ? <span className="flex shrink-0 flex-wrap items-center gap-1">{out}</span> : null;
}

function Row({ item, children }: { item: ImportItemReport; children?: ReactNode }) {
  return (
    <li
      data-testid="report-item"
      data-outcome={item.outcome}
      className="rounded-md bg-panel-2 px-3 py-2 text-sm"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={item.sourcePath}>
            {item.name ?? item.sourcePath}
          </div>
          {item.message && <div className="text-xs text-muted">{item.message}</div>}
          {item.issues
            .filter((i) => i.message !== item.message)
            .map((issue, n) => (
              <div
                key={n}
                className={`text-xs ${issue.severity === 'error' ? 'text-red-300' : issue.severity === 'warning' ? 'text-amber-200' : 'text-muted'}`}
              >
                {issue.message}
              </div>
            ))}
        </div>
        {children ?? <Fixes item={item} />}
      </div>
    </li>
  );
}

function Section({
  title,
  items,
  open = true,
  actions,
  render,
}: {
  title: string;
  items: ImportItemReport[];
  open?: boolean;
  actions?: ReactNode;
  render?: (item: ImportItemReport) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <details open={open} className="space-y-2" data-testid="report-section">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <span className="flex-1">
          {title} ({items.length.toLocaleString('en')})
        </span>
        {actions}
      </summary>
      <ul className="space-y-1">
        {items.map((item) => (render ? render(item) : <Row key={item.id} item={item} />))}
      </ul>
    </details>
  );
}

const choiceLabel: Record<ConflictChoice, string> = {
  replace: 'Replace',
  'keep-both': 'Keep both',
  skip: 'Skip',
};

export function ImportReportDialog() {
  const report = useImports((s) => s.report);
  const [runs, setRuns] = useState<ImportRunSummary[]>([]);
  const reportId = report?.id;
  useEffect(() => {
    if (reportId) void window.drashti.library.listImportRuns().then(setRuns);
  }, [reportId]);
  if (!report) return null;

  const items = report.items;
  const conflicts = items.filter((i) => i.outcome === 'conflict');
  const problems = items.filter((i) => i.outcome === 'failed');
  const unsupported = items.filter((i) => i.outcome === 'unsupported');
  const written = items.filter((i) => WRITTEN.has(i.outcome));
  const withNotes = written.filter((i) => i.issues.length > 0);
  const skipped = items.filter((i) => i.outcome === 'skipped');
  const t = report.totals;
  const cameAcross = [
    t.presentations && plural(t.presentations, 'presentation'),
    t.groups && plural(t.groups, 'group'),
    t.slides && plural(t.slides, 'slide'),
    t.arrangements && plural(t.arrangements, 'arrangement'),
    t.playlists && plural(t.playlists, 'playlist'),
    t.media && plural(t.media, 'media file'),
  ].filter(Boolean);

  const outcomes = [
    t.skipped && `${t.skipped.toLocaleString('en')} already in the library`,
    t.conflicts &&
      `${plural(t.conflicts, 'file')} changed since ${t.conflicts === 1 ? 'it was' : 'they were'} imported`,
    t.failed && plural(t.failed, 'problem'),
    t.unsupported && `${plural(t.unsupported, 'item')} not imported`,
    report.status === 'cancelled' && 'Cancelled',
  ].filter(Boolean);
  const conflictPaths = conflicts.map((i) => i.sourcePath);
  const missingMedia = items.reduce(
    (n, i) => n + i.issues.filter((x) => x.fix?.kind === 'relink-media').length,
    0,
  );
  const conflictButtons = (paths: string[], suffix = '') =>
    (['replace', 'keep-both', 'skip'] as const).map((choice) => (
      <Button
        key={choice}
        tone={choice === 'replace' ? 'primary' : 'default'}
        className="px-2 py-0.5 text-xs"
        onClick={(e) => {
          e.preventDefault();
          void resolveConflicts(paths, choice);
        }}
      >
        {choiceLabel[choice]}
        {suffix}
      </Button>
    ));

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      data-testid="import-report"
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeReport();
      }}
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="report-title" className="text-lg font-semibold">
              Import report
            </h2>
            <p className="text-xs text-muted">
              {new Date(report.startedAt).toLocaleString()} ·{' '}
              {report.status === 'done' ? 'finished' : report.status}
              {report.message ? ` · ${report.message}` : ''}
            </p>
          </div>
          {runs.length > 1 && (
            <select
              aria-label="Earlier imports"
              className="max-w-56 rounded-md border border-line bg-panel-2 px-2 py-1 text-xs"
              value={report.id}
              onChange={(e) => void openReport(e.target.value)}
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.startedAt).toLocaleString()} · {describeRun(r)}
                </option>
              ))}
            </select>
          )}
          <Button autoFocus onClick={closeReport}>
            Close
          </Button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-sm" data-testid="report-summary">
            {cameAcross.length > 0 ? `Came across: ${cameAcross.join(' · ')}.` : 'Nothing new came across.'}{' '}
            {outcomes.length > 0 && <span className="text-muted">{outcomes.join(' · ')}.</span>}
          </p>
          {missingMedia > 0 && (
            <div
              className="flex items-center gap-3 rounded-md border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm"
              data-testid="missing-media"
            >
              <span className="flex-1">
                {plural(missingMedia, 'media file')} could not be found. Pick a folder to look in, and Drashti
                relinks every missing file it finds there by name.
              </span>
              <Button className="px-2 py-0.5 text-xs" onClick={() => void relinkMedia()}>
                Find missing media…
              </Button>
            </div>
          )}
          <Section
            title="Changed since they were imported"
            items={conflicts}
            actions={
              conflicts.length > 1 ? (
                <span className="flex gap-1">{conflictButtons(conflictPaths, ' for all')}</span>
              ) : null
            }
            render={(item) => (
              <Row key={item.id} item={item}>
                <span className="flex shrink-0 gap-1">{conflictButtons([item.sourcePath])}</span>
              </Row>
            )}
          />
          <Section title="Problems" items={problems} />
          <Section title="Imported with notes" items={withNotes} />
          <Section title="Not imported" items={unsupported} />
          <Section title="Imported" items={written} open={written.length <= 20} />
          <Section title="Already in the library" items={skipped} open={false} />
        </div>
      </div>
    </div>
  );
}
