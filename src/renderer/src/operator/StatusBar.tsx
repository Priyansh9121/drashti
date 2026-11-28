import './status-bar.css';
import { HelpSwitch } from '../help/HelpSwitch';
import { useWhatIsThis } from '../help/WhatIsThis';
import { showReport } from '../help/report-store';
import { useEffect } from 'react';
import { kindLevel } from '../../../shared/sound';
import { useStatusPriority } from './status-priority';
import { createPortal } from 'react-dom';
import { festivalsLine, samvatLine } from '../../../shared/calendar';
import { useEngine } from '../engine/engine-store';
import type { AppInfo } from '../../../shared/app-info';
import { appInfoParts, describeAppInfo } from '../../../shared/app-info';
import { cancelImport, dismissFinished, useImports } from '../library/import-store';
import { showInMedia } from '../library/library-store';
import { exportMedia } from '../library/export-file';
import { dismissAllImportNotices, useImportNotices } from '../library/import-notices';
import { cancelLinkConversion, connectConversions, useConvert } from '../library/convert-store';
import { convertingWords, jobBusy } from '../library/converting';
import { useMode } from './mode-store';
import { ImportNoticeLine } from './ImportNoticeLine';
import { importProgressText } from './import-status-text';
import { connectSound, useSound } from '../screens/sound-store';
import { Button } from '../ui/Button';
import { AlertTriangle, CalendarDays, Info, Volume2, X } from '../ui/icons';
import { Progress } from '../ui/Progress';
import { plural } from '../ui/text';
import { Tooltip } from '../ui/Tooltip';
import { Truncate } from '../ui/Truncate';
import { cx } from '../ui/cx';
import { useArrival, useLeaving } from '../ui/motion';
import { useNotice, useTaskProgress } from './actions';
import { useNoticePlace } from './notice-place';
import { ScreensSummary } from './StatusLine';
import { SwitchedOffStatus } from './ScreenSwitches';
import { connectNodes, openDashboard, useNodes } from '../nodes/nodes-store';
import { nodeWarnings } from '../../../shared/nodes';
import { useNow } from '../render/useNow';
import { BackupWarning } from '../backups/BackupsDialog';
import { UpdateStatus } from '../updates/UpdatesDialog';
import { LinkStatus } from '../links/LinkDialog';
import { showSave, stopSave, useSaves } from '../markers/save-store';
import { MutedStatus } from '../sound/SoundLevels';
import { CaptionsWarning } from '../captions/CaptionsWarning';
import { AccessOfflineNotice } from '../access/AccessOfflineNotice';
import { focusDisplay } from '../screens/screens-store';
import { ScreensSaidNotice } from '../screens/ScreensSaid';

/*
 * The status bar along the very bottom: the screens connected, where the
 * sound goes, an import or backup under way, what the screens did by
 * themselves (a display plugged in, Stage on with no Stage screen), and the
 * version (in its place, while the access list does not answer, the line
 * saying so). Notices pop up just above it (NoticeArea).
 *
 * Its own controls hold still (alpha.24, lead 2's statusbar; alpha.25 item 17): what is always there comes first, in
 * its order (the screens' summary and Sound in fixed slots; the calendar; Help, with its ?'s room held), and
 * what comes and goes after it (Audience off and Stage off with Turn on, the warnings, what is muted, the captions'
 * warning), then the passing news, which gives up its room, the screens' line and the version's place. So nothing
 * that is always there moves as anything comes or goes (until then Sound and Help moved some 163 px as Stage off came
 * and went). Each control a 24 px target (WCAG 2.5.8), its focus ring inside its own edge (status-bar.css), so the
 * window's edge, 1.5 px under the controls, cuts none of it.
 */

/** Where the sound goes, with the two effective levels when its held slot needs the compact form. */
function SoundStatus({ onOpen }: { onOpen: (() => void) | null }) {
  const status = useSound((s) => s.status);
  const audio = useEngine((s) => Math.round(kindLevel(s.state, 'audio') * 100));
  const video = useEngine((s) => Math.round(kindLevel(s.state, 'video') * 100));
  const chosen = status?.chosen;
  const missing = status?.state === 'missing' && chosen != null;
  const words = missing
    ? `Sound output "${chosen.label}" not connected`
    : `Sound: ${status?.chosen?.label ?? 'System default'}`;
  const { slotRef, wordsRef, compact } = useStatusPriority(words, status !== null);
  useEffect(() => {
    connectSound();
  }, []);
  if (!status) return <span aria-hidden="true" className="status-sound h-6 shrink-0" />;
  const IconShape = missing ? AlertTriangle : Volume2;
  const levels = `Audio: ${audio}%, Video: ${video}%`;
  return (
    <button
      ref={slotRef}
      type="button"
      onClick={onOpen ?? undefined}
      disabled={!onOpen}
      aria-label={words}
      aria-description={`${levels}${onOpen ? ' · Choose the sound output in Screens' : ''}`}
      title={`${words} · ${levels}${onOpen ? ' · Choose the sound output in Screens' : ''}`}
      className={cx(
        'status-sound flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-1.5 tabular-nums',
        missing ? 'bg-warning-bg text-warning-fg' : 'text-muted hover:text-fg',
      )}
      data-testid={missing ? 'sound-warning' : 'sound-status'}
      data-compact={compact}
    >
      <IconShape size={13} aria-hidden="true" className="shrink-0" />
      <span ref={wordsRef} className={cx('whitespace-nowrap', compact && 'sr-only')}>
        {words}
      </span>
      {compact && (
        <span aria-hidden="true" className="truncate">
          {audio === video ? `${audio}%` : `${audio}/${video}%`}
        </span>
      )}
    </button>
  );
}

export function describeRun(run: {
  status: string;
  totals: {
    presentations: number;
    media: number;
    imported: number;
    replaced: number;
    keptBoth: number;
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
  const imported = t.imported + t.replaced + t.keptBoth;
  if (parts.length === 0 && imported > 0) parts.push(`Imported ${plural(imported, 'file')}`);
  if (t.skipped > 0) parts.push(`${t.skipped.toLocaleString('en')} already in the library`);
  if (t.conflicts > 0) parts.push(`${plural(t.conflicts, 'changed file')} left out`);
  if (t.failed > 0) parts.push(plural(t.failed, 'problem'));
  if (t.unsupported > 0) parts.push(`${plural(t.unsupported, 'item')} not imported`);
  if (run.status === 'cancelled') parts.push('cancelled');
  return parts.length > 0 ? parts.join(' · ') : 'Nothing to import';
}

/** An import under way with Cancel, or a brief summary of the latest import. */
function ImportStatus() {
  const runs = useImports((s) => s.runs);
  const finished = useImports((s) => s.finished);
  const list = Object.values(runs);
  const active = list.find((r) => r.phase !== 'queued') ?? list[0];
  const waiting = list.length - (active ? 1 : 0);
  if (active) {
    const text = importProgressText(active);
    return (
      <div data-testid="import-progress" className="flex min-w-0 items-center gap-2">
        <Truncate text={`${text}${waiting > 0 ? ` · ${plural(waiting, 'more import')} waiting` : ''}`} />
        <Progress
          value={active.total > 0 ? active.done / active.total : 0}
          label="Import"
          className="w-24 shrink-0"
        />
        <Button variant="ghost" size="sm" className="h-6!" onClick={() => void cancelImport(active.runId)}>
          Cancel
        </Button>
      </div>
    );
  }
  if (finished)
    return (
      <div
        data-testid="import-result"
        className={`flex min-w-0 items-center gap-1.5${finished.totals.failed > 0 ? ' text-warning-fg' : ''}`}
      >
        {finished.totals.failed > 0 && <AlertTriangle size={13} aria-label="Problems" className="shrink-0" />}
        <Truncate text={describeRun(finished)} />
        <Button variant="ghost" size="sm" className="h-6!" onClick={dismissFinished}>
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
          className="h-6!"
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
        <Button variant="secondary" size="sm" className="h-6!" onClick={() => void showSave(last.id)}>
          {platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer'}
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-6!" onClick={dismiss}>
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

/** Today's words share a bounded room held from first paint, including when no calendar supplies the date. */
function TodayStatus({ onOpen }: { onOpen: (() => void) | null }) {
  const day = useEngine((s) => s.state?.calendar ?? null);
  const festivals = day ? festivalsLine(day, 'en') : '';
  const words = day ? `${samvatLine(day, 'en')}${festivals ? ` · ${festivals}` : ''}` : '';
  // Measure the held room, not the compact button: otherwise its 24 px fallback could never expand again.
  const { slotRef, wordsRef, compact } = useStatusPriority(words, day !== null);
  return (
    <span
      ref={slotRef}
      className="status-calendar-slot relative h-6 shrink-0"
      aria-hidden={!day || undefined}
    >
      {day && (
        <button
          type="button"
          onClick={onOpen ?? undefined}
          disabled={!onOpen}
          aria-label={words}
          title={`${words}${onOpen ? ' · The calendar' : ''}`}
          data-testid="today-calendar"
          data-compact={compact}
          className="status-calendar absolute top-0 left-0 flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-muted hover:text-fg disabled:hover:text-muted"
        >
          <CalendarDays size={13} aria-hidden="true" className="shrink-0" />
          <span ref={wordsRef} className={cx('whitespace-nowrap', compact && 'sr-only')}>
            {samvatLine(day, 'en')}
            {festivals && <strong className="text-warning-fg">{` · ${festivals}`}</strong>}
          </span>
        </button>
      )}
    </span>
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
      className="flex min-h-6 min-w-0 items-center gap-1.5 rounded-sm bg-warning-bg px-1.5 text-warning-fg"
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
  // What is this? (Sessions 31–36): its ? before the bar's passing news, its words just above it (Pro Mode only); its
  // room held while Help is off, so nothing after it moves as Help goes on or off (alpha.24, statusbar).
  const help = useWhatIsThis('statusbar', { keepRoom: true });
  // Live Captions… opens from the captions' line in Pro Mode only (the dialog is Pro Mode's).
  const pro = useMode((s) => s.mode === 'pro');
  return (
    <>
      {help.card && <div className="shrink-0 border-t border-line pt-2">{help.card}</div>}
      <footer
        className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-ink px-2 text-xs text-muted max-[1280px]:gap-2"
        aria-label="Status"
      >
        {/* Fixed slots reserve the compact budget before any warning arrives. Their words collapse within the
            slots, so neither a disconnected output nor a failed screen can move the next control. */}
        <ScreensSummary onOpen={openDashboard} />
        <SoundStatus onOpen={onOpenScreens} />
        <TodayStatus onOpen={onOpenCalendar} />
        {/* Help (alpha.24): the one switch for every ? and the buttons' keys, where the bar's ? was, in both modes; the
            bar's own ? after it while Help is on (Pro Mode's), from 1280 px wide, its room held while Help is off. */}
        <HelpSwitch platform={info?.platform ?? 'darwin'} ask={help.button} />
        {/* What comes and goes, after it, its room taken from the passing news'. Audience or Stage off (Session 50),
            with Turn on: in both modes. */}
        <SwitchedOffStatus />
        <NodeWarnings />
        <BackupWarning />
        <UpdateStatus />
        <LinkStatus platform={info?.platform ?? 'darwin'} />
        {/* Audio or Video muted (X33): in red while it is, in both modes. */}
        <MutedStatus />
        {/* Captions on but showing nothing, and why (cap-threads): in both modes. */}
        <CaptionsWarning canOpen={pro} />
        {/* Ahead of what comes and goes: an import's long line runs on under the version's words, never under a button. */}
        <div aria-live="polite" className="flex min-w-0 flex-1 items-center gap-3">
          <LinkConversionStatus />
          <ImportStatus />
          <SaveStatus platform={info?.platform ?? 'darwin'} />
          <TaskStatus />
        </div>
        <div className="flex items-center self-stretch">
          {/* What the screens did by themselves, in one line (alpha.24, lead 2's screensaid; under the top bar before,
              where it moved the whole window down as it came): before the access line, its room taken from the passing
              news' only, so nothing moves as it comes or goes; Change… and Set up Stage screen… in Pro Mode. */}
          <ScreensSaidNotice
            onChange={
              onOpenScreens
                ? (displayId) => {
                    focusDisplay(displayId);
                    onOpenScreens();
                  }
                : null
            }
          />
          {/* Can't reach the access list (alpha.24, the owner's QA24-ACCESS-STRIP A; a strip under the top bar before):
              in place of the version and in its room, while the list does not answer. */}
          <AccessOfflineNotice>
            <AppInfoWords info={info} />
          </AccessOfflineNotice>
        </div>
      </footer>
    </>
  );
}

function LinkConversionStatus() {
  useEffect(connectConversions, []);
  const job = useConvert((state) =>
    state.jobs.find((entry) => entry.maxHeight !== undefined && jobBusy(entry)),
  );
  if (!job) return null;
  const text = `${job.name} · ${job.note ?? convertingWords(job)}`;
  return (
    <div data-testid="link-conversion-status" className="flex min-w-0 items-center gap-1.5">
      <Truncate text={text} />
      <Button
        size="sm"
        className="h-6! shrink-0"
        aria-label={`Stop converting ${job.name}`}
        onClick={() => void cancelLinkConversion(job.id)}
      >
        Stop
      </Button>
    </div>
  );
}

/**
 * Things to tell the operator (a restore, saved diagnostics, a command that failed, a file played at the even
 * loudness): small and see-through, in the window's bottom-right corner, just above the bars at its foot (the owner,
 * 11 Nov 2026; until then a card in the window's flow, Sessions 31–36, A9). Nothing moves as one comes and goes, and
 * it is never in the way: since alpha.21 it stands at the live column's foot (LiveColumn), taking its room from what
 * scrolls under the LIVE block, so no control is ever under it (floating over the column, a long one had covered the
 * levels' Sound on and Audio's buttons); a click on its card reaches what is under it, only its buttons take one. With
 * no live column (the practice show), it floats in the corner over the window as before, a control the keyboard is on
 * staying in sight through it (WCAG 2.4.11).
 */
export function NoticeArea() {
  const notice = useNotice((s) => s.text);
  const imports = useImportNotices((s) => s.notices);
  const canFindMissing = useMode((s) => s.mode === 'pro');
  const place = useNoticePlace((s) => s.place);
  if (!notice && imports.length === 0) return null;
  const shown = imports.slice(0, 4);
  const more = imports.length - shown.length;
  const cards = (
    <>
      {shown.length > 0 && (
        <div data-testid="import-notice-stack" className="flex w-full flex-col items-end gap-1">
          {more > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-panel-3/75 px-2 py-1 text-xs text-fg">
              <span>{plural(more, 'more import notice')}</span>
              <Button size="sm" className="pointer-events-auto h-5" onClick={dismissAllImportNotices}>
                Dismiss all
              </Button>
            </div>
          )}
          {shown.map((item) => (
            <ImportNoticeLine key={item.id} item={item} canFindMissing={canFindMissing} />
          ))}
        </div>
      )}
      {notice && <NoticeCard key={notice} notice={notice} canShowMedia={canFindMissing} />}
    </>
  );
  if (place)
    return createPortal(
      <div
        className="pointer-events-none flex flex-col items-end gap-1 px-3 pt-1 pb-2"
        data-testid="notice-area"
      >
        {cards}
      </div>,
      place,
    );
  return (
    // An anchor with no height on the bars' top edge: the notices stand over the bottom of the window.
    <div className="relative z-30 h-0 shrink-0">
      <div
        className="pointer-events-none absolute right-3 bottom-2 flex w-[min(38rem,calc(100vw-1.5rem))] flex-col items-end gap-1"
        data-testid="notice-area"
      >
        {cards}
      </div>
    </div>
  );
}

function NoticeCard({ notice, canShowMedia }: { notice: string; canShowMedia: boolean }) {
  const ref = useLeaving<HTMLDivElement>('notice');
  const arriving = useArrival('notice');
  // A new video in Media (alpha.22: a row's trimmed video): Show in Media, in Pro Mode, whose library has Media.
  const media = useNotice((s) => (s.media?.text === notice ? s.media.mediaId : null));
  return (
    <div
      ref={ref}
      role="alert"
      data-testid="operator-notice"
      data-motion={arriving}
      className="pointer-events-none flex max-w-[min(22rem,100%)] items-start gap-1.5 rounded-md border border-line/60 border-l-2 border-l-accent bg-panel-3/75 px-2 py-1.5 text-xs leading-snug text-fg"
    >
      <Info size={13} aria-hidden="true" className="mt-px shrink-0 text-accent" />
      <p className="min-w-0 flex-1 break-words">{notice}</p>
      {media !== null && canShowMedia && (
        <button
          type="button"
          onClick={() => {
            void showInMedia(media);
          }}
          className="pointer-events-auto -my-1 inline-flex min-h-6 shrink-0 items-center rounded-sm px-1 text-xs text-fg underline hover:bg-panel-2"
        >
          Show in Media
        </button>
      )}
      {/* Its file copied where the operator chooses (the owner's "export button as well to download"). */}
      {media !== null && (
        <button
          type="button"
          onClick={() => {
            void exportMedia(media);
          }}
          className="pointer-events-auto -my-1 inline-flex min-h-6 shrink-0 items-center rounded-sm px-1 text-xs text-fg underline hover:bg-panel-2"
        >
          Export…
        </button>
      )}
      {/* Report a Problem with this notice's words and the feature they name (x49, Q60-38). */}
      <button
        type="button"
        onClick={() => {
          void showReport({ notice });
        }}
        // 24 px tall, as every target, and no wider, so the card's words wrap as before (alpha.21: the 16 px link failed
        // the target-size check once the live column's Audio buttons came under the notice; 4 px wider, the words
        // wrapped a line more on a Mac and the card covered the levels' Sound on).
        className="pointer-events-auto -my-1 inline-flex min-h-6 shrink-0 items-center rounded-sm px-1 text-xs text-muted underline hover:bg-panel-2 hover:text-fg"
      >
        Report this…
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          useNotice.setState({ text: null });
        }}
        className="pointer-events-auto -my-1 -mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-panel-2"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The version, last in the row (alpha.23, lead 2's QA23-STAGE8-4): "Drashti 1.0.0" shown; Electron's version and the
 * system's after it for screen readers and in its tooltip, the whole line there, so the row fits CI's 1024 × 645.
 */
function AppInfoWords({ info }: { info: AppInfo | null }) {
  // As wide as its place (the access line's room, AccessOfflineNotice), its words at the place's end, as before.
  if (!info) return <span data-testid="app-info" className="flex-1 shrink-0 text-right text-faint" />;
  const { short, rest } = appInfoParts(info);
  return (
    // Its words are in it already, for screen readers: the tooltip only shows the whole line.
    <Tooltip content={describeAppInfo(info)} describes={false}>
      <span data-testid="app-info" className="flex-1 shrink-0 text-right text-faint">
        {short}
        <span className="sr-only">{rest}</span>
      </span>
    </Tooltip>
  );
}
