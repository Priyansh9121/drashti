import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue, OpenDialogOptions } from 'electron';
import { dialog } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { formatBytes } from '../../shared/format';
import type { TaskProgress } from '../../shared/app-info';
import type { Db } from '../db/database';
import { diskFreeBytes } from '../import/media-store';
import { backupLibrary, checkBackup, filesIn, LIBRARY_FILE, requestRestore, sameDisk } from './backup';
import { fileProblem } from '../plain-errors';

/*
 * File > Back Up Library… and Restore Library…: the questions the operator
 * is asked, around the work in backup.ts. Log lines carry counts, never
 * names or paths.
 */

export interface BackupUi {
  parent: () => BrowserWindow | null;
  db: Db;
  userData: string;
  mediaDir: string;
  version: string;
  schema: number;
  notice: (text: string) => void;
  progress: (progress: TaskProgress | null) => void;
  /** Quit on purpose, with nothing live and without the usual question, and start again. */
  restart: () => void;
  log: { info: (message: string) => void; warn: (message: string) => void };
}

const GiB = 1024 ** 3;

const openDialog = (ui: BackupUi, options: OpenDialogOptions) => {
  const parent = ui.parent();
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
};
const messageBox = (ui: BackupUi, options: MessageBoxOptions): Promise<MessageBoxReturnValue> => {
  const parent = ui.parent();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
};

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const bytesOf = (file: string) => (existsSync(file) ? statSync(file).size : 0);
const errorCode = (error: unknown) =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'error';

let busy = false;

/** A backup made by hand is running (a scheduled one waits for it). */
export const handBackupRunning = (): boolean => busy;

/** Run one of the flows; anything unexpected is told to the operator, and logged by its code only. */
async function guarded(ui: BackupUi, what: string, flow: (ui: BackupUi) => Promise<void>): Promise<void> {
  try {
    await flow(ui);
  } catch (error) {
    ui.log.warn(`${what} stopped unexpectedly (${errorCode(error)})`);
    ui.notice(`${what} stopped. ${fileProblem(error)}`);
  }
}

/** Back up the library (and the media, if the operator wants) into a folder they choose. */
export const backUp = (ui: BackupUi) => guarded(ui, 'Backing up', backUpFlow);

/** Restore the library from a backup folder: checked, asked once, then done at a restart. */
export const restore = (ui: BackupUi) => guarded(ui, 'Restoring', restoreFlow);

async function backUpFlow(ui: BackupUi): Promise<void> {
  if (busy) {
    ui.notice('A backup is already running.');
    return;
  }
  const pick = await openDialog(ui, {
    title: 'Back Up the Library',
    message: 'Choose where to put the backup. A drive other than this computer’s own is best.',
    buttonLabel: 'Back Up Here',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  const into = pick.canceled ? undefined : pick.filePaths[0];
  if (!into) return;
  if (inside(into, ui.mediaDir) || inside(into, ui.userData)) {
    await messageBox(ui, {
      type: 'warning',
      message: 'Choose a folder outside Drashti’s own data folder',
      detail: 'A backup kept with the library it backs up is lost with it.',
      buttons: ['OK'],
    });
    return;
  }
  const media = await filesIn(ui.mediaDir);
  const mediaBytes = media.reduce((sum, f) => sum + f.bytes, 0);
  const libraryBytes =
    bytesOf(join(ui.userData, LIBRARY_FILE)) + bytesOf(join(ui.userData, `${LIBRARY_FILE}-wal`));
  const answer = await messageBox(ui, {
    type: 'question',
    message: 'Back up the library?',
    detail: `A new folder in “${basename(into)}” gets the library: presentations, playlists, themes, props, timers, screens and settings (${formatBytes(libraryBytes)}).`,
    ...(media.length > 0
      ? {
          checkboxLabel: `Include the media: ${media.length.toLocaleString('en')} pictures, videos and sounds (${formatBytes(mediaBytes)})`,
          checkboxChecked: true,
        }
      : {}),
    buttons: ['Back Up', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (answer.response !== 0) return;
  const withMedia = media.length > 0 && answer.checkboxChecked;

  // Room for it, keeping 2 GB free when it is the library's own disk (as imports do).
  const needed = libraryBytes + (withMedia ? mediaBytes : 0);
  const reserve = sameDisk(into, ui.userData) ? 2 * GiB : 64 * 1024 * 1024;
  const usable = Math.max(0, diskFreeBytes(into) - reserve);
  if (needed > usable) {
    await messageBox(ui, {
      type: 'warning',
      message: 'There is not enough room there',
      detail: `The backup needs ${formatBytes(needed)}, and ${formatBytes(usable)} can be used there${
        reserve > GiB ? ' (Drashti keeps 2 GB free on its own disk)' : ''
      }. Choose another drive${withMedia ? ', or leave out the media' : ''}.`,
      buttons: ['OK'],
    });
    return;
  }

  busy = true;
  const started = Date.now();
  let shown = 0;
  try {
    const { folder, mediaFiles } = await backupLibrary(ui.db, into, {
      mediaDir: withMedia ? ui.mediaDir : null,
      app: ui.version,
      schema: ui.schema,
      now: new Date(),
      // A quick backup shows no bar; a long one updates it a few times a second.
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - started < 500 || now - shown < 250) return;
        shown = now;
        ui.progress({
          label: `Backing up the media: ${formatBytes(done)} of ${formatBytes(total)}`,
          fraction: total > 0 ? done / total : 1,
        });
      },
    });
    ui.log.info(
      `Library backed up (${withMedia ? `with ${String(mediaFiles)} media file(s)` : 'without media'}, ${String(Math.round((Date.now() - started) / 1000))} s)`,
    );
    ui.notice(`Library backed up to ${folder}`);
  } catch (error) {
    ui.log.warn(`The backup did not finish (${errorCode(error)})`);
    ui.notice(
      errorCode(error) === 'ENOSPC'
        ? 'The backup did not finish: the drive is full. Nothing was left there.'
        : 'The backup did not finish (see the log). Nothing was left there.',
    );
  } finally {
    busy = false;
    ui.progress(null);
  }
}

async function restoreFlow(ui: BackupUi): Promise<void> {
  if (busy) {
    ui.notice('Wait for the backup to finish first.');
    return;
  }
  const pick = await openDialog(ui, {
    title: 'Restore the Library',
    message: 'Choose a backup folder (“Drashti backup” and its date).',
    buttonLabel: 'Choose',
    properties: ['openDirectory'],
  });
  const from = pick.canceled ? undefined : pick.filePaths[0];
  if (!from) return;
  const check = checkBackup(from, ui.schema);
  if (!check.ok) {
    ui.log.warn(`A backup was refused for restoring (${check.code})`);
    await messageBox(ui, {
      type: 'warning',
      message: 'That folder cannot be restored',
      detail: check.message,
      buttons: ['OK'],
    });
    return;
  }
  const made = new Date(check.note.createdAt);
  const when = Number.isNaN(made.getTime())
    ? ''
    : ` (made ${made.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })})`;
  const answer = await messageBox(ui, {
    type: 'warning',
    message: `Restore the library from “${basename(from)}”?`,
    detail: [
      check.media
        ? `The library and its media go back to how they were in this backup${when}.`
        : `The library goes back to how it was in this backup${when}. It has no media, so the media folder stays as it is.`,
      `The library you have now${check.media ? ' and its media are' : ' is'} kept in Drashti’s data folder, under Backups, so nothing is lost.`,
      'Drashti restarts to do it: the screens go black while it restarts, and nothing is on them afterwards.',
    ].join('\n\n'),
    buttons: ['Restore and Restart', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (answer.response !== 0) return;
  requestRestore(ui.userData, from);
  ui.log.info(
    `Restore asked for (${check.media ? 'with' : 'without'} media, schema ${String(check.schema)}); restarting`,
  );
  ui.restart();
}
