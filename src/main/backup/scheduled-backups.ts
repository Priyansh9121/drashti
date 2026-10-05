import { existsSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import type { BackupRun, BackupSchedule, BackupsResult, ScheduledBackupsView } from '../../shared/backups';
import { backupScheduleSchema, NO_BACKUP_SCHEDULE, SCHEDULED_FOLDER } from '../../shared/backups';
import { nextScheduleTime, scheduleTimes } from '../../shared/schedule';
import type { BackupWorker } from './spawn-backup-worker';

/*
 * Scheduled backups (shared/backups.ts) as the main process runs them: the
 * schedule from the library's settings, the times as they come (by the
 * schedules' clock, like the arti's), and one backup worker at a time. A
 * time with no folder there is skipped, with a warning; while the stream is
 * on air or recording the backup waits (before it starts, or paused in the
 * middle). A time that passed while Drashti was closed is not run late.
 */

const SETTING = 'scheduledBackups';
const LAST = 'scheduledBackupLast';
const DISMISSED = 'scheduledBackupWarningDismissed';
/** Look again at least this often (a clock change, the stream going off air). */
const RECHECK_MS = 30_000;
/** While waiting or running: how often to look at the stream. */
const WATCH_MS = 2000;
const GiB = 1024 ** 3;

export interface ScheduledBackupDeps {
  settings: { get(key: string): unknown; set(key: string, value: unknown): void };
  /** The schedules' clock (this computer's; a test moves it). */
  now(): number;
  /** The engine's clock, which the windows count with. */
  engineNow(): number;
  /** The stream is on air or recording: backups wait. */
  onAir(): boolean;
  /** A backup made by hand is running: wait for it. */
  busy(): boolean;
  spawn(): BackupWorker;
  dbFile: string;
  mediaDir: string;
  userData: string;
  app: string;
  schema: number;
  sameDisk(a: string, b: string): boolean;
  changed(view: ScheduledBackupsView): void;
  log(level: 'info' | 'warn', message: string): void;
  /** The copy speed (16 MB/s unless a test says). */
  bytesPerSecond?: number;
  schedule?: (ms: number, run: () => void) => () => void;
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

export class ScheduledBackups {
  private readonly startedAt: number;
  /** Times up to here have been looked at. */
  private checkedUpTo: number;
  /** A time that came and has not run yet (waiting for the stream, or a hand backup). */
  private pending: number | null = null;
  private waitingFor: string | null = null;
  private running: { worker: BackupWorker; at: number; paused: boolean } | null = null;
  private progress: { done: number; total: number } | null = null;
  private cancelTimer: (() => void) | null = null;
  private disposed = false;
  private lastSent = '';

  constructor(private readonly deps: ScheduledBackupDeps) {
    this.startedAt = deps.now();
    this.checkedUpTo = this.startedAt;
    this.check();
  }

  schedule(): BackupSchedule {
    const parsed = backupScheduleSchema.safeParse(this.deps.settings.get(SETTING));
    return parsed.success ? parsed.data : NO_BACKUP_SCHEDULE;
  }

  private last(): BackupRun | null {
    const raw = this.deps.settings.get(LAST) as BackupRun | undefined;
    return raw && typeof raw.at === 'number' && typeof raw.message === 'string' ? raw : null;
  }

  view(): ScheduledBackupsView {
    const s = this.schedule();
    const now = this.deps.now();
    const last = this.last();
    const dismissed = this.deps.settings.get(DISMISSED);
    const warning =
      last && last.outcome !== 'done' && dismissed !== last.endedAt
        ? `Backup at ${hhmm(last.at)} ${last.outcome === 'skipped' ? 'skipped' : 'stopped'}: ${last.message}`
        : null;
    return {
      schedule: s,
      nextAt: s.enabled && s.folder ? nextScheduleTime({ ...s, date: null }, now) : null,
      state:
        this.running && !this.running.paused ? 'running' : this.running || this.pending ? 'waiting' : 'idle',
      waitingFor: this.running?.paused || this.pending !== null ? this.waitingFor : null,
      progress: this.running ? this.progress : null,
      last,
      warning,
      offsetMs: now - this.deps.engineNow(),
    };
  }

  private changed(): void {
    const view = this.view();
    const sent = JSON.stringify(view);
    if (sent === this.lastSent) return;
    this.lastSent = sent;
    this.deps.changed(view);
  }

  save(raw: unknown): BackupsResult {
    const parsed = backupScheduleSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'That schedule cannot be kept.' };
    const s = parsed.data;
    if (s.folder !== null) {
      if (!isAbsolute(s.folder)) return { ok: false, message: 'Choose the folder with the button.' };
      if (inside(s.folder, this.deps.userData) || inside(this.deps.userData, s.folder))
        return {
          ok: false,
          message:
            'Choose a folder outside Drashti’s own data folder: a backup kept with the library it backs up is lost with it.',
        };
    }
    this.deps.settings.set(SETTING, s);
    this.deps.log(
      'info',
      `Scheduled backups: ${s.enabled ? `on, ${String(s.days.length)} day(s) a week, keeping ${String(s.keep)}` : 'off'}`,
    );
    this.check();
    return { ok: true, view: this.view() };
  }

  /** Back up now, as if its time had come (to try the folder). */
  runNow(): BackupsResult {
    const s = this.schedule();
    if (!s.folder) return { ok: false, message: 'Choose the folder to back up into first.' };
    if (this.running || this.pending !== null)
      return { ok: false, message: 'A backup is already on its way.' };
    this.pending = this.deps.now();
    this.check();
    return { ok: true, view: this.view() };
  }

  /** The status bar's warning has been read. */
  dismiss(): ScheduledBackupsView {
    const last = this.last();
    if (last) this.deps.settings.set(DISMISSED, last.endedAt);
    this.changed();
    return this.view();
  }

  private finish(
    at: number,
    outcome: BackupRun['outcome'],
    message: string,
    extra: Partial<BackupRun> = {},
  ): void {
    const run: BackupRun = { at, endedAt: this.deps.now(), outcome, message, ...extra };
    this.deps.settings.set(LAST, run);
    this.deps.log(
      outcome === 'done' ? 'info' : 'warn',
      `Scheduled backup for ${hhmm(at)}: ${outcome}${extra.copied !== undefined ? ` (${String(extra.copied)} of ${String(extra.files ?? 0)} media file(s) copied)` : ''}`,
    );
  }

  /** What is due, what to do about it, and when to look again. */
  check(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    const s = this.schedule();
    if (s.enabled && s.folder) {
      // Times since the last look (never one from before Drashti started): the latest counts.
      const due = scheduleTimes({ ...s, date: null }, Math.max(this.checkedUpTo, this.startedAt), now + 1);
      const latest = due.at(-1);
      if (latest !== undefined && !this.running) this.pending = latest;
    }
    this.checkedUpTo = now + 1;
    if (this.pending !== null && !this.running) this.tryStart(this.pending, s);
    if (this.running) this.watchStream();
    this.changed();
    this.wake(now, s);
  }

  private tryStart(at: number, s: BackupSchedule): void {
    const folder = s.folder;
    if (!folder) {
      this.pending = null;
      return;
    }
    if (!existsSync(folder)) {
      this.pending = null;
      this.finish(at, 'skipped', 'the backup folder was not there (is the drive connected?).');
      return;
    }
    if (this.deps.onAir()) {
      this.waitingFor = 'the stream is on air or recording';
      return;
    }
    if (this.deps.busy()) {
      this.waitingFor = 'a backup made by hand is running';
      return;
    }
    this.pending = null;
    this.waitingFor = null;
    this.start(at, s, folder);
  }

  private start(at: number, s: BackupSchedule, folder: string): void {
    const worker = this.deps.spawn();
    const running = { worker, at, paused: false };
    this.running = running;
    this.progress = null;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (this.running === running) this.running = null;
      worker.kill();
      this.check();
    };
    worker.onMessage((message) => {
      if (message.type === 'progress') {
        this.progress = { done: message.done, total: message.total };
        this.changed();
      } else if (message.type === 'done') {
        this.finish(
          at,
          'done',
          `in ${SCHEDULED_FOLDER}, “${message.folder}”${message.removed > 0 ? `; ${String(message.removed)} older one(s) removed` : ''}.`,
          { copied: message.copied, files: message.files },
        );
        end();
      } else {
        this.finish(at, message.code === 'no-folder' ? 'skipped' : 'failed', message.message);
        end();
      }
    });
    worker.onExit((code) => {
      if (!ended) {
        this.finish(at, 'failed', `the backup process stopped unexpectedly (${String(code)}).`);
        end();
      }
    });
    worker.post({
      type: 'start',
      now: new Date(this.deps.now()).toISOString(),
      bytesPerSecond: this.deps.bytesPerSecond ?? 16 * 1024 * 1024,
      dbFile: this.deps.dbFile,
      mediaDir: s.media ? this.deps.mediaDir : null,
      root: folder,
      keep: s.keep,
      app: this.deps.app,
      schema: this.deps.schema,
      reserveBytes: this.deps.sameDisk(folder, this.deps.userData) ? 2 * GiB : 64 * 1024 * 1024,
    });
    this.deps.log('info', `Scheduled backup for ${hhmm(at)}: started`);
  }

  /** On air in the middle of a backup: it waits, and goes on afterwards. */
  private watchStream(): void {
    const r = this.running;
    if (!r) return;
    const onAir = this.deps.onAir();
    if (onAir && !r.paused) {
      r.paused = true;
      this.waitingFor = 'the stream is on air or recording';
      r.worker.post({ type: 'pause' });
      this.deps.log('info', 'Scheduled backup: waiting while the stream is on air or recording');
    } else if (!onAir && r.paused) {
      r.paused = false;
      this.waitingFor = null;
      r.worker.post({ type: 'resume' });
      this.deps.log('info', 'Scheduled backup: going on');
    }
  }

  private wake(now: number, s: BackupSchedule): void {
    let next = now + (this.running || this.pending !== null ? WATCH_MS : RECHECK_MS);
    if (s.enabled && s.folder) {
      const at = nextScheduleTime({ ...s, date: null }, now + 1);
      if (at !== null && at > now && at < next) next = at;
    }
    this.cancelTimer?.();
    const schedule =
      this.deps.schedule ??
      ((ms: number, run: () => void) => {
        const t = setTimeout(run, ms);
        return () => {
          clearTimeout(t);
        };
      });
    this.cancelTimer = schedule(Math.max(0, next - now), () => {
      this.check();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    const r = this.running;
    this.running = null;
    if (r) {
      r.worker.post({ type: 'cancel' });
      setTimeout(() => {
        r.worker.kill();
      }, 2000).unref();
    }
  }
}
