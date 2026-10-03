import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { formatBytes } from '../../../shared/format';
import type { ConflictChoice, ImportItemReport, ImportRunSummary } from '../../../shared/import';
import { describeRun } from '../operator/StatusBar';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Select } from '../ui/Field';
import { ChevronRight, FolderOpen, Wand2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { plural } from '../ui/text';
import { Truncate } from '../ui/Truncate';
import {
  closeReport,
  fileToImport,
  importPaths,
  openReport,
  relinkMedia,
  resolveConflicts,
  useImports,
} from './import-store';
import { convert, connectConversions, jobFor, useConvert } from './convert-store';
import { leaveItem, loadMedia, selectPresentation, useLibrary, useMedia } from './library-store';

/*
 * The migration report (PLAN.md 4.4): what came across, what did not, and a
 * way to fix each item.
 */

const WRITTEN = new Set(['imported', 'replaced', 'kept-both']);

function openPresentation(id: string) {
  closeReport();
  leaveItem();
  useLibrary.setState({ marked: [id], anchorId: id });
  void selectPresentation(id);
}

function tryAgain(sourcePath: string) {
  closeReport();
  void importPaths([fileToImport(sourcePath)]);
}

/** Convert a file Drashti cannot play (or how it is going, or what came of it). */
function ConvertFix({ mediaId, advice }: { mediaId: string; advice: string }) {
  const job = useConvert((s) => jobFor(s.jobs, mediaId));
  const converted = useMedia((s) => s.media.find((m) => m.id === mediaId)?.convertedTo ?? null);
  if (converted !== null || job?.state === 'done')
    return <span className="text-success-fg">Converted: {converted ?? job?.convertedName}</span>;
  if (job?.state === 'waiting' || job?.state === 'converting')
    return (
      <span className="text-muted" title={job.note ?? undefined}>
        {job.state === 'converting' && job.progress !== null
          ? `Converting… ${Math.round(job.progress * 100)}%`
          : 'Waiting to convert'}
      </span>
    );
  return (
    <Button size="sm" icon={Wand2} title={advice} onClick={() => void convert([mediaId])}>
      {job?.state === 'failed' ? 'Try again' : 'Convert'}
    </Button>
  );
}

/** The buttons that fix an item, from its issues and outcome. */
function Fixes({ item }: { item: ImportItemReport }) {
  const out: ReactNode[] = [];
  const seen = new Set<string>();
  for (const issue of item.issues) {
    const fix = issue.fix;
    // One of each kind of fix (and each piece of advice).
    const key = fix?.kind === 'convert-media' ? `${fix.kind}:${fix.advice}` : fix?.kind;
    if (!fix || !key || seen.has(key)) continue;
    seen.add(key);
    switch (fix.kind) {
      case 'relink-media':
        out.push(
          <Button key="relink" size="sm" onClick={() => void relinkMedia([fix.mediaId])}>
            Find…
          </Button>,
        );
        break;
      case 'import-again':
        out.push(
          <Button key="again" size="sm" onClick={() => tryAgain(fix.sourcePath)}>
            Try again
          </Button>,
        );
        break;
      case 'free-space':
        out.push(
          <span key="space" className="text-muted">
            Free up at least {formatBytes(fix.neededBytes)}, then
          </span>,
          <Button key="again" size="sm" onClick={() => tryAgain(item.sourcePath)}>
            Try again
          </Button>,
        );
        seen.add('import-again');
        break;
      case 'open-presentation':
        out.push(
          <Button key="open" size="sm" onClick={() => openPresentation(fix.presentationId)}>
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
      case 'convert-media':
        out.push(<ConvertFix key={key} mediaId={fix.mediaId} advice={fix.advice} />);
        break;
      case 'choose':
        break;
    }
  }
  const target = item.target;
  if (target?.kind === 'presentation' && !seen.has('open-presentation') && item.outcome !== 'conflict') {
    out.push(
      <Button key="open" size="sm" onClick={() => openPresentation(target.id)}>
        Open
      </Button>,
    );
  }
  if (item.outcome === 'failed' && !seen.has('import-again') && item.format !== 'unknown') {
    out.push(
      <Button key="again" size="sm" onClick={() => tryAgain(item.sourcePath)}>
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
      className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Truncate text={item.name ?? item.sourcePath} className="font-medium" />
          {item.message && <div className="text-xs text-muted">{item.message}</div>}
          {item.issues
            .filter((i) => i.message !== item.message)
            .map((issue, n) => (
              <div
                key={n}
                className={`text-xs ${issue.severity === 'error' ? 'text-danger-fg' : issue.severity === 'warning' ? 'text-warning-fg' : 'text-muted'}`}
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
    <details open={open} className="group space-y-2" data-testid="report-section">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md text-sm font-bold">
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 transition-transform group-open:rotate-90"
        />
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
    if (!reportId) return;
    void window.drashti.library.listImportRuns().then(setRuns);
    connectConversions();
    // Which files are converted already.
    void loadMedia();
  }, [reportId]);
  const media = useMedia((s) => s.media);
  const jobs = useConvert((s) => s.jobs);
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
  // Files still to convert: not converted, and not being converted.
  const toConvert = [
    ...new Set(
      items.flatMap((i) => i.issues.flatMap((x) => (x.fix?.kind === 'convert-media' ? [x.fix.mediaId] : []))),
    ),
  ].filter((id) => {
    const job = jobFor(jobs, id);
    return (
      (media.find((m) => m.id === id)?.convertedTo ?? null) === null &&
      job?.state !== 'waiting' &&
      job?.state !== 'converting' &&
      job?.state !== 'done'
    );
  });
  const missingMedia = items.reduce(
    (n, i) => n + i.issues.filter((x) => x.fix?.kind === 'relink-media').length,
    0,
  );
  const conflictButtons = (paths: string[], suffix = '') =>
    (['replace', 'keep-both', 'skip'] as const).map((choice) => (
      <Button
        key={choice}
        variant={choice === 'replace' ? 'primary' : 'secondary'}
        size="sm"
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
    <Dialog
      title="Import report"
      subtitle={
        <>
          {new Date(report.startedAt).toLocaleString()} ·{' '}
          {report.status === 'done' ? 'finished' : report.status}
          {report.message ? ` · ${report.message}` : ''}
        </>
      }
      size="lg"
      onClose={closeReport}
      testId="import-report"
      bodyClassName="space-y-4"
      headerActions={
        runs.length > 1 && (
          <Select
            aria-label="Earlier imports"
            className="max-w-56"
            value={report.id}
            onChange={(e) => void openReport(e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.startedAt).toLocaleString()} · {describeRun(r)}
              </option>
            ))}
          </Select>
        )
      }
    >
      <p className="text-sm" data-testid="report-summary">
        {cameAcross.length > 0 ? `Came across: ${cameAcross.join(' · ')}.` : 'Nothing new came across.'}{' '}
        {outcomes.length > 0 && <span className="text-muted">{outcomes.join(' · ')}.</span>}
      </p>
      {toConvert.length > 0 && (
        <Notice
          tone="info"
          role="none"
          data-testid="convert-media"
          actions={
            <Button
              size="sm"
              icon={Wand2}
              data-testid="report-convert-all"
              onClick={() => void convert(toConvert)}
            >
              Convert all
            </Button>
          }
        >
          {plural(toConvert.length, 'media file')} Drashti cannot play. Convert makes a copy it plays, in its
          media folder, and uses it everywhere; the original stays as it is, and Undo puts it back.
        </Notice>
      )}
      {missingMedia > 0 && (
        <Notice
          tone="warning"
          role="none"
          data-testid="missing-media"
          actions={
            <Button size="sm" icon={FolderOpen} onClick={() => void relinkMedia()}>
              Find missing media…
            </Button>
          }
        >
          {plural(missingMedia, 'media file')} could not be found. Pick a folder to look in, and Drashti
          relinks every missing file it finds there by name.
        </Notice>
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
    </Dialog>
  );
}
