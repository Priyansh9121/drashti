import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { PicturesResult } from '../../shared/pictures';
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
/** Stops work in the middle of a file when its run is cancelled (Keynote or PowerPoint saving one). */
const stoppers = new Map<string, AbortController>();
const post = (message: FromWorker) => {
  port.postMessage(message);
};
/**
 * The main process's writes waiting for the import to give way (Session 16), by request; and
 * whether the import is going through its files (then it gives way only between them).
 */
const wayWanted = new Set<string>();
let inLoop = false;
let goOn: ((id: string) => void) | null = null;
/** At most this long without the main process's 'go-on' before the import carries on anyway. */
const GIVE_WAY_MAX_MS = 2000;
const way = {
  wanted: () => wayWanted.size > 0,
  loop: (on: boolean) => {
    inLoop = on;
    // Done with the files: whatever still waits may go at once.
    if (!on) {
      for (const id of wayWanted) post({ type: 'gave-way', id, waiting: false });
      wayWanted.clear();
    }
  },
  give: async () => {
    // Every write waiting now goes, then the import carries on when the last says so.
    const ids = [...wayWanted];
    wayWanted.clear();
    const left = new Set(ids);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, GIVE_WAY_MAX_MS);
      function done() {
        clearTimeout(timer);
        goOn = null;
        resolve();
      }
      // Each write that was let in says when it is done.
      goOn = (id) => {
        left.delete(id);
        if (left.size === 0) done();
      };
      for (const id of ids) post({ type: 'gave-way', id, waiting: true });
    });
  },
};

/** PDFs the main process is drawing for this import (Session 15), by request. */
const drawing = new Map<string, (result: PicturesResult) => void>();
const drawPdf = (pdf: string, outDir: string): Promise<PicturesResult> =>
  new Promise((resolve) => {
    const requestId = randomUUID();
    drawing.set(requestId, resolve);
    post({ type: 'draw-pdf', requestId, pdf, outDir });
  });

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
    const stopper = new AbortController();
    stoppers.set(message.runId, stopper);
    if (cancelled.has(message.runId)) stopper.abort();
    const timings = { scan: 0, read: 0, lookup: 0, parse: 0, write: 0, commit: 0, media: 0, total: 0 };
    const run =
      message.job === 'relink'
        ? await runRelink({ ...common, folder: message.paths[0] ?? '', mediaIds: message.mediaIds })
        : await runImport({
            ...common,
            paths: message.paths,
            options: message.options,
            timings,
            drawPdf,
            signal: stopper.signal,
            way,
            log: (line) => {
              post({ type: 'log', level: 'info', message: line });
            },
            refocus: () => {
              post({ type: 'refocus' });
            },
            converters: message.converters !== false,
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
    stoppers.delete(message.runId);
    db?.close();
  }
  // The result is the last message. The main process stops this process once it has it: exiting
  // here could reach the main process before the message does.
  post(result);
}

port.on('message', (event) => {
  const message = event.data as ToWorker;
  if (message.type === 'cancel') {
    cancelled.add(message.runId);
    stoppers.get(message.runId)?.abort();
  } else if (message.type === 'give-way') {
    // Going through the files: between this file and the next (where a group may be open, or about
    // to be). Otherwise (scanning first, or done) the main process may write at once.
    if (inLoop) wayWanted.add(message.id);
    else post({ type: 'gave-way', id: message.id, waiting: false });
  } else if (message.type === 'go-on') {
    // A write that went ahead before the import gave way needs it no more.
    wayWanted.delete(message.id);
    goOn?.(message.id);
  } else if (message.type === 'drawn') {
    drawing.get(message.requestId)?.(message.result);
    drawing.delete(message.requestId);
  } else void start(message);
});
