import { useWhatIsThis } from '../help/WhatIsThis';
import { useEffect } from 'react';
import { festivalsLine, samvatLine } from '../../../shared/calendar';
import { useEngine } from '../engine/engine-store';
import type { AppInfo } from '../../../shared/app-info';
import { describeAppInfo } from '../../../shared/app-info';
import { cancelImport, dismissFinished, openReport, useImports } from '../library/import-store';
import { connectSound, useSound } from '../screens/sound-store';
import { Button } from '../ui/Button';
import { AlertTriangle, CalendarDays, Info, Volume2, X } from '../ui/icons';
import { Progress } from '../ui/Progress';
import { plural } from '../ui/text';
import { Truncate } from '../ui/Truncate';
import { cx } from '../ui/cx';
import { useArrival, useLeaving } from '../ui/motion';
import { useNotice, useTaskProgress } from './actions';
import { ScreensSummary } from './StatusLine';
import { connectNodes, openDashboard, useNodes } from '../nodes/nodes-store';
import { nodeWarnings } from '../../../shared/nodes';
import { useNow } from '../render/useNow';
import { BackupWarning } from '../backups/BackupsDialog';
import { UpdateStatus } from '../updates/UpdatesDialog';
import { LinkStatus } from '../links/LinkDialog';
import { showSave, stopSave, useSaves } from '../markers/save-store';

/*
 * The status bar along the very bottom: the screens connected, where the
 * sound goes, an import or backup under way, and the version. Notices pop up
 * just above it (NoticeArea).
 */

/** Where the sound goes; a warning while the chosen output is not connected. */
function SoundStatus({ onOpen }: { onOpen: (() => void) | null }) {
  const status = useSound((s) => s.status);
  useEffect(() => {
    connectSound();
  }, []);
  if (!status) return null;
  const missing = status.state === 'missing' && status.chosen !== null;
  if (missing && status.chosen)
    return (
      <button
        type="button"
        onClick={onOpen ?? undefined}
        disabled={!onOpen}
        data-testid="sound-warning"
        className="flex min-w-0 items-center gap-1.5 rounded-sm bg-warning-bg px-1.5 py-0.5 text-warning-fg"
      >
        <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{`Sound output "${status.chosen.label}" not connected`}</span>
      </button>
    );
  return (
    <button
      type="button"
      onClick={onOpen ?? undefined}
      disabled={!onOpen}
      title={onOpen ? 'Choose the sound output in Screens' : undefined}
      className="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-muted hover:text-fg"
      data-testid="sound-status"
    >
      <Volume2 size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{`Sound: ${status.chosen?.label ?? 'System default'}`}</span>
    </button>
  );
}

export function describeRun(run: {
  status: string;
  totals: {
    presentations: number;
    media: number;
    skipped: number;
    conflicts: number;
    failed: number;
    unsupported: number;
  };
}): string {
  const t = run.totals;
  const parts: string[] = [];
  if (t.presentations > 0) parts.push(`Imported ${plural(t.presentations, 'presentation')}`);
  if (t.media > 0) parts.push(plural(t.media, 'media file'));
  if (t.skipped > 0) parts.push(`${t.skipped.toLocaleString('en')} already in the library`);
  if (t.conflicts > 0) parts.push(`${plural(t.conflicts, 'file')} changed: choose what to do`);
  if (t.failed > 0) parts.push(plural(t.failed, 'problem'));
  if (t.unsupported > 0) parts.push(`${plural(t.unsupported, 'item')} not imported`);
  if (run.status === 'cancelled') parts.push('cancelled');
  return parts.length > 0 ? parts.join(' · ') : 'Nothing to import';
}

/** An import under way (with Cancel), or how the last one went (with its report). */
function ImportStatus() {
  const runs = useImports((s) => s.runs);
  const finished = useImports((s) => s.finished);
  const error = useImports((s) => s.error);
  const list = Object.values(runs);
  const active = list.find((r) => r.phase !== 'queued') ?? list[0];
  const waiting = list.length - (active ? 1 : 0);
  if (active) {
    const text =
      active.phase === 'queued'
        ? 'Waiting to import…'
        : active.phase === 'scanning'
          ? 'Looking for files…'
          : `Importing ${active.done.toLocaleString('en')} of ${active.total.toLocaleString('en')}${active.current ? ` · ${active.current}` : ''}`;
    return (
      <div data-testid="import-progress" className="flex min-w-0 items-center gap-2">
        <Truncate text={`${text}${waiting > 0 ? ` · ${plural(waiting, 'more import')} waiting` : ''}`} />
        <Progress
          value={active.total > 0 ? active.done / active.total : 0}
          label="Import"
          className="w-24 shrink-0"
        />
        <Button variant="ghost" size="sm" className="h-5" onClick={() => void cancelImport(active.runId)}>
          Cancel
        </Button>
      </div>
    );
  }
  if (error)
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-warning-fg" role="alert">
        <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
        <Truncate text={error} />
        <button type="button" aria-label="Dismiss" onClick={dismissFinished} className="shrink-0 rounded-sm">
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    );
  if (finished)
    return (
      <div
        data-testid="import-result"
        className={`flex min-w-0 items-center gap-1.5${finished.totals.failed > 0 ? ' text-warning-fg' : ''}`}
      >
        {finished.totals.failed > 0 && <AlertTriangle size={13} aria-label="Problems" className="shrink-0" />}
        <Truncate text={describeRun(finished)} />
        <Button variant="secondary" size="sm" className="h-5" onClick={() => void openReport(finished.id)}>
          Report
        </Button>
        <Button variant="ghost" size="sm" className="h-5" onClick={dismissFinished}>
          Dismiss
        </Button>
      </div>
    );
  return null;
}

/**
 * Save as MP4… (Session 26e): the save going, or waiting (on air, or for a conversion), with Stop; and the
 * last one ended, until dismissed.
 */
function SaveStatus({ platform }: { platform: string }) {
  const jobs = useSaves((s) => s.jobs);
  const going = jobs.find((j) => j.state === 'saving') ?? jobs.find((j) => j.state === 'waiting');
  if (going) {
    const text =
      going.state === 'waiting'
        ? `Waiting to save “${going.name}”${going.note ? `: ${going.note}` : ''}`
        : `Saving “${going.name}”`;
    return (
      <div data-testid="save-progress" data-state={going.state} className="flex min-w-0 items-center gap-2">
        <Truncate text={text} />
        {going.state === 'saving' && (
          <Progress value={going.progress ?? 0} label="Saving as MP4" className="w-24 shrink-0" />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-5"
          data-testid="save-stop"
          onClick={() => void stopSave(going.id)}
        >
          Stop
        </Button>
      </div>
    );
  }
  const last = jobs.at(-1);
  if (!last || dismissed.has(last.id)) return null;
  const dismiss = () => {
    dismissed.add(last.id);
    useSaves.setState({ jobs: [...jobs] });
  };
  return (
    <div
      data-testid="save-result"
      data-state={last.state}
      className={cx('flex min-w-0 items-center gap-1.5', last.state === 'failed' && 'text-warning-fg')}
    >
      {last.state === 'failed' && <AlertTriangle size={13} aria-label="Problem" className="shrink-0" />}
      <Truncate
        text={
          last.state === 'done'
            ? `Saved “${last.name}”${last.added ? ', and added to the library' : ''}`
            : last.state === 'stopped'
              ? `Stopped saving “${last.name}”: nothing was kept`
              : `Could not save “${last.name}”: ${last.message ?? ''}`
        }
      />
      {last.state === 'done' && (
        <Button variant="secondary" size="sm" className="h-5" onClick={() => void showSave(last.id)}>
          {platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer'}
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-5" onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  );
}

/** Saves the operator dismissed from the status bar (this window only). */
const dismissed = new Set<string>();

/** A long task such as a backup copying the media. */
function TaskStatus() {
  const progress = useTaskProgress((s) => s.progress);
  if (!progress) return null;
  return (
    <div role="status" data-testid="task-progress" className="flex min-w-0 items-center gap-2">
      <Truncate text={progress.label} />
      <Progress value={progress.fraction} label={progress.label} className="w-24 shrink-0" />
    </div>
  );
}

/** Today's Samvat date and tithi, with any festival (from the loaded calendars); nothing when they do not give today. */
function TodayStatus({ onOpen }: { onOpen: (() => void) | null }) {
  const day = useEngine((s) => s.state?.calendar ?? null);
  if (!day) return null;
  const festivals = festivalsLine(day, 'en');
  return (
    <button
      type="button"
      onClick={onOpen ?? undefined}
      disabled={!onOpen}
      title={onOpen ? 'The calendar' : undefined}
      data-testid="today-calendar"
      className="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-muted hover:text-fg disabled:hover:text-muted"
    >
      <CalendarDays size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">
        {samvatLine(day, 'en')}
        {festivals && <strong className="text-warning-fg">{` · ${festivals}`}</strong>}
      </span>
    </button>
  );
}

/** A node offline, behind on media or out of step (Session 13): the first, and how many more; opens the dashboard. */
function NodeWarnings() {
  const status = useNodes((s) => s.status);
  const now = useNow(2000);
  useEffect(() => {
    connectNodes();
  }, []);
  const warnings = status ? nodeWarnings(status.nodes, now) : [];
  const first = warnings[0];
  if (!first) return null;
  return (
    <button
      type="button"
      onClick={openDashboard}
      title="Open the screens dashboard"
      data-testid="node-warning"
      className="flex min-w-0 items-center gap-1.5 rounded-sm bg-warning-bg px-1.5 py-0.5 text-warning-fg"
    >
      <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">
        {first.text}
        {warnings.length > 1 ? ` (and ${warnings.length - 1} more)` : ''}
      </span>
    </button>
  );
}

export function StatusBar({
  info,
  onOpenScreens,
  onOpenCalendar = null,
}: {
  info: AppInfo | null;
  /** Null in Simple Mode, where the screens cannot be set up. */
  onOpenScreens: (() => void) | null;
  /** The Calendar dialog (Pro Mode). */
  onOpenCalendar?: (() => void) | null;
}) {
  // What is this? (Sessions 31–36): its ? at the end of the bar, its words just above it (Pro Mode only).
  const help = useWhatIsThis('statusbar');
  return (
    <>
      {help.card && <div className="shrink-0 border-t border-line pt-2">{help.card}</div>}
      <footer
        className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-ink px-2 text-xs text-muted"
        aria-label="Status"
      >
        {/* The screens dashboard opens from here in both modes (Simple Mode only looks). */}
        <ScreensSummary onOpen={openDashboard} />
        <NodeWarnings />
        <BackupWarning />
        <UpdateStatus />
        <LinkStatus />
        <SoundStatus onOpen={onOpenScreens} />
        <TodayStatus onOpen={onOpenCalendar} />
        <div aria-live="polite" className="flex min-w-0 flex-1 items-center gap-3">
          <ImportStatus />
          <SaveStatus platform={info?.platform ?? 'darwin'} />
          <TaskStatus />
        </div>
        {help.button}
        <span data-testid="app-info" className="shrink-0 text-faint">
          {info ? describeAppInfo(info) : ''}
        </span>
      </footer>
    </>
  );
}

/** Things to tell the operator (a restore, saved diagnostics, a command that failed), above the status bar. */
export function NoticeArea() {
  const notice = useNotice((s) => s.text);
  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed right-3 bottom-24 z-30 flex w-[min(30rem,calc(100%-1.5rem))] justify-end">
      {/* A new notice arrives (rising 6 px) as the last one leaves. */}
      <NoticeCard key={notice} notice={notice} />
    </div>
  );
}

function NoticeCard({ notice }: { notice: string }) {
  const ref = useLeaving<HTMLDivElement>('notice');
  const arriving = useArrival('notice');
  return (
    <div
      ref={ref}
      role="alert"
      data-testid="operator-notice"
      data-motion={arriving}
      className="pointer-events-auto flex w-full items-start gap-2 rounded-lg border border-line-strong border-l-4 border-l-accent bg-panel-3 px-3 py-2 text-sm text-fg shadow-overlay"
    >
      <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 break-words">{notice}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          useNotice.setState({ text: null });
        }}
        className="-my-0.5 -mr-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-panel-2"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
