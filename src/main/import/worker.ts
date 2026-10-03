import Database from 'better-sqlite3';
import type { ImportProgress } from '../../shared/import';
import { constants, setPriority } from 'node:os';
import { sep } from 'node:path';
import { beginImmediately, type Db } from '../db/database';
import { ImportRepo } from '../db/imports';
import { schemaVersion } from '../db/migrate';
import { MediaStore } from './media-store';
import { runImport } from './pipeline';
import { runRelink } from './relink';
import type { FromWorker, StartMessage, ToWorker } from './protocol';

/*
 * The import worker: an Electron utility process started for each import
 * run. It has its own connection to the library (WAL lets the main process
 * keep reading while it writes) and exits when the run ends, so parsing and
 * copying never compete with the show in the main process.
 */

const port = process.parentPort;

// The lowest priority: whenever the computer is busy, the show's processes (main, outputs, the
// GPU process) come first, and the import uses what is left. On a 3-core CI Mac, below-normal
// priority still let a CPU-bound import delay output frames now and then.
try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch {
  // Not allowed on this system: run at normal priority.
}
const cancelled = new Set<string>();
const post = (message: FromWorker) => {
  port.postMessage(message);
};

function openLibrary(file: string, expected: number): Db {
  const db = new Database(file);
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    // The main process writes to the same file: transactions take the write lock as they begin.
    beginImmediately(db);
    const version = schemaVersion(db);
    if (version !== expected) {
      throw new Error(`The library is at schema ${version}, but this import expects ${expected}.`);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

async function start(message: StartMessage): Promise<void> {
  let db: Db | null = null;
  let result: FromWorker;
  try {
    db = openLibrary(message.dbFile, message.schemaVersion);
    const inside = message.userDataDir + sep;
    const common = {
      db,
      media: new MediaStore(db, { dir: message.mediaDir }),
      runId: message.runId,
      skipDir: (dir: string) => dir === message.userDataDir || dir.startsWith(inside),
      onProgress: (progress: ImportProgress) => {
        post({ type: 'progress', progress });
      },
      isCancelled: () => cancelled.has(message.runId),
    };
    const timings = { scan: 0, read: 0, lookup: 0, parse: 0, write: 0, commit: 0, media: 0, total: 0 };
    const run =
      message.job === 'relink'
        ? await runRelink({ ...common, folder: message.paths[0] ?? '', mediaIds: message.mediaIds })
        : await runImport({
            ...common,
            paths: message.paths,
            options: message.options,
            timings,
            onWrote: (wrote) => {
              post({ type: 'wrote', runId: message.runId, ...wrote });
            },
          });
    result = { type: 'finished', run, ...(message.job === 'import' ? { timings } : {}) };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    try {
      if (db) new ImportRepo(db).failRun(message.runId, message.paths, text);
    } catch {
      // The main process marks the run failed when this process stops.
    }
    result = { type: 'failed', runId: message.runId, message: text };
  } finally {
    db?.close();
  }
  // The result is the last message. The main process stops this process once it has it: exiting
  // here could reach the main process before the message does.
  post(result);
}

port.on('message', (event) => {
  const message = event.data as ToWorker;
  if (message.type === 'cancel') cancelled.add(message.runId);
  else void start(message);
});
