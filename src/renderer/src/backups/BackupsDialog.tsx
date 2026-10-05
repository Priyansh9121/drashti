import { useEffect, useState } from 'react';
import type { BackupSchedule, ScheduledBackupsView } from '../../../shared/backups';
import { BACKUP_KEEP_MAX, SCHEDULED_FOLDER } from '../../../shared/backups';
import { formatBytes } from '../../../shared/format';
import { useNow } from '../render/useNow';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DaysPicker } from '../ui/DaysPicker';
import { Dialog } from '../ui/Dialog';
import { Field, NumberInput, TextInput } from '../ui/Field';
import { AlertTriangle, FolderOpen, HardDrive } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Progress } from '../ui/Progress';
import { Checkbox, Toggle } from '../ui/Toggle';
import { closeBackups, connectBackups, useBackups } from './backups-store';

/*
 * File > Scheduled Backups… (Session 14): where they go, on which days and
 * when, how many are kept and whether the media goes too; how the last one
 * went and when the next is. Changing them takes the admin PIN (with roles
 * on); anyone in Pro Mode can look.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** "Today 23:00", "Tue 23:00", or a date. */
function whenText(at: number, now: number): string {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date(now).toDateString()) return `Today ${time}`;
  const days = (at - now) / 864e5;
  if (days > -6.5 && days < 6.5) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

function Status({ view, now }: { view: ScheduledBackupsView; now: number }) {
  const last = view.last;
  return (
    <div className="space-y-2 text-sm" data-testid="backups-status">
      {view.state === 'running' && (
        <div className="space-y-1" role="status">
          <p>
            Backing up now
            {view.progress && view.progress.total > 0
              ? `: ${formatBytes(view.progress.done)} of ${formatBytes(view.progress.total)} of media`
              : '…'}
          </p>
          {view.progress && view.progress.total > 0 && (
            <Progress value={view.progress.done / view.progress.total} label="Backing up" />
          )}
        </div>
      )}
      {view.state === 'waiting' && view.waitingFor && (
        <Notice tone="info">Waiting: {view.waitingFor}. It goes on by itself afterwards.</Notice>
      )}
      {last && (
        <p data-testid="backups-last" className={last.outcome === 'done' ? 'text-muted' : 'text-warning-fg'}>
          {last.outcome !== 'done' && <AlertTriangle size={14} aria-hidden="true" className="mr-1 inline" />}
          Last: {whenText(last.at, now)},{' '}
          {last.outcome === 'done' ? 'backed up' : last.outcome === 'skipped' ? 'skipped' : 'stopped'}{' '}
          {last.message}
          {last.outcome === 'done' && last.files !== undefined
            ? ` ${String(last.copied ?? 0)} of ${String(last.files)} media files were new.`
            : ''}
        </p>
      )}
      {view.nextAt !== null && (
        <p data-testid="backups-next" className="text-muted">
          Next: {whenText(view.nextAt, now)}
        </p>
      )}
    </div>
  );
}

export function BackupsDialog() {
  const open = useBackups((s) => s.open);
  const view = useBackups((s) => s.view);
  useEffect(() => {
    connectBackups();
  }, []);
  if (!open || !view) return null;
  return <BackupsForm view={view} />;
}

function BackupsForm({ view }: { view: ScheduledBackupsView }) {
  const [f, setF] = useState<BackupSchedule>(view.schedule);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const now = useNow(30_000) + view.offsetMs;
  const set = (patch: Partial<BackupSchedule>) => {
    setF((was) => ({ ...was, ...patch }));
    setProblem(null);
    setSaved(false);
  };
  const save = async () => {
    const result = await window.drashti.backups.save(f);
    if (result.ok) setSaved(true);
    else setProblem(result.message);
  };
  return (
    <Dialog
      title="Scheduled backups"
      size="md"
      onClose={closeBackups}
      closeLabel="Close scheduled backups"
      testId="backups-dialog"
      footer={
        <>
          <Button
            className="mr-auto"
            data-testid="backups-run-now"
            disabled={view.schedule.folder === null || view.state !== 'idle'}
            onClick={() => {
              void window.drashti.backups.runNow().then((r) => {
                if (!r.ok) setProblem(r.message);
              });
            }}
          >
            Back up now
          </Button>
          <Button onClick={closeBackups}>Close</Button>
          <Button variant="primary" type="submit" form="backups-form" data-testid="backups-save">
            Save
          </Button>
        </>
      }
    >
      <form
        id="backups-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-3">
          <Toggle
            checked={f.enabled}
            label="Back up by itself"
            data-testid="backups-enabled"
            onChange={(on) => set({ enabled: on })}
          />
          {view.schedule.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
        </div>
        <Field
          label="Into this folder (a USB drive or another disk is best)"
          hint={`Drashti makes a folder “${SCHEDULED_FOLDER}” there, and only ever removes backups it made in it.`}
        >
          <div className="flex gap-2">
            <TextInput
              readOnly
              value={f.folder ?? 'None chosen yet'}
              className="flex-1"
              data-testid="backups-folder"
            />
            <Button
              type="button"
              icon={FolderOpen}
              data-testid="backups-choose"
              onClick={() => {
                void window.drashti.backups.pickFolder().then((r) => {
                  if (!r.ok) setProblem(r.message);
                  else if (r.folder) set({ folder: r.folder });
                });
              }}
            >
              Choose…
            </Button>
          </div>
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted">Every week on</legend>
          <DaysPicker days={f.days} onChange={(days) => set({ days })} />
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <Field label="At (this computer's clock)">
            <TextInput
              type="time"
              data-testid="backups-time"
              value={f.time}
              onChange={(e) => set({ time: e.target.value })}
            />
          </Field>
          <Field label="Keep the last">
            <NumberInput
              data-testid="backups-keep"
              unit="backups"
              min={1}
              max={BACKUP_KEEP_MAX}
              value={f.keep}
              onChange={(e) => set({ keep: Math.round(Number(e.target.value) || 1) })}
            />
          </Field>
        </div>
        <Checkbox
          label="With the media (pictures, videos and sounds: each copied once, then only what is new)"
          checked={f.media}
          onChange={(e) => set({ media: e.target.checked })}
        />
        <p className="flex items-start gap-2 text-xs text-muted">
          <HardDrive size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          It runs in the background at a gentle speed and waits while the stream is on air or recording. If
          the drive is not connected at the time, that backup is skipped and the status bar says so. A time
          while Drashti is closed is not made up later. Restore one with File, Restore Library….
        </p>
        <Status view={view} now={now} />
        {problem && (
          <p role="alert" className="text-sm text-danger-fg" data-testid="backups-problem">
            {problem}
          </p>
        )}
        {saved && <Notice tone="success">Saved.</Notice>}
      </form>
    </Dialog>
  );
}

/** The status bar's warning: a scheduled backup skipped or stopped (both modes), until read. */
export function BackupWarning() {
  const warning = useBackups((s) => s.view?.warning ?? null);
  useEffect(() => {
    connectBackups();
  }, []);
  if (!warning) return null;
  return (
    <span
      data-testid="backup-warning"
      className="flex min-w-0 items-center gap-1.5 rounded-sm bg-warning-bg px-1.5 py-0.5 text-warning-fg"
    >
      <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{warning}</span>
      <button
        type="button"
        aria-label="Dismiss the backup warning"
        className="shrink-0 rounded-sm underline"
        onClick={() => void window.drashti.backups.dismiss()}
      >
        OK
      </button>
    </span>
  );
}
