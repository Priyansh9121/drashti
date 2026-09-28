import Database from 'better-sqlite3';
import { sep } from 'node:path';
import type { Db } from '../db/database';
import { ImportRepo } from '../db/imports';
import { schemaVersion } from '../db/migrate';
import { MediaStore } from './media-store';
import { runImport } from './pipeline';
import type { FromWorker, StartMessage, ToWorker } from './protocol';

/*
 * The import worker: an Electron utility process started for each import
 * run. It has its own connection to the library (WAL lets the main process
 * keep reading while it writes) and exits when the run ends, so parsing and
 * copying never compete with the show in the main process.
 */

const port = process.parentPort;
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
  try {
    db = openLibrary(message.dbFile, message.schemaVersion);
    const inside = message.userDataDir + sep;
    const run = await runImport({
      db,
      media: new MediaStore(db, { dir: message.mediaDir }),
      runId: message.runId,
      paths: message.paths,
      options: message.options,
      skipDir: (dir) => dir === message.userDataDir || dir.startsWith(inside),
      onProgress: (progress) => {
        post({ type: 'progress', progress });
      },
      onWrote: (wrote) => {
        post({ type: 'wrote', runId: message.runId, ...wrote });
      },
      isCancelled: () => cancelled.has(message.runId),
    });
    post({ type: 'finished', run });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    try {
      if (db) new ImportRepo(db).failRun(message.runId, message.paths, text);
    } catch {
      // The main process marks the run failed when this process exits.
    }
    post({ type: 'failed', runId: message.runId, message: text });
  } finally {
    db?.close();
    // One run per process: exit so the next run starts clean.
    setImmediate(() => process.exit(0));
  }
}

port.on('message', (event) => {
  const message = event.data as ToWorker;
  if (message.type === 'cancel') cancelled.add(message.runId);
  else void start(message);
});
