import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import {
  cloudOf,
  DROP_MAX_BYTES,
  type DropFolderResult,
  type DropFolderView,
  type DropNotTaken,
  droppedName,
} from '../../shared/drop-folder';
import { formatBytes } from '../../shared/format';
import type { ImportItemReport, ImportOptions } from '../../shared/import';
import type { Db } from '../db/database';
import { madeFrom } from '../playlists/folder-playlist';
import { type Found, heldStill, type Seen } from '../playlists/smart-folders';
import { mediaKindOf } from './scan';

/*
 * The drop folder (Session 28, decision 21), built on the smart playlists' looking, settling and watching
 * (playlists/smart-folders.ts) as one flat folder that only ever adds to the library:
 *
 * - Pictures, videos and (Session 51) sounds, every type Drashti takes; names a browser or an editor leaves
 *   while writing (.part, .crdownload, .download, .tmp, ~$…) and hidden ones are passed over. Anything else is
 *   listed as not taken.
 * - A file is taken once its size and time have held still for 5 s (and, on Windows, once nothing else
 *   has it open): one still being copied or downloaded is never taken half-way. Taken again only if it
 *   changes; a file that goes leaves its media in the library.
 * - At most 2 GB a file: a larger one is listed, and Import anyway brings it in.
 * - While the stream is on air or recording, what held still waits.
 * - The folder is only ever read. In Simple Mode it carries on, with no notice.
 */

const SETTING = 'dropFolder';
/** Why a file is not taken for its type (Session 51: sounds are taken too). */
const NOT_MEDIA = 'Only pictures, videos and sounds are taken from the drop folder.';
/** Watching stopped with an error: watched again after this long (the scan carries on meanwhile). */
const REWATCH_MS = 5000;

interface Row {
  name: string;
  size: number;
  mtime_ms: number;
  state: 'taken' | 'not-taken' | 'failed';
  reason: string | null;
}

export interface DropFolderDeps {
  db: Db;
  settings: { get(key: string): unknown; set(key: string, value: unknown): void };
  /** Drashti's own data folder: never a drop folder. */
  dataDir: string;
  /** The normal import. Resolves when it has ended. */
  importFiles(
    paths: string[],
    options: ImportOptions,
  ): Promise<{ ok: true; runId: string } | { ok: false; message: string }>;
  report(runId: string): { items: ImportItemReport[] } | null;
  /** The stream is on air or recording: what held still waits. */
  onAir(): boolean;
  /** Simple Mode: carries on, with no notice. */
  simpleMode(): boolean;
  /** One quiet notice per batch taken, in Pro Mode. */
  notice(text: string): void;
  /** Media came in: the Media list hears of it. */
  mediaChanged(): void;
  changed(view: DropFolderView): void;
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  /** How often to look (10 s; tests set it shorter). */
  scanMs: number;
  /** How long a file must hold still (5 s). */
  settleMs: number;
  /** The most bytes a file may have (2 GB; tests set less). */
  maxBytes?: number;
  /** Watching the folder; `failed` when the watching stops with an error. Null where it cannot. */
  watch?(dir: string, changed: () => void, failed: () => void): (() => void) | null;
  /** Something else has the file open (Windows; elsewhere never). */
  busy?(path: string): Promise<boolean>;
  schedule?: (delayMs: number, run: () => void) => () => void;
}

/** libuv's UV_FS_O_EXLOCK (Windows only): open a file shared with no other program. */
const EXLOCK = 0x10000000;

/** Windows: a file another program is still writing cannot be opened for this program alone. */
export async function busyOnWindows(path: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    // Read only, shared with no one: refused (a sharing violation) while anything else has it open.
    const handle = await open(path, constants.O_RDONLY | EXLOCK);
    await handle.close();
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
  }
}

/** The files at the top of the folder (never inside its folders), passing over what is still being written. */
async function filesAt(folder: string): Promise<Map<string, Found> | null> {
  const top = await stat(folder).catch(() => null);
  if (!top?.isDirectory()) return null;
  const files = new Map<string, Found>();
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  for (const e of entries) {
    if (!e.isFile() || !droppedName(e.name)) continue;
    const s = await stat(join(folder, e.name)).catch(() => null);
    if (s) files.set(e.name, { size: s.size, mtimeMs: Math.round(s.mtimeMs) });
  }
  return files;
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * What a batch taken is, for its notice, by what was stored: pictures and videos, sounds (Session 51), or files of
 * both.
 */
function batchWords(kinds: readonly (string | null)[]): [one: string, many: string] {
  const sounds = kinds.filter((k) => k === 'audio').length;
  if (sounds === 0) return ['picture or video', 'pictures and videos'];
  return sounds === kinds.length ? ['sound', 'sounds'] : ['file', 'files'];
}

const GiB = 1024 ** 3;
/** "2 GB" for the limit itself; a test's own limit in bytes. */
const sizeText = (n: number) => (n % GiB === 0 ? `${String(n / GiB)} GB` : formatBytes(n));

export class DropFolder {
  private readonly pending = new Map<string, Seen>();
  private running: Promise<void> | null = null;
  private again: Promise<void> | null = null;
  private soonCancel: (() => void) | null = null;
  private stopWatching: (() => void) | null = null;
  private rewatch: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private state: DropFolderView['state'] = 'off';
  private last: { at: number; taken: number } | null = null;
  private lastSent = '';
  private readonly maxBytes: number;

  constructor(private readonly deps: DropFolderDeps) {
    this.maxBytes = deps.maxBytes ?? DROP_MAX_BYTES;
  }

  private saved(): { folder: string | null; on: boolean } {
    const raw = this.deps.settings.get(SETTING) as { folder?: unknown; on?: unknown } | undefined;
    return {
      folder: typeof raw?.folder === 'string' && raw.folder !== '' ? raw.folder : null,
      on: raw?.on === true,
    };
  }

  private schedule(ms: number, run: () => void): () => void {
    if (this.deps.schedule) return this.deps.schedule(ms, run);
    const t = setTimeout(run, ms);
    t.unref();
    return () => {
      clearTimeout(t);
    };
  }

  /** Start looking (when on, with a folder). Resolves after the first look. */
  start(): Promise<void> {
    this.stopped = false;
    this.timer ??= setInterval(() => {
      void this.scan();
    }, this.deps.scanMs);
    this.timer.unref();
    this.watchFolder();
    return this.scan();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unwatch();
    this.soonCancel?.();
    this.soonCancel = null;
  }

  private unwatch(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.rewatch?.();
    this.rewatch = null;
  }

  private watchFolder(): void {
    this.unwatch();
    const { folder, on } = this.saved();
    if (!on || !folder || this.stopped) return;
    this.stopWatching =
      this.deps.watch?.(
        folder,
        () => {
          this.soon(300);
        },
        () => {
          // The watching stopped (the folder taken away, a network drive gone): look now, and watch again.
          this.stopWatching = null;
          this.deps.log('info', 'Drop folder: watching stopped; looking again');
          this.rescan();
          this.rewatch = this.schedule(REWATCH_MS, () => {
            this.rewatch = null;
            this.watchFolder();
          });
        },
      ) ?? null;
  }

  /** Look again now: after the computer sleeps, or the watching stops. */
  rescan(): void {
    void this.scan();
  }

  private soon(ms: number): void {
    if (this.soonCancel) return;
    this.soonCancel = this.schedule(ms, () => {
      this.soonCancel = null;
      void this.scan();
    });
  }

  private rows(folder: string): Map<string, Row> {
    const rows = this.deps.db
      .prepare('SELECT name, size, mtime_ms, state, reason FROM drop_files WHERE folder = ?')
      .all(folder) as Row[];
    return new Map(rows.map((r) => [r.name, r]));
  }

  private record(
    folder: string,
    name: string,
    found: Found,
    state: Row['state'],
    mediaId: string | null,
    reason: string | null,
  ): void {
    this.deps.db
      .prepare(
        `INSERT INTO drop_files (folder, name, size, mtime_ms, state, media_id, reason, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (folder, name) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms,
           state = excluded.state, media_id = excluded.media_id, reason = excluded.reason, seen_at = excluded.seen_at`,
      )
      .run(
        folder,
        name,
        found.size,
        found.mtimeMs,
        state,
        mediaId,
        reason,
        new Date(this.deps.now()).toISOString(),
      );
  }

  view(): DropFolderView {
    const { folder, on } = this.saved();
    const notTaken: DropNotTaken[] = folder
      ? [...this.rows(folder).values()]
          .filter((r) => r.state !== 'taken')
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((r) => ({
            name: r.name,
            reason: r.reason ?? 'It could not be imported.',
            tooLarge: r.state === 'not-taken' && r.size > this.maxBytes,
          }))
      : [];
    return {
      folder,
      on,
      state: on && folder ? this.state : 'off',
      waiting: this.pending.size,
      cloud: folder ? cloudOf(folder) : null,
      notTaken,
      last: this.last,
    };
  }

  private changed(): void {
    const view = this.view();
    const sent = JSON.stringify(view);
    if (sent === this.lastSent) return;
    this.lastSent = sent;
    this.deps.changed(view);
  }

  /** Choose the folder, and turn it on. */
  async setFolder(folder: string): Promise<DropFolderResult> {
    const s = await stat(folder).catch(() => null);
    if (!s?.isDirectory()) return { ok: false, message: 'That folder is not there.' };
    if (inside(folder, this.deps.dataDir) || inside(this.deps.dataDir, folder))
      return {
        ok: false,
        message: 'Choose a folder of your own: Drashti’s own folder cannot be the drop folder.',
      };
    this.deps.settings.set(SETTING, { folder, on: true });
    this.pending.clear();
    this.state = 'watching';
    this.deps.log('info', 'Drop folder: a folder was chosen');
    this.watchFolder();
    await this.scan();
    this.changed();
    return { ok: true, view: this.view() };
  }

  setOn(on: boolean): DropFolderResult {
    const { folder } = this.saved();
    if (on && !folder) return { ok: false, message: 'Choose the folder first.' };
    this.deps.settings.set(SETTING, { folder, on });
    this.pending.clear();
    this.deps.log('info', `Drop folder: turned ${on ? 'on' : 'off'}`);
    if (on) {
      this.state = 'watching';
      this.watchFolder();
      void this.scan();
    } else this.unwatch();
    this.changed();
    return { ok: true, view: this.view() };
  }

  /** A file over the size limit, imported because Import anyway was pressed. */
  async importAnyway(name: unknown): Promise<DropFolderResult> {
    const { folder, on } = this.saved();
    if (!folder || !on || typeof name !== 'string') return { ok: false, message: 'The drop folder is off.' };
    if (this.deps.onAir())
      return { ok: false, message: 'Not while the stream is on air or recording: try again afterwards.' };
    const files = await filesAt(folder);
    const found = files?.get(name);
    const row = this.rows(folder).get(name);
    if (!found || row?.state !== 'not-taken' || found.size <= this.maxBytes)
      return { ok: false, message: 'That file is not waiting to be imported any more.' };
    await this.take(folder, [name], files ?? new Map(), true);
    return { ok: true, view: this.view() };
  }

  /** Look at the folder: what held still is taken. A look asked for while one goes runs once after it. */
  scan(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again ??= this.running.then(() => {
        this.again = null;
        return this.scan();
      });
      return this.again;
    }
    const look = async () => {
      try {
        await this.scanOnce();
      } catch (error) {
        this.deps.log('warn', `Drop folder: the folder could not be read (${(error as Error).name})`);
      } finally {
        this.running = null;
      }
      this.changed();
      // Files waiting to hold still: look again once they could have.
      if (this.pending.size > 0) this.soon(this.deps.settleMs);
    };
    this.running = look();
    return this.running;
  }

  private async scanOnce(): Promise<void> {
    const { folder, on } = this.saved();
    if (!on || !folder) {
      this.pending.clear();
      this.state = 'off';
      return;
    }
    const files = await filesAt(folder);
    if (!files) {
      if (this.state !== 'folder-gone') this.deps.log('info', 'Drop folder: the folder is not there');
      this.pending.clear();
      this.state = 'folder-gone';
      return;
    }
    if (this.state === 'folder-gone') {
      this.deps.log('info', 'Drop folder: the folder is back');
      this.watchFolder();
    }
    const rows = this.rows(folder);
    const now = this.deps.now();
    const ready: string[] = [];
    for (const [name, found] of files) {
      const row = rows.get(name);
      const kind = mediaKindOf(name);
      // As it was when it was taken, or listed as not taken: nothing to do. But one listed for its type alone (not
      // over the size limit) is judged again (Session 51 review: alpha.10 listed sounds, and the videos Session 50
      // added, as not taken), and one still not taken says why in today's words.
      if (row?.size === found.size && row.mtime_ms === found.mtimeMs) {
        const forItsType = row.state === 'not-taken' && found.size <= this.maxBytes;
        if (!forItsType || kind === null) {
          if (forItsType && row.reason !== NOT_MEDIA)
            this.record(folder, name, found, 'not-taken', null, NOT_MEDIA);
          this.pending.delete(name);
          continue;
        }
      }
      // Pictures, videos and (Session 51) sounds: every media file Drashti takes.
      if (kind === null) {
        this.pending.delete(name);
        this.record(folder, name, found, 'not-taken', null, NOT_MEDIA);
        continue;
      }
      if (!heldStill(this.pending, name, found, now, this.deps.settleMs)) continue;
      // Still open in the program writing it (Windows): it waits as a file that has not held still.
      if (await (this.deps.busy ?? busyOnWindows)(join(folder, name))) {
        this.pending.set(name, { ...found, since: now });
        continue;
      }
      if (found.size > this.maxBytes) {
        this.pending.delete(name);
        this.record(
          folder,
          name,
          found,
          'not-taken',
          null,
          `Larger than ${sizeText(this.maxBytes)}: it can be imported anyway.`,
        );
        continue;
      }
      ready.push(name);
    }
    for (const name of this.pending.keys()) if (!files.has(name)) this.pending.delete(name);
    // Files not taken that have gone from the folder leave the list (the library never loses anything).
    const forget = this.deps.db.prepare(
      "DELETE FROM drop_files WHERE folder = ? AND name = ? AND state != 'taken'",
    );
    for (const row of rows.values())
      if (row.state !== 'taken' && !files.has(row.name)) forget.run(folder, row.name);
    if (ready.length > 0 && this.deps.onAir()) {
      // On air or recording: they wait, and are looked at again after the settle time.
      this.state = 'waiting';
      return;
    }
    this.state = 'watching';
    if (ready.length > 0) await this.take(folder, ready, files, false);
  }

  private async take(
    folder: string,
    names: readonly string[],
    files: ReadonlyMap<string, Found>,
    anyway: boolean,
  ): Promise<void> {
    const given = names.map((name) => ({ path: join(folder, name), relative: name }));
    const result = await this.deps.importFiles(
      given.map((g) => g.path),
      {},
    );
    for (const name of names) this.pending.delete(name);
    if (!result.ok) {
      // Tried again at the next look.
      this.deps.log('warn', 'Drop folder: files could not be imported');
      return;
    }
    const items = this.deps.report(result.runId)?.items ?? [];
    const made = madeFrom(items, given);
    const at = new Date(this.deps.now()).toISOString();
    // What each file taken was stored as (a picture, a video or a sound), for the notice.
    const took: (string | null)[] = [];
    const mark = this.deps.db.prepare('UPDATE media SET dropped_at = COALESCE(dropped_at, ?) WHERE id = ?');
    const storedAs = this.deps.db.prepare('SELECT kind FROM media WHERE id = ?');
    this.deps.db.transaction(() => {
      for (const g of given) {
        const found = files.get(g.relative) ?? { size: 0, mtimeMs: 0 };
        const m = made.get(g.relative);
        if (m?.kind === 'media') {
          mark.run(at, m.mediaId);
          this.record(folder, g.relative, found, 'taken', m.mediaId, null);
          took.push((storedAs.get(m.mediaId) as { kind: string } | undefined)?.kind ?? null);
        } else {
          const item = items.find((i) => i.sourcePath === g.path);
          this.record(
            folder,
            g.relative,
            found,
            'failed',
            null,
            item?.message ?? 'It could not be imported.',
          );
        }
      }
    })();
    const taken = took.length;
    const failed = names.length - taken;
    this.last = { at: this.deps.now(), taken };
    this.deps.log(
      'info',
      `Drop folder: ${String(taken)} file(s) taken${anyway ? ' (imported anyway)' : ''}, ${String(failed)} not`,
    );
    if (taken > 0) this.deps.mediaChanged();
    // One quiet notice for the batch, in Pro Mode only; when nothing came in, only what was not taken.
    if (!this.deps.simpleMode() && (taken > 0 || failed > 0))
      this.deps.notice(
        taken === 0
          ? `${plural(failed, 'file', 'files')} from the drop folder ${failed === 1 ? 'was' : 'were'} not taken: see File › Drop Folder….`
          : `${plural(taken, ...batchWords(took))} from the drop folder ${taken === 1 ? 'is' : 'are'} in Media.${failed > 0 ? ` ${plural(failed, 'file was', 'files were')} not taken: see File › Drop Folder….` : ''}`,
      );
    this.changed();
  }
}
