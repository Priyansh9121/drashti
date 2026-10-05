import { z } from 'zod';
import { daysSchema, hhmmSchema } from './schedule';

/*
 * Scheduled backups (Session 14). On chosen days at a time (like the arti),
 * Drashti backs the library up into a folder an admin picks: a USB drive or
 * another disk, never inside Drashti's own data folder. They go into a
 * folder of their own there, "Drashti scheduled backups", beside one shared
 * media folder: media files are named by their hash, so each is copied once
 * and every backup lists the ones it needs. The last few are kept, and older
 * ones Drashti made there are removed (nothing else), with any media file no
 * kept backup still needs. A backup never slows the show: it runs in a
 * process of its own at the lowest priority, at a limited speed, and waits
 * while the stream is on air or recording. A time when the folder is not
 * there (the USB drive is out) is skipped, with a warning in the status bar.
 * A time missed while Drashti was closed is not run late. A scheduled backup
 * restores like one made by hand (File > Restore Library…).
 */

/** The folder Drashti makes in the chosen folder, holding the scheduled backups and their shared media. */
export const SCHEDULED_FOLDER = 'Drashti scheduled backups';

export const BACKUP_KEEP_DEFAULT = 7;
export const BACKUP_KEEP_MAX = 60;

export interface BackupSchedule {
  /** Off: kept, but nothing runs. */
  enabled: boolean;
  /** The folder chosen (a USB drive or another disk), or null until one is. */
  folder: string | null;
  /** Every week on these days (0 Sunday … 6 Saturday). */
  days: number[];
  /** "HH:MM", this computer's time. */
  time: string;
  /** How many of the scheduled backups to keep there. */
  keep: number;
  /** With the media (pictures, videos and sounds), copied once into the shared folder. */
  media: boolean;
}

export const NO_BACKUP_SCHEDULE: BackupSchedule = {
  enabled: false,
  folder: null,
  days: [0, 1, 2, 3, 4, 5, 6],
  time: '23:00',
  keep: BACKUP_KEEP_DEFAULT,
  media: true,
};

export const backupScheduleSchema = z
  .object({
    enabled: z.boolean(),
    folder: z.string().min(1).max(4096).nullable(),
    days: daysSchema.refine((d) => d.length > 0, 'Choose at least one day.'),
    time: hhmmSchema,
    keep: z.number().int().min(1).max(BACKUP_KEEP_MAX),
    media: z.boolean(),
  })
  .strict()
  .refine((s) => !s.enabled || s.folder !== null, { message: 'Choose the folder to back up into.' });

/** How a scheduled time went. */
export interface BackupRun {
  /** The time it was for (ms since the epoch, this computer's clock). */
  at: number;
  /** When it ended. */
  endedAt: number;
  outcome: 'done' | 'skipped' | 'failed';
  /** In words: where it went, or why it was skipped or stopped. */
  message: string;
  /** Media files copied this time, of those the backup lists. */
  copied?: number;
  files?: number;
}

export interface ScheduledBackupsView {
  schedule: BackupSchedule;
  /** The next time (this computer's clock), or null when off or no folder is chosen. */
  nextAt: number | null;
  /** What is happening now. */
  state: 'idle' | 'waiting' | 'running';
  /** While waiting: why ("the stream is on air"). */
  waitingFor: string | null;
  /** While running: media bytes copied of those to copy. */
  progress: { done: number; total: number } | null;
  last: BackupRun | null;
  /** The status bar's warning (a time skipped or a backup that stopped), until the next good one or dismissed. */
  warning: string | null;
  /** The schedule's clock ahead of the engine's: 0, except while a test moves it. */
  offsetMs: number;
}

export type BackupsResult = { ok: true; view: ScheduledBackupsView } | { ok: false; message: string };
export type PickFolderResult = { ok: true; folder: string | null } | { ok: false; message: string };
